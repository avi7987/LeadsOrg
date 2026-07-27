// =====================================================================
//  automations.js — אוטומציות מתוזמנות (רצות כל 5 דקות)
//   1. הודעת המשך בתאריך החזרה שהוגדר לליד
//   2. תזכורת ללקוחה שנטשה את הפופ-אפ (ברירת מחדל: 6 שעות)
//   3. תזכורת יום לפני האירוע
//  כל ההודעות נערכות מהדשבורד. הכל מכבד DRY_RUN.
// =====================================================================
import * as db from './db.js';
import { fill, parseEventDate } from './extract.js';
import { sendText } from './logic.js';

const todayISO = () => { const d = new Date(); const p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`; };
const nowISO = () => new Date().toISOString();

// ── שעות שקט: הודעות אוטומטיות נשלחות רק בחלון המותר (שעון ישראל) ──
// חשוב: השרת בענן רץ ב-UTC, לכן מחשבים את השעה בישראל במפורש.
function israelMinutes() {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const h = +parts.find(p => p.type === 'hour').value;
  const m = +parts.find(p => p.type === 'minute').value;
  return h * 60 + m;
}
const toMinutes = (hhmm, fallback) => {
  const m = /^(\d{1,2}):(\d{2})$/.exec((hhmm || '').trim());
  return m ? (+m[1]) * 60 + (+m[2]) : fallback;
};
function withinSendWindow(cfg) {
  const now = israelMinutes();
  const start = toMinutes(cfg.sendStart, 510);   // 08:30
  const end   = toMinutes(cfg.sendEnd, 1290);    // 21:30
  return start <= end ? (now >= start && now <= end) : (now >= start || now <= end);
}
// מספר הימים שנותרו עד תאריך (0 = היום, 1 = מחר)
function daysUntil(date) {
  const t = new Date(); t.setHours(0, 0, 0, 0);
  const d = new Date(date); d.setHours(0, 0, 0, 0);
  return Math.round((d - t) / 864e5);
}

// ── 1. הודעות המשך שהגיע זמנן ──
async function runFollowups(client, cfg) {
  if (!cfg.followupEnabled) return;
  const { data } = await db.supabase.from('leads')
    .select('id,name,phone,followup_date,followup_message,status,followup_sent_at')
    .lte('followup_date', todayISO())
    .is('followup_sent_at', null)
    .in('status', ['new', 'noanswer', 'followup'])
    .limit(20);
  for (const l of (data || [])) {
    if (!l.phone) continue;
    const text = fill(l.followup_message || cfg.followupMessage, { name: l.name });
    try {
      await sendText(client, l.phone, text);
      await db.supabase.from('leads').update({ followup_sent_at: nowISO() }).eq('id', l.id);
      console.log(`📨 הודעת המשך נשלחה ל-${l.name || l.phone}`);
    } catch (e) { console.error('followup:', e.message); }
  }
}

// ── 2. תזכורת ללקוחה שנטשה את הפופ-אפ + תפוגת שיחות ישנות ──
async function runAbandoned(client, cfg, expireOnly = false) {
  const { data } = await db.supabase.from('popup_sessions')
    .select('phone,lead_id,step,answers,started_at,nudged_at').limit(50);
  const hrsAgo = ts => (Date.now() - new Date(ts).getTime()) / 3600000;
  for (const s of (data || [])) {
    const total = hrsAgo(s.started_at);                                   // גיל השיחה (לתפוגה)
    // הזמן מאז הפעילות האחרונה — כדי לא "לנדנד" ללקוחה שעונה לאט אבל פעילה
    const age = hrsAgo((s.answers && s.answers.__last) || s.started_at);
    // תפוגה: שיחה ישנה מדי — סוגרים כדי שהודעה עתידית לא תיחשב בטעות כתשובה
    if (total > cfg.abandonExpireHours) {
      await db.deletePopupSession(s.phone);
      console.log(`⌛ שיחת פופ-אפ פגה ונסגרה: ${s.phone}`);
      continue;
    }
    if (expireOnly || !cfg.abandonEnabled || s.nudged_at || age < cfg.abandonHours) continue;
    if (s.answers && s.answers.__test) continue;              // שיחת בדיקה — לא מנדנדים
    const text = fill(cfg.abandonMessage, s.answers || {});
    try {
      await sendText(client, s.phone, text);
      await db.updatePopupSession(s.phone, { nudged_at: nowISO() });
      console.log(`🔔 תזכורת נטישה נשלחה ל-${s.phone}`);
    } catch (e) { console.error('abandon:', e.message); }
  }
}

// ── 3. תזכורת יום לפני האירוע (ללקוחות שסגרו) ──
async function runEventReminders(client, cfg) {
  if (!cfg.eventReminderEnabled) return;
  const { data } = await db.supabase.from('leads')
    .select('id,name,phone,event_date,status,event_reminder_sent_at')
    .eq('status', 'closed')
    .is('event_reminder_sent_at', null)
    .not('event_date', 'is', null)
    .limit(50);
  for (const l of (data || [])) {
    if (!l.phone) continue;
    const d = parseEventDate(l.event_date);
    if (!d) continue;
    const left = daysUntil(d);
    // מחר (1) — ואם חלון השעות חסם אתמול בערב, נשלח גם בבוקר האירוע (0)
    if (left !== 1 && left !== 0) continue;
    const text = fill(cfg.eventReminderMessage, { name: l.name });
    try {
      await sendText(client, l.phone, text);
      await db.supabase.from('leads').update({ event_reminder_sent_at: nowISO() }).eq('id', l.id);
      console.log(`🗓️ תזכורת אירוע נשלחה ל-${l.name || l.phone}`);
    } catch (e) { console.error('event reminder:', e.message); }
  }
}

// ── 4. הודעת "יום אחרי" — לכלות בלבד (בקשת המלצה ותיוג ברשתות) ──
async function runPostEvent(client, cfg) {
  if (!cfg.postEventEnabled) return;
  const { data } = await db.supabase.from('leads')
    .select('id,name,phone,event_date,status,is_bride,post_event_sent_at')
    .eq('status', 'closed')
    .eq('is_bride', true)                     // כלות בלבד
    .is('post_event_sent_at', null)
    .not('event_date', 'is', null)
    .limit(50);
  for (const l of (data || [])) {
    if (!l.phone) continue;
    const d = parseEventDate(l.event_date);
    if (!d) continue;
    // נשלח כאשר עברו X שעות מתאריך האירוע (ברירת מחדל 48)
    const hoursSince = (Date.now() - d.getTime()) / 3600000;
    if (hoursSince < cfg.postEventHours) continue;
    if (hoursSince > cfg.postEventHours + 14 * 24) continue;   // אירוע ישן מאוד — מדלגים
    const text = fill(cfg.postEventMessage, { name: l.name });
    try {
      await sendText(client, l.phone, text);
      await db.supabase.from('leads').update({ post_event_sent_at: nowISO() }).eq('id', l.id);
      console.log(`💐 הודעת "יום אחרי" נשלחה לכלה ${l.name || l.phone}`);
    } catch (e) { console.error('post event:', e.message); }
  }
}

let running = false;
export async function runAutomations(client) {
  if (running) return;                        // מונע חפיפה בין הרצות
  running = true;
  try {
    const cfg = await db.getConfig();
    // מחוץ לחלון השעות — לא שולחים כלום (ההודעות ימתינו לבוקר)
    if (!withinSendWindow(cfg)) {
      await runAbandoned(client, cfg, true);   // רק תפוגת שיחות ישנות (בלי שליחה)
      return;
    }
    await runFollowups(client, cfg);
    await runAbandoned(client, cfg);
    await runEventReminders(client, cfg);
    await runPostEvent(client, cfg);
  } catch (e) {
    console.error('automations:', e.message || e);
  } finally { running = false; }
}

export function startAutomations(client) {
  setTimeout(() => runAutomations(client), 20000);            // הרצה ראשונה אחרי 20 שניות
  setInterval(() => runAutomations(client), 5 * 60 * 1000);   // ואחר כך כל 5 דקות
  console.log('🤖 מנוע האוטומציות פעיל (בדיקה כל 5 דקות)');
}
