-- =====================================================================
--  realtime.sql — הפעלת עדכון חי (Realtime) בדשבורד
--
--  מה זה עושה: מאפשר ל-Supabase "לשדר" שינויים בטבלאות leads ו-messages
--  לדשבורד בזמן אמת — כך ליד חדש שנכנס מוואטסאפ מופיע בטבלה מיד,
--  בלי צורך לרענן את הדף.
--
--  איך מריצים (פעם אחת):
--    Supabase → SQL Editor → מדביקים ומריצים (Run).
-- =====================================================================

alter publication supabase_realtime add table leads;
alter publication supabase_realtime add table messages;

-- אם אחת מהטבלאות כבר נוספה בעבר, Postgres יחזיר שגיאת "already member" —
-- זה בסדר גמור, אפשר להתעלם.
