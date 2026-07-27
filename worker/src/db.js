// =====================================================================
//  db.js — כל הגישה ל-Supabase במקום אחד
//  ה-Worker משתמש ב-service_role key ולכן עוקף RLS.
// =====================================================================
import { createClient } from '@supabase/supabase-js';
import 'dotenv/config';

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  console.error('❌ חסרים SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY בקובץ .env');
  process.exit(1);
}

export const supabase = createClient(url, key, {
  auth: { persistSession: false },
});

// ---------- contacts ----------
export async function getContact(phone) {
  const { data } = await supabase.from('contacts').select('*').eq('phone', phone).maybeSingle();
  return data || null;
}

export async function createContact(phone, pushName, isSaved) {
  const { data } = await supabase.from('contacts')
    .insert({ phone, push_name: pushName || null, is_saved: !!isSaved })
    .select().single();
  return data;
}

export async function touchContact(phone) {
  await supabase.from('contacts').update({ last_message_at: new Date().toISOString() }).eq('phone', phone);
}

export async function incScreened(phone) {
  // מגדיל את screened_count ב-1 (RPC היה נקי יותר; כאן פשוט קוראים ומעדכנים)
  const c = await getContact(phone);
  const next = (c?.screened_count || 0) + 1;
  await supabase.from('contacts').update({ screened_count: next, last_message_at: new Date().toISOString() }).eq('phone', phone);
  return next;
}

export async function setContactState(phone, state) {
  await supabase.from('contacts').update({ state }).eq('phone', phone);
}

// ---------- messages (לוג) ----------
export async function logMessage(phone, direction, body) {
  await supabase.from('messages').insert({ phone, direction, body: body || '' });
}

// מחיקת כל ההודעות של מספר (כשההתכתבות נסגרה בלי ליד — פרטיות ונפח)
export async function deleteMessages(phone) {
  await supabase.from('messages').delete().eq('phone', phone);
}

// ---------- leads ----------
export async function createLead(lead) {
  const { data, error } = await supabase.from('leads').insert(lead).select().single();
  if (error) throw error;
  return data;
}

export async function updateLead(id, fields) {
  // מסננים undefined כדי לא לדרוס שדות בטעות
  const clean = Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
  if (Object.keys(clean).length === 0) return;
  await supabase.from('leads').update(clean).eq('id', id);
}

// ---------- popup sessions ----------
export async function getPopupSession(phone) {
  const { data } = await supabase.from('popup_sessions').select('*').eq('phone', phone).maybeSingle();
  return data || null;
}

export async function createPopupSession(phone, leadId) {
  await supabase.from('popup_sessions').upsert({ phone, lead_id: leadId, step: 0, answers: {} });
}

export async function updatePopupSession(phone, fields) {
  await supabase.from('popup_sessions').update(fields).eq('phone', phone);
}

export async function deletePopupSession(phone) {
  await supabase.from('popup_sessions').delete().eq('phone', phone);
}

// ---------- settings + keywords (עם קאשינג קצר) ----------
let _cache = null;
let _cacheAt = 0;
const CACHE_MS = 30_000;

export async function getConfig() {
  if (_cache && Date.now() - _cacheAt < CACHE_MS) return _cache;

  const [{ data: kws }, { data: setRows }] = await Promise.all([
    supabase.from('keywords').select('word'),
    supabase.from('settings').select('key,value'),
  ]);

  const s = {};
  (setRows || []).forEach(r => { s[r.key] = r.value; });

  _cache = {
    keywords:       (kws || []).map(k => k.word),
    popupQuestions: s.popup_questions || [],
    popupThanks:    s.popup_thanks || 'תודה! נחזור אלייך בהקדם 💕',
    adPrompt:       s.ad_prompt || '',
    windowMinutes:  Number(s.window_minutes ?? 60),
    maxScreened:    Number(s.max_screened ?? 3),
    // ── אוטומציות (נערכות מהדשבורד) ──
    followupEnabled: s.followup_enabled !== false,
    followupDays:    Number(s.followup_days ?? 2),
    followupMessage: s.followup_message || 'היי {{name}} 💕 רק רציתי לבדוק אם חשבת על זה? אשמח לענות על כל שאלה ✨',
    abandonEnabled:  s.abandon_enabled !== false,
    abandonHours:    Number(s.abandon_hours ?? 6),
    abandonMessage:  s.abandon_message || 'היי {{name}} 🌸 נשאר לי רק עוד פרט קטן כדי לשמור לך מקום — נשמח שתשלימי 💕',
    abandonExpireHours: Number(s.abandon_expire_hours ?? 72),
    eventReminderEnabled: s.event_reminder_enabled !== false,
    eventReminderMessage: s.event_reminder_message || 'היי {{name}} 💕 מחר היום הגדול! מתרגשת לקראתך ✨ נתראה מחר',
    // הודעת "יום אחרי" — לכלות בלבד
    postEventEnabled: s.post_event_enabled !== false,
    postEventHours:   Number(s.post_event_hours ?? 48),
    postEventMessage: s.post_event_message || 'היי {{name}} 💕 איזה כיף היה להיות חלק מהיום הגדול שלך! אשמח מאוד לתגובה או תיוג שלי בסטורי 🙏',
    // חלון שעות מותר לשליחה (שעון ישראל)
    sendStart: s.send_start || '08:30',
    sendEnd:   s.send_end   || '21:30',
  };
  _cacheAt = Date.now();
  return _cache;
}
