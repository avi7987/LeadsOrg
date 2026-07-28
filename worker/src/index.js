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
import { handleIncoming, normPhone } from './logic.js';
import * as db from './db.js';
import { fill } from './extract.js';
import { startAutomations } from './automations.js';

const QR_FILE = './qr.png';
const PORT = process.env.PORT || 3000;   // הענן מקצה פורט דרך PORT
let state = 'starting';   // starting | qr | ready

const client = new Client({
  authStrategy: new LocalAuth({
    dataPath: process.env.WA_SESSION_PATH || './.wwebjs_auth',
  }),
  puppeteer: {
    headless: true,
    // בענן משתמשים ב-Chromium המותקן במערכת (דרך משתנה סביבה); מקומית — ברירת המחדל של puppeteer
    executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined,
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  },
});

// ── דיווח מצב החיבור לדשבורד (דרך בסיס הנתונים — אין נקודת קצה ציבורית) ──
async function setWaStatus(status, extra = {}) {
  try {
    await db.supabase.from('wa_status').upsert({
      id: 1, status, updated_at: new Date().toISOString(), ...extra,
    });
  } catch (e) { console.error('wa_status:', e.message || e); }
}

// ── QR חדש (מתחדש כל ~20 שניות עד שסורקים) ──
client.on('qr', async (qr) => {
  state = 'qr';
  qrcode.generate(qr, { small: true });               // גיבוי בטרמינל/לוג
  try {
    const dataUri = await QRCode.toDataURL(qr, { width: 420, margin: 2 });
    await setWaStatus('qr', { qr: dataUri, detail: 'ממתין לסריקה מהדשבורד' });
    console.log('📲 קוד QR נשלח לדשבורד — היכנסי להגדרות → חיבור וואטסאפ');
  } catch (e) { console.error('qr:', e.message); }
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
  // מנקים את ה-QR מיד — לא נשאר קוד "תלוי" שאפשר לסרוק
  const me = (client.info && client.info.wid && client.info.wid.user) || null;
  await setWaStatus('ready', { qr: null, phone: me, detail: null });
  startHeartbeat();
  startCommandPoller();
  startAutomations(client);
});

// דופק כל 30 שניות — כך הדשבורד יודע להבחין בין "מחובר" ל-"השרת נפל"
let heartbeatStarted = false;
function startHeartbeat() {
  if (heartbeatStarted) return;
  heartbeatStarted = true;
  setInterval(() => {
    if (state === 'ready') setWaStatus('ready');
  }, 30000);
}

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
  const waNum = normPhone(digits);   // פורמט קנוני — זהה לשאר המערכת
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

client.on('auth_failure', async (m) => {
  console.error('❌ כשל אימות:', m);
  await setWaStatus('disconnected', { qr: null, detail: 'כשל אימות — נדרש חיבור מחדש' });
});

client.on('disconnected', async (reason) => {
  state = 'starting';
  console.error('⚠️  נותק:', reason, '— מאתחל מחדש בעוד 3 שניות...');
  await setWaStatus('disconnected', { qr: null, detail: 'החיבור נותק (' + reason + ') — מנסה להתחבר מחדש' });
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

// ── שרת בריאות בלבד — אין כאן QR ואין מידע רגיש ──
//    (ה-QR עובר לדשבורד דרך בסיס הנתונים, מוגן בהתחברות)
http.createServer((req, res) => {
  if ((req.url || "/").startsWith("/health")) {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ ok: true, state }));
    return;
  }
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
  res.end(`<!doctype html><html dir="rtl"><head><meta charset="utf-8"><title>מערכת הלידים</title>
<style>body{margin:0;font-family:system-ui,sans-serif;background:#FFF8F7;color:#2D2D2D;display:flex;min-height:100vh;align-items:center;justify-content:center;text-align:center}
.c{background:#fff;padding:34px 40px;border-radius:22px;box-shadow:0 12px 40px rgba(0,0,0,.06)}h1{margin:0 0 8px;font-size:22px}p{margin:0;color:#7A7A7A;font-size:14px}</style>
</head><body><div class="c"><h1>🔒 שירות מערכת הלידים</h1>
<p>השירות פעיל. ניהול וחיבור הוואטסאפ מתבצעים מתוך הדשבורד, לאחר התחברות.</p></div></body></html>`);
}).listen(PORT, () => console.log(`🌐 שרת בריאות מאזין על פורט ${PORT}`));

console.log('⏳ מאתחל חיבור לוואטסאפ...');
console.log(`   סביבה: node ${process.version} · PORT=${PORT} · Chromium=${process.env.PUPPETEER_EXECUTABLE_PATH || '(ברירת מחדל)'} · session=${process.env.WA_SESSION_PATH || './.wwebjs_auth'}`);
client.initialize().catch((err) => {
  console.error('❌ האתחול נכשל:', (err && err.stack) || err);
  console.error('   בדקי: משתני סביבה, Chromium מותקן, וזיכרון פנוי (whatsapp-web.js דורש ~1GB).');
  process.exit(1);
});
