-- =====================================================================
--  מערכת ניהול לידים מוואטסאפ · איה
--  Supabase / Postgres — סכימת בסיס הנתונים
--
--  איך מריצים:
--    1. נכנסים ל-Supabase → SQL Editor
--    2. מדביקים את כל הקובץ הזה ומריצים (Run)
--  זה יוצר את כל הטבלאות, ברירות המחדל, וההרשאות.
-- =====================================================================

-- gen_random_uuid() וכו'
create extension if not exists "pgcrypto";

-- =====================================================================
--  contacts — מעקב אחרי כל מספר שנכנס (למנגנון הזיהוי)
--  כאן חיה הלוגיקה של "שמור/לא שמור", "שיחה ראשונה", "חלון שעה".
-- =====================================================================
create table if not exists contacts (
  phone             text primary key,          -- מספר בפורמט בינלאומי, למשל 972501234567
  is_saved          boolean     default false,  -- האם שמור באנשי הקשר של איה
  state             text        default 'screening'
                    check (state in ('screening','converted','closed','ignored')),
  screened_count    int         default 0,      -- כמה הודעות כבר נבדקו (עד 3)
  push_name         text,                        -- השם שהלקוחה הגדירה בוואטסאפ
  first_message_at  timestamptz default now(),   -- תחילת חלון השעה
  last_message_at   timestamptz default now(),
  created_at        timestamptz default now()
);

-- =====================================================================
--  leads — טבלת הלידים (מה שרואים בדשבורד)
-- =====================================================================
create table if not exists leads (
  id            uuid primary key default gen_random_uuid(),
  source        text        default 'ידני'      -- פרסום / הודעת פופ-אפ / ידני / אורגני / המלצה / לקוחה חוזרת
                check (source in ('פרסום','הודעת פופ-אפ','ידני','אורגני','המלצה','לקוחה חוזרת')),
  name          text        default '',
  phone         text,
  event_date    text,                            -- טקסט חופשי בשלב ראשון (לדוגמה "22.10.26")
  service       text,
  note          text        default '',
  status        text        default 'new'
                check (status in ('new','noanswer','followup','closed','lost')),
  followup_date date,                            -- "מתי לחזור ללקוחה"
  wa_chat_id    text,                            -- מזהה הצ'אט בוואטסאפ (לפתיחה מהדשבורד)
  created_at    timestamptz default now()
);
create index if not exists leads_status_idx  on leads(status);
create index if not exists leads_created_idx on leads(created_at desc);
create index if not exists leads_followup_idx on leads(followup_date);

-- =====================================================================
--  messages — לוג ההודעות (לצורך בדיקת 3 הודעות + תיעוד)
-- =====================================================================
create table if not exists messages (
  id         bigint generated always as identity primary key,
  phone      text,
  direction  text check (direction in ('in','out')),
  body       text,
  created_at timestamptz default now()
);
create index if not exists messages_phone_idx on messages(phone, created_at);

-- =====================================================================
--  popup_sessions — מצב שיחת השאלות (הפופ-אפ) שרצה מול לקוחה
-- =====================================================================
create table if not exists popup_sessions (
  phone       text primary key,
  lead_id     uuid references leads(id) on delete cascade,
  step        int  default 0,       -- באיזו שאלה אנחנו
  answers     jsonb default '{}'::jsonb,
  started_at  timestamptz default now()
);

-- =====================================================================
--  keywords — מילות המפתח (נערכות מהדשבורד)
-- =====================================================================
create table if not exists keywords (
  id   bigint generated always as identity primary key,
  word text unique not null
);
insert into keywords(word) values
  ('איפור'),('שיער'),('אירוע'),('חתונה'),('נשף'),('כלה'),('מלווה'),('המלצה')
on conflict (word) do nothing;

-- =====================================================================
--  settings — הגדרות כלליות (key/value), נערכות מהדשבורד
-- =====================================================================
create table if not exists settings (
  key   text primary key,
  value jsonb not null
);
insert into settings(key, value) values
  ('popup_questions', '["היי! נשמח לעזור 💕 מה השם שלך?","לאיזה תאריך האירוע?","איזה שירות מעניין אותך? (איפור / שיער / שניהם)"]'::jsonb),
  ('popup_thanks',    '"תודה רבה! קלטנו את הפרטים ונחזור אלייך בהקדם ✨"'::jsonb),
  ('ad_prompt',       '"היי! הגעתי דרך המודעה שלך על איפור ושיער לאירועים"'::jsonb),
  ('window_minutes',  '60'::jsonb),
  ('max_screened',    '3'::jsonb)
on conflict (key) do nothing;

-- =====================================================================
--  הרשאות (RLS)
--  • ה-Worker משתמש ב-service_role key ולכן עוקף RLS (רואה הכל).
--  • הדשבורד מתחבר עם משתמש מחובר (Aya) — מקבל גישה מלאה ללידים/הגדרות.
-- =====================================================================
alter table leads          enable row level security;
alter table keywords       enable row level security;
alter table settings       enable row level security;
alter table contacts       enable row level security;
alter table messages       enable row level security;
alter table popup_sessions enable row level security;

-- משתמש מחובר (איה) — גישה מלאה לנתונים שבדשבורד
create policy "auth full leads"    on leads          for all to authenticated using (true) with check (true);
create policy "auth full keywords" on keywords        for all to authenticated using (true) with check (true);
create policy "auth full settings" on settings        for all to authenticated using (true) with check (true);
create policy "auth read contacts" on contacts        for select to authenticated using (true);
create policy "auth read messages" on messages        for select to authenticated using (true);
-- (contacts/messages/popup_sessions נכתבים רק ע"י ה-Worker עם service_role)
