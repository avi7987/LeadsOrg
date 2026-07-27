-- =====================================================================
--  add-automations.sql — אוטומציות + הודעות שנערכות מהדשבורד
--
--  מוסיף:
--   • leads: הודעת המשך אישית, וסימונים שההודעות נשלחו (מונע כפילות)
--   • popup_sessions: סימון שנשלחה תזכורת נטישה
--   • settings: ניסוחי ההודעות והגדרות הזמנים
--
--  איך מריצים (פעם אחת): Supabase → SQL Editor → הדבקה → Run.
-- =====================================================================

-- ── לידים ──
alter table leads add column if not exists followup_message        text;         -- ניסוח אישי לליד (ריק = ברירת המחדל)
alter table leads add column if not exists followup_sent_at        timestamptz;  -- מתי נשלחה הודעת ההמשך
alter table leads add column if not exists event_reminder_sent_at  timestamptz;  -- מתי נשלחה תזכורת האירוע

-- ── שיחות פופ-אפ ──
alter table popup_sessions add column if not exists nudged_at timestamptz;       -- מתי נשלחה תזכורת נטישה

-- ── הגדרות האוטומציות (ניתנות לעריכה מהדשבורד) ──
insert into settings(key, value) values
  ('followup_enabled',       'true'::jsonb),
  ('followup_days',          '2'::jsonb),
  ('followup_message',       '"היי {{name}} 💕 רק רציתי לבדוק אם חשבת על זה? אשמח לענות על כל שאלה ✨"'::jsonb),
  ('abandon_enabled',        'true'::jsonb),
  ('abandon_hours',          '6'::jsonb),
  ('abandon_message',        '"היי {{name}} 🌸 נשאר לי רק עוד פרט קטן כדי לשמור לך מקום — נשמח שתשלימי 💕"'::jsonb),
  ('abandon_expire_hours',   '72'::jsonb),
  ('event_reminder_enabled', 'true'::jsonb),
  ('event_reminder_message', '"היי {{name}} 💕 מחר היום הגדול! מתרגשת לקראתך ✨ נתראה מחר"'::jsonb)
on conflict (key) do nothing;

-- ── נרמול מספרי טלפון קיימים לפורמט אחיד (972XXXXXXXXX) ──
update leads
   set phone = case
     when regexp_replace(phone, '\D', '', 'g') like '972%' then regexp_replace(phone, '\D', '', 'g')
     when regexp_replace(phone, '\D', '', 'g') like '0%'   then '972' || substring(regexp_replace(phone, '\D', '', 'g') from 2)
     else regexp_replace(phone, '\D', '', 'g')
   end
 where phone is not null and phone <> regexp_replace(phone, '\D', '', 'g');
