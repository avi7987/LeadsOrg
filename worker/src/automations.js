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
async function runAbandoned(client, cfg) {
  const { data } = await db.supabase.from('popup_sessions')
    .select('phone,lead_id,step,answers,started_at,nudged_at').limit(50);
  const hrsAgo = ts => (Date.now() - new Date(ts).getTime()) / 3600000;
  for (const s of (data || [])) {
    const age = hrsAgo(s.started_at);
    // תפוגה: שיחה ישנה מדי — סוגרים כדי שהודעה עתידית לא תיחשב בטעות כתשובה
    if (age > cfg.abandonExpireHours) {
      await db.deletePopupSession(s.phone);
      console.log(`⌛ שיחת פופ-אפ פגה ונסגרה: ${s.phone}`);
      continue;
    }
    if (!cfg.abandonEnabled || s.nudged_at || age < cfg.abandonHours) continue;
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
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(0, 0, 0, 0);
  for (const l of (data || [])) {
    if (!l.phone) continue;
    const d = parseEventDate(l.event_date);
    if (!d || d.getTime() !== tomorrow.getTime()) continue;    // רק אירועים של מחר
    const text = fill(cfg.eventReminderMessage, { name: l.name });
    try {
      await sendText(client, l.phone, text);
      await db.supabase.from('leads').update({ event_reminder_sent_at: nowISO() }).eq('id', l.id);
      console.log(`🗓️ תזכורת אירוע נשלחה ל-${l.name || l.phone}`);
    } catch (e) { console.error('event reminder:', e.message); }
  }
}

let running = false;
export async function runAutomations(client) {
  if (running) return;                        // מונע חפיפה בין הרצות
  running = true;
  try {
    const cfg = await db.getConfig();
    await runFollowups(client, cfg);
    await runAbandoned(client, cfg);
    await runEventReminders(client, cfg);
  } catch (e) {
    console.error('automations:', e.message || e);
  } finally { running = false; }
}

export function startAutomations(client) {
  setTimeout(() => runAutomations(client), 20000);            // הרצה ראשונה אחרי 20 שניות
  setInterval(() => runAutomations(client), 5 * 60 * 1000);   // ואחר כך כל 5 דקות
  console.log('🤖 מנוע האוטומציות פעיל (בדיקה כל 5 דקות)');
}
