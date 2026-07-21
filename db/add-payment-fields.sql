-- =====================================================================
--  add-payment-fields.sql — שדות מקום, מחיר, ומקדמה ללידים
--
--  מוסיף לטבלת leads שלושה שדות: מקום האירוע, המחיר שנסגר, ומקדמה ששולמה.
--  (היתרה לתשלום מחושבת אוטומטית בדשבורד: מחיר פחות מקדמה.)
--
--  איך מריצים (פעם אחת):
--    Supabase → SQL Editor → מדביקים ומריצים (Run).
-- =====================================================================

alter table leads add column if not exists location text;
alter table leads add column if not exists price    numeric;
alter table leads add column if not exists deposit  numeric;
