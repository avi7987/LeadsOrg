// =====================================================================
//  index.js — נקודת הכניסה
//  מתחבר לוואטסאפ של איה כ"מכשיר מקושר" (כמו וואטסאפ-ווב),
//  ומריץ עמוד קישור מקומי (http://localhost:3000) עם QR חי לסריקה נוחה.
// =====================================================================
import 'dotenv/config';
import http from 'http';
import fs from 'fs';
import pkg from 'whatsapp-web.js';
const { Client, LocalAuth } = pkg;
import qrcode from 'qrcode-terminal';
import QRCode from 'qrcode';
import { handleIncoming } from './logic.js';
import * as db from './db.js';
import { fill } from './extract.js';

const QR_FILE = './qr.png';
const PORT = 3000;
let state = 'starting';   // starting | qr | ready

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WA_SESSION_PATH || './.wwebjs_auth',
  }),
  puppeteer: {
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

// ── QR חדש (מתחדש כל ~20 שניות עד שסורקים) ──
client.on('qr', async (qr) => {
  state = 'qr';
  qrcode.generate(qr, { small: true });               // גיבוי בטרמינל
  try { await QRCode.toFile(QR_FILE, qr, { width: 420, margin: 2 }); }
  catch (e) { console.error('qr.png:', e.message); }
  console.log(`🌐 לקישור — פתחי בדפדפן:  http://localhost:${PORT}`);
});

client.on('authenticated', () => console.log('🔐 אומת בהצלחה'));

client.on('ready', async () => {
  state = 'ready';
  try { if (fs.existsSync(QR_FILE)) fs.unlinkSync(QR_FILE); } catch {}
  const dry = process.env.DRY_RUN !== 'false';
  console.log('✅ המערכת מחוברת ומאזינה. הטלפון של איה ממשיך לעבוד כרגיל.');
  console.log(dry
    ? '🧪 מצב בדיקה (DRY_RUN): מזהה ויוצר לידים, אך לא שולח הודעות אמת ללקוחות.'
    : '🚀 מצב חי: המערכת שולחת פופ-אפים אמיתיים ללקוחות!');
  startCommandPoller();
});

// ── בדיקות מהדשבורד: שולף "פקודות בדיקה" מ-Supabase ושולח פופ-אפ אמיתי ──
//    (שליחה אמיתית תמיד — גם ב-DRY_RUN — כי זו בדיקה יזומה שלך)
let pollerStarted = false;
function startCommandPoller() {
  if (pollerStarted) return;
  pollerStarted = true;
  setInterval(async () => {
    try {
      const { data } = await db.supabase.from('commands')
        .select('*').eq('status', 'pending').eq('type', 'test_popup').limit(5);
      for (const cmd of (data || [])) await handleTestPopup(cmd);
    } catch { /* טבלה עדיין לא קיימת / רשת — מתעלמים */ }
  }, 3000);
}

async function handleTestPopup(cmd) {
  // תופסים את הפקודה (מונע שליחה כפולה)
  const { data: claimed } = await db.supabase.from('commands')
    .update({ status: 'processing' }).eq('id', cmd.id).eq('status', 'pending').select();
  if (!claimed || !claimed.length) return;

  const digits = (cmd.phone || '').replace(/\D/g, '');
  if (!digits) {
    await db.supabase.from('commands').update({ status: 'error', result: 'מספר לא תקין' }).eq('id', cmd.id);
    return;
  }
  const waNum = digits.startsWith('972') ? digits : '972' + digits.replace(/^0/, '');
  const chatId = waNum + '@c.us';
  try {
    const cfg = await db.getConfig();
    if (!cfg.popupQuestions.length) throw new Error('אין שאלות פופ-אפ מוגדרות');
    // יוצרים ליד בדיקה ומתחילים שיחה אינטראקטיבית — בדיוק כמו לקוחה אמיתית
    const lead = await db.createLead({
      source: 'הודעת פופ-אפ', name: '', phone: waNum, wa_chat_id: chatId, note: '🧪 בדיקה', status: 'new',
    });
    await db.createPopupSession(waNum, lead.id);
    await db.supabase.from('popup_sessions').update({ answers: { __test: true } }).eq('phone', waNum);
    // רק השאלה הראשונה — השאר "יתגלגלו" רק אחרי שהלקוחה עונה
    const q1 = fill(cfg.popupQuestions[0], {});
    await client.sendMessage(chatId, q1);
    await db.logMessage(waNum, 'out', q1);
    await db.supabase.from('commands').update({ status: 'done', result: 'התחיל' }).eq('id', cmd.id);
    console.log(`🧪 התחילה שיחת בדיקה מתגלגלת עם ${waNum}`);
  } catch (e) {
    await db.supabase.from('commands').update({ status: 'error', result: String(e.message || e) }).eq('id', cmd.id);
    console.error('שגיאה בבדיקה:', e.message || e);
  }
}

client.on('auth_failure', (m) => console.error('❌ כשל אימות:', m));

client.on('disconnected', (reason) => {
  state = 'starting';
  console.error('⚠️  נותק:', reason, '— מאתחל מחדש בעוד 3 שניות...');
  setTimeout(() => client.initialize().catch(e => console.error(e)), 3000);
});

// ── כל הודעה נכנסת עוברת ל"מוח" ──
// מאזינים גם ל-message וגם ל-message_create (בגרסאות מסוימות message לא נורה בעקביות),
// עם מניעת עיבוד כפול לפי מזהה ההודעה.
const _seenMsgs = new Set();
async function onIncoming(msg, via) {
  try {
    if (msg.fromMe) return;
    const id = msg.id && msg.id._serialized;
    console.log(`📨 [${via}] מ-${msg.from}: ${JSON.stringify(msg.body || '')}`);
    if (id) {
      if (_seenMsgs.has(id)) return;         // כבר טופל דרך האירוע האחר
      _seenMsgs.add(id);
      if (_seenMsgs.size > 800) _seenMsgs.clear();
    }
    await handleIncoming({ client, msg });
  } catch (err) {
    console.error('שגיאה בטיפול בהודעה:', err);
  }
}
// מאזין יחיד: message_create נורה על כל ההודעות (כולל נכנסות), עם סינון fromMe.
// (שימוש בשני אירועים גרם לעיבוד כפול — כל הודעה נשלחה פעמיים.)
client.on('message_create', (msg) => onIncoming(msg, 'message_create'));

// ── עמוד קישור מקומי (QR חי) ──
http.createServer((req, res) => {
  const url = req.url || '/';
  if (url.startsWith('/qr.png')) {
    fs.readFile(QR_FILE, (e, buf) => {
      if (e) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { 'Content-Type': 'image/png', 'Cache-Control': 'no-store' });
      res.end(buf);
    });
    return;
  }
  if (url.startsWith('/status')) {
    res.writeHead(200, { 'Content-Type': 'text/plain' });
    res.end(state);
    return;
  }
  res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
  res.end(page());
}).listen(PORT, () => console.log(`🌐 עמוד הקישור מוכן: http://localhost:${PORT}`));

function page() {
  if (state === 'ready') {
    return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>מחובר</title>
<style>body{margin:0;font-family:'Segoe UI',sans-serif;background:#E5EFE7;color:#2f5138;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}h1{font-size:44px;margin:0 0 8px}</style>
</head><body><div><h1>✅ מחובר!</h1><p>המערכת מאזינה. אפשר לסגור את החלון.</p></div></body></html>`;
  }
  return `<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>קישור וואטסאפ</title><style>
    body{margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;background:linear-gradient(160deg,#FBF4F3,#F5EAEC);font-family:'Segoe UI',sans-serif;color:#3B2A33}
    .card{background:#fff;padding:26px;border-radius:22px;box-shadow:0 16px 40px -12px rgba(125,66,87,.35);text-align:center}
    h2{color:#7D4257;margin:0 0 4px}.live{color:#4F7A5D;font-weight:600;font-size:13px}
    img{width:330px;height:330px;border-radius:14px;display:block;margin:10px auto}
    ol{text-align:right;color:#6b5560;font-size:13px;max-width:330px;line-height:1.7;padding-inline-start:20px;margin:6px 0 0}
  </style></head><body><div class="card">
    <h2>קישור וואטסאפ</h2><div class="live">● מתחדש אוטומטית — תמיד תקף</div>
    <img id="qr" src="/qr.png" alt="QR">
    <ol><li>בטלפון של איה: וואטסאפ ← הגדרות</li><li>מכשירים מקושרים ← קישור מכשיר</li><li>סרקי את הקוד</li></ol>
  </div><script>
    setInterval(()=>{document.getElementById('qr').src='/qr.png?t='+Date.now();},4000);
    setInterval(()=>{fetch('/status').then(r=>r.text()).then(t=>{if(t==='ready')location.reload();}).catch(()=>{});},3000);
  </script></body></html>`;
}

console.log('⏳ מאתחל חיבור לוואטסאפ...');
client.initialize();
