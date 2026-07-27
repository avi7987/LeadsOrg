-- =====================================================================
--  add-post-event.sql — הודעת "יום אחרי" לכלות + שעות שליחה מותרות
--
--  מוסיף:
--   • leads.post_event_sent_at — סימון שההודעה שאחרי האירוע נשלחה (מונע כפילות)
--   • settings — ניסוח ההודעה, הטיימר (48 שעות), וחלון השעות המותר לשליחה
--
--  איך מריצים (פעם אחת): Supabase → SQL Editor → הדבקה → Run.
-- =====================================================================

alter table leads add column if not exists post_event_sent_at timestamptz;

insert into settings(key, value) values
  ('post_event_enabled', 'true'::jsonb),
  ('post_event_hours',   '48'::jsonb),
  ('post_event_message',
    '"היי {{name}} 💕 איזה כיף היה להיות חלק מהיום הגדול שלך! מקווה שנהנית ושהרגשת מהממת ✨\n\nאם בא לך לשמח אותי — אשמח מאוד לתגובה או תיוג שלי בסטורי/פוסט 🙏 זה עוזר לי יותר מכל דבר, וכמובן שאשמח גם להמלצה חמה לחברות שמתחתנות 💍"'::jsonb),
  -- חלון השעות שבו מותר לשלוח הודעות אוטומטיות (שעון ישראל)
  ('send_start', '"08:30"'::jsonb),
  ('send_end',   '"21:30"'::jsonb)
on conflict (key) do nothing;
