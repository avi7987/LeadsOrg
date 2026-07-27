// =====================================================================
//  logic.js — "המוח": כל הלוגיקה מהאפיון (סעיף 2)
//  מקבל הודעה נכנסת ומחליט: להתעלם / לבדוק / ליצור ליד / לשלוח פופ-אפ.
// =====================================================================
import * as db from './db.js';
import { fill, cleanName, classifyService, normalizeDate, detectBride,
         extractNameExplicit, extractDateHint } from './extract.js';

const waId = phone => `${phone}@c.us`;                 // המרה למזהה צ'אט של whatsapp-web.js
const norm = s => (s || '').toString().toLowerCase().trim();
const contains = (text, needle) => norm(text).includes(norm(needle));

// פורמט טלפון קנוני יחיד לכל המערכת: 9725XXXXXXXX (ספרות בלבד)
export function normPhone(p) {
  let d = (p || '').toString().replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('972')) return d;
  if (d.startsWith('0')) return '972' + d.slice(1);
  if (d.length === 9 && d.startsWith('5')) return '972' + d;   // 5XXXXXXXX
  return d;                                                     // בינלאומי — נשמר כמו שהוא
}

// תרגום כתובת @lid (מזהה הפרטיות החדש של וואטסאפ) למספר הטלפון האמיתי —
// דרך אותו מודול פנימי שהספרייה עצמה משתמשת בו (WAWebApiContact.getPhoneNumber)
async function lidToPhone(client, lidSerialized) {
  try {
    const pn = await client.pupPage.evaluate((lid) => {
      try {
        const wid = window.require('WAWebWidFactory').createWid(lid);
        const pnWid = window.require('WAWebApiContact').getPhoneNumber(wid);
        return (pnWid && pnWid._serialized) ? pnWid._serialized : null;
      } catch (e) { return null; }
    }, lidSerialized);
    return pn ? pn.replace(/@.*/, '').replace(/\D/g, '') : '';
  } catch (e) { return ''; }
}

/**
 * מטפל בהודעה נכנסת אחת.
 * @param {object} p
 * @param {import('whatsapp-web.js').Client} p.client
 * @param {import('whatsapp-web.js').Message} p.msg
 */
export async function handleIncoming({ client, msg }) {
  const from = msg.from || '';
  if (from.endsWith('@g.us')) return;                   // מתעלמים מקבוצות

  // מזהה הטלפון — כולל טיפול בכתובות @lid החדשות של וואטסאפ (מזהה פרטיות שאינו המספר)
  let phone = '';
  let contactObj = null;
  if (from.endsWith('@c.us')) {
    phone = from.replace(/@c\.us$/, '').replace(/\D/g, '');       // כתובת קלאסית → המספר ישירות
  } else if (from.endsWith('@lid')) {
    phone = await lidToPhone(client, from);                        // תרגום LID → מספר טלפון אמיתי
  }
  if (!phone) {                                                    // גיבוי אחרון
    try {
      contactObj = await msg.getContact();
      const cand = contactObj && contactObj.id && contactObj.id.server === 'c.us' && contactObj.id.user;
      if (cand) phone = String(cand).replace(/\D/g, '');
    } catch (e) { /* ממשיכים */ }
  }
  if (!phone) phone = from.replace(/@.*/, '').replace(/\D/g, '');
  phone = normPhone(phone);                            // פורמט קנוני אחיד
  const body  = (msg.body || '').trim();
  console.log(`   🔎 from=${from} → phone=${phone}`);
  if (!phone) return;

  const cfg = await db.getConfig();

  // ── 1. אם יש שיחת פופ-אפ פעילה → זו תשובה, ממשיכים את הרצף ──
  const session = await db.getPopupSession(phone);
  if (session) {
    await db.logMessage(phone, 'in', body);            // שיחה של ליד — נשמרת
    return handlePopupAnswer({ client, phone, body, session, cfg });
  }

  // פרטי איש הקשר — בעטיפת try, כי הספרייה נוטה להיכשל כאן מדי פעם
  let pushname = (msg._data && msg._data.notifyName) || '';
  let isMyContact = false;
  try {
    const contact = contactObj || await msg.getContact();
    pushname = pushname || contact.pushname || contact.name || '';
    isMyContact = !!contact.isMyContact;
  } catch (e) { /* ממשיכים עם ברירות מחדל */ }

  // ── 2. מספר שמור באנשי הקשר → מתעלמים לחלוטין (משפחה/חברים) ──
  //    חשוב לפרטיות: ההודעה לא נשמרת בכלל בבסיס הנתונים.
  if (isMyContact) {
    await ensureContact(phone, pushname, true);
    await db.setContactState(phone, 'ignored');
    return;
  }

  // מכאן זו לקוחה פוטנציאלית (לא שמורה) → שומרים את ההודעה.
  // אם ההתכתבות תיסגר בלי ליד — ההודעות יימחקו (ראה purgeIfNoLead).
  await db.logMessage(phone, 'in', body);

  // ── 3. זיהוי פרסום ממומן → ליד אוטומטי, בלי פופ-אפ ──
  if (cfg.adPrompt && contains(body, cfg.adPrompt)) {
    const lead = await db.createLead({
      source: 'פרסום',
      name: pushname || '',
      phone,
      wa_chat_id: waId(phone),
      note: 'הגיע מפרסום ממומן',
      status: 'new',
      followup_date: autoFollowupDate(cfg),
      is_bride: detectBride(body),
    });
    await ensureContact(phone, pushname, false);
    await db.setContactState(phone, 'converted');
    console.log(`📣 ליד מפרסום ממומן: ${phone} (#${lead.id})`);
    return;
  }

  // ── 4. סינון: רק שיחה ראשונה, עד N הודעות, בתוך חלון של שעה ──
  let c = await db.getContact(phone);
  if (!c) c = await db.createContact(phone, pushname, false);

  // כבר טופל (הפך לליד / נסגר / מספר שמור) → לא "מציקים" שוב
  if (c.state !== 'screening') return;

  const ageMin = (Date.now() - new Date(c.first_message_at).getTime()) / 60000;
  if (ageMin > cfg.windowMinutes) {                     // עברה שעה → ההתכתבות "נסגרה"
    await closeWithoutLead(phone);
    return;
  }
  if (c.screened_count >= cfg.maxScreened) {             // כבר נבדקו 3 → נסגר
    await closeWithoutLead(phone);
    return;
  }

  // ── בדיקת מילות מפתח מול ההודעה הנוכחית ──
  const hit = cfg.keywords.find(k => contains(body, k));
  const screened = await db.incScreened(phone);

  if (hit) {
    // נמצאה מילת מפתח → נוצר ליד + מתחילים פופ-אפ
    const lead = await db.createLead({
      source: 'הודעת פופ-אפ',
      name: pushname || '',
      phone,
      wa_chat_id: waId(phone),
      note: `זוהתה מילת מפתח: "${hit}"`,
      status: 'new',
      followup_date: autoFollowupDate(cfg),
      is_bride: detectBride(body + ' ' + hit),
    });
    await db.setContactState(phone, 'converted');
    console.log(`✅ ליד חדש (מילת מפתח "${hit}"): ${phone} (#${lead.id})`);
    await startPopup({ client, phone, leadId: lead.id, cfg, seed: body });
  } else if (screened >= cfg.maxScreened) {
    // ההודעה ה-3 בלי מילת מפתח → סוגרים בלי ליד
    await closeWithoutLead(phone);
    console.log(`➖ נסגר בלי ליד (אין מילת מפתח ב-${screened} הודעות): ${phone}`);
  }
}

// תאריך חזרה אוטומטי לליד חדש (אוטומציה 1) — כך שאף ליד לא "נופל בין הכיסאות"
export function autoFollowupDate(cfg) {
  if (!cfg || !cfg.followupEnabled) return null;
  const d = new Date();
  d.setDate(d.getDate() + Number(cfg.followupDays || 2));
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

// סגירת התכתבות שלא הפכה לליד — כולל מחיקת ההודעות (פרטיות + נפח)
async function closeWithoutLead(phone) {
  await db.setContactState(phone, 'closed');
  try { await db.deleteMessages(phone); } catch (e) { /* לא קריטי */ }
}

// ---------- פופ-אפ: רצף שאלות ותשובות ----------
// מיפוי סדר השאלות → שדות הליד (3 השאלות המוגדרות)
const FIELD_BY_STEP = ['name', 'event_date', 'service'];

// זיהוי נתונים שהלקוחה כבר מסרה בהודעה חופשית — כדי לא לשאול שאלה מיותרת
function harvest(text, answers) {
  const found = {};
  if (!answers.name) { const n = extractNameExplicit(text); if (n) found.name = n; }
  if (!answers.event_date) { const d = extractDateHint(text); if (d) found.event_date = d; }
  if (!answers.service) { const s = classifyService(text); if (s.matched) found.service = s.raw; }
  return found;
}

// השאלה הבאה שבאמת צריך לשאול (מדלגת על שאלות שהנתון שלהן כבר קיים)
function nextAskStep(from, questions, answers) {
  for (let i = from; i < questions.length; i++) {
    const f = FIELD_BY_STEP[i];
    if (!f || !answers[f]) return i;      // שאלה שאין לה שדה מוכר — תמיד נשאלת
  }
  return null;                            // אין מה לשאול → סיום
}

async function startPopup({ client, phone, leadId, cfg, seed = '' }) {
  const questions = cfg.popupQuestions;
  if (!questions.length) return;
  // מה שכבר ידוע מההודעה שפתחה את השיחה
  const answers = harvest(seed, {});
  answers.__last = new Date().toISOString();   // חתימת פעילות — לחישוב תזכורת נטישה
  if (Object.keys(answers).length) console.log(`   🎯 זוהה מראש: ${JSON.stringify(answers)}`);
  const step = nextAskStep(0, questions, answers);
  await db.createPopupSession(phone, leadId);
  if (step === null) {                    // הכל כבר ידוע → מסיימים מיד בלי לשאול
    await db.updatePopupSession(phone, { step: questions.length, answers });
    return finalizePopup({ client, phone, answers, cfg, leadId, isTest: false });
  }
  await db.updatePopupSession(phone, { step, answers });
  await sendText(client, phone, fill(questions[step], answers));
}

async function handlePopupAnswer({ client, phone, body, session, cfg }) {
  const questions = cfg.popupQuestions;
  const isTest = !!(session.answers && session.answers.__test);   // שיחת בדיקה → שולחים באמת

  const answers = { ...(session.answers || {}) };
  const field = FIELD_BY_STEP[session.step] || `q${session.step}`;
  answers[field] = body;
  Object.assign(answers, harvest(body, answers));   // אולי מסרה כמה פרטים בבת אחת
  answers.__last = new Date().toISOString();        // עדכון זמן הפעילות האחרונה

  const next = nextAskStep(session.step + 1, questions, answers);
  if (next !== null) {
    await db.updatePopupSession(phone, { step: next, answers, nudged_at: null });
    await sendText(client, phone, fill(questions[next], answers), isTest);   // שאלה אישית ({{name}})
  } else {
    await finalizePopup({ client, phone, answers, cfg, leadId: session.lead_id, isTest });
  }
}

// ── סיום: זיהוי חכם של התשובות → שדות מדויקים לליד ──
async function finalizePopup({ client, phone, answers, cfg, leadId, isTest }) {
  const name      = cleanName(answers.name);
  const eventDate = normalizeDate(answers.event_date);
  const svc       = classifyService(answers.service);

  // שומרים גם את מילות הלקוחה המקוריות + כל תשובה נוספת
  const extras = Object.entries(answers)
    .filter(([k]) => !FIELD_BY_STEP.includes(k) && !k.startsWith('__'))
    .map(([, v]) => v).filter(Boolean);
  let note = (isTest ? '🧪 בדיקה · ' : '') + 'נקלט אוטומטית מהפופ-אפ';
  if (svc.raw && svc.raw !== svc.label) note += ` · במילותיה: "${svc.raw}"`;
  if (extras.length) note += ` · ${extras.join(' · ')}`;

  // זיהוי כלה — מכלל התשובות והשירות (מטרת-על)
  const isBride = detectBride([svc.raw, answers.service, answers.event_date, answers.name, note].join(' ')) || svc.label === 'כלה';

  await db.updateLead(leadId, {
    name:       name || undefined,
    event_date: eventDate || undefined,
    service:    svc.label || undefined,
    is_bride:   isBride ? true : undefined,
    note,
  });
  await db.deletePopupSession(phone);
  await sendText(client, phone, fill(cfg.popupThanks, answers), isTest);
  console.log(`💾 ליד עודכן: ${name} | ${eventDate} | ${svc.label}`);
}

// ---------- עזרי שליחה ----------
// מצב בדיקה: כברירת מחדל לא שולחים הודעות אמת ללקוחות (בטוח לבדיקה על המספר של איה).
// למעבר למצב חי — הגדירי DRY_RUN=false בקובץ .env
const DRY_RUN = process.env.DRY_RUN !== 'false';
// force=true → שולחים באמת גם ב-DRY_RUN (לשיחות בדיקה יזומות מהדשבורד)
export async function sendText(client, phone, text, force = false) {
  if (DRY_RUN && !force) {
    console.log(`   🧪 [בדיקה] הודעה שהיתה נשלחת ל-${phone}: ${text}`);
    await db.logMessage(phone, 'out', '[DRY_RUN] ' + text);
    return;
  }
  await client.sendMessage(waId(phone), text);
  await db.logMessage(phone, 'out', text);
}

async function ensureContact(phone, pushName, isSaved) {
  const existing = await db.getContact(phone);
  if (!existing) await db.createContact(phone, pushName, isSaved);
}
