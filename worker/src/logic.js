// =====================================================================
//  logic.js — "המוח": כל הלוגיקה מהאפיון (סעיף 2)
//  מקבל הודעה נכנסת ומחליט: להתעלם / לבדוק / ליצור ליד / לשלוח פופ-אפ.
// =====================================================================
import * as db from './db.js';
import { fill, cleanName, classifyService, normalizeDate } from './extract.js';

const waId = phone => `${phone}@c.us`;                 // המרה למזהה צ'אט של whatsapp-web.js
const norm = s => (s || '').toString().toLowerCase().trim();
const contains = (text, needle) => norm(text).includes(norm(needle));

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
  const body  = (msg.body || '').trim();
  console.log(`   🔎 from=${from} → phone=${phone}`);
  if (!phone) return;

  await db.logMessage(phone, 'in', body);

  const cfg = await db.getConfig();

  // ── 1. אם יש שיחת פופ-אפ פעילה → זו תשובה, ממשיכים את הרצף ──
  const session = await db.getPopupSession(phone);
  if (session) return handlePopupAnswer({ client, phone, body, session, cfg });

  // פרטי איש הקשר — בעטיפת try, כי הספרייה נוטה להיכשל כאן מדי פעם
  let pushname = (msg._data && msg._data.notifyName) || '';
  let isMyContact = false;
  try {
    const contact = contactObj || await msg.getContact();
    pushname = pushname || contact.pushname || contact.name || '';
    isMyContact = !!contact.isMyContact;
  } catch (e) { /* ממשיכים עם ברירות מחדל */ }

  // ── 2. מספר שמור באנשי הקשר → מתעלמים לחלוטין (משפחה/חברים) ──
  if (isMyContact) {
    await ensureContact(phone, pushname, true);
    await db.setContactState(phone, 'ignored');
    return;
  }

  // ── 3. זיהוי פרסום ממומן → ליד אוטומטי, בלי פופ-אפ ──
  if (cfg.adPrompt && contains(body, cfg.adPrompt)) {
    const lead = await db.createLead({
      source: 'פרסום',
      name: pushname || '',
      phone,
      wa_chat_id: waId(phone),
      note: 'הגיע מפרסום ממומן',
      status: 'new',
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
    await db.setContactState(phone, 'closed');
    return;
  }
  if (c.screened_count >= cfg.maxScreened) {             // כבר נבדקו 3 → נסגר
    await db.setContactState(phone, 'closed');
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
    });
    await db.setContactState(phone, 'converted');
    console.log(`✅ ליד חדש (מילת מפתח "${hit}"): ${phone} (#${lead.id})`);
    await startPopup({ client, phone, leadId: lead.id, cfg });
  } else if (screened >= cfg.maxScreened) {
    // ההודעה ה-3 בלי מילת מפתח → סוגרים בלי ליד
    await db.setContactState(phone, 'closed');
    console.log(`➖ נסגר בלי ליד (אין מילת מפתח ב-${screened} הודעות): ${phone}`);
  }
}

// ---------- פופ-אפ: רצף שאלות ותשובות ----------
async function startPopup({ client, phone, leadId, cfg }) {
  const questions = cfg.popupQuestions;
  if (!questions.length) return;
  await db.createPopupSession(phone, leadId);
  await sendText(client, phone, fill(questions[0], {}));
}

async function handlePopupAnswer({ client, phone, body, session, cfg }) {
  const questions = cfg.popupQuestions;
  // מיפוי תשובות לפי סדר השאלות → שדות הליד
  const fieldByStep = ['name', 'event_date', 'service'];
  const isTest = !!(session.answers && session.answers.__test);   // שיחת בדיקה → שולחים באמת

  const answers = { ...(session.answers || {}) };
  const field = fieldByStep[session.step] || `q${session.step}`;
  answers[field] = body;

  const nextStep = session.step + 1;

  if (nextStep < questions.length) {
    await db.updatePopupSession(phone, { step: nextStep, answers });
    await sendText(client, phone, fill(questions[nextStep], answers), isTest);   // שאלה אישית ({{name}})
  } else {
    // ── סיום: זיהוי חכם של התשובות → שדות מדויקים לליד ──
    const name      = cleanName(answers.name);
    const eventDate = normalizeDate(answers.event_date);
    const svc       = classifyService(answers.service);

    // שומרים גם את מילות הלקוחה המקוריות + כל תשובה נוספת
    const extras = Object.entries(answers)
      .filter(([k]) => !fieldByStep.includes(k) && !k.startsWith('__'))
      .map(([, v]) => v).filter(Boolean);
    let note = (isTest ? '🧪 בדיקה · ' : '') + 'נקלט אוטומטית מהפופ-אפ';
    if (svc.raw && svc.raw !== svc.label) note += ` · במילותיה: "${svc.raw}"`;
    if (extras.length) note += ` · ${extras.join(' · ')}`;

    await db.updateLead(session.lead_id, {
      name:       name || undefined,
      event_date: eventDate || undefined,
      service:    svc.label || undefined,
      note,
    });
    await db.deletePopupSession(phone);
    await sendText(client, phone, fill(cfg.popupThanks, answers), isTest);
    console.log(`💾 ליד עודכן: ${name} | ${eventDate} | ${svc.label}`);
  }
}

// ---------- עזרי שליחה ----------
// מצב בדיקה: כברירת מחדל לא שולחים הודעות אמת ללקוחות (בטוח לבדיקה על המספר של איה).
// למעבר למצב חי — הגדירי DRY_RUN=false בקובץ .env
const DRY_RUN = process.env.DRY_RUN !== 'false';
// force=true → שולחים באמת גם ב-DRY_RUN (לשיחות בדיקה יזומות מהדשבורד)
async function sendText(client, phone, text, force = false) {
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
