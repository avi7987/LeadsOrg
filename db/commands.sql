-- =====================================================================
--  commands — ערוץ פקודות מהדשבורד ל-Worker (בדיקות שליחה)
--  להריץ ב-Supabase → SQL Editor
-- =====================================================================
create table if not exists commands (
  id         bigint generated always as identity primary key,
  type       text not null,               -- 'test_popup'
  phone      text not null,
  status     text default 'pending',       -- pending | processing | done | error
  result     text,
  created_at timestamptz default now()
);

alter table commands enable row level security;
create policy "auth insert commands" on commands for insert to authenticated with check (true);
create policy "auth read commands"   on commands for select to authenticated using (true);
-- (ה-Worker משתמש ב-service_role ולכן מעדכן סטטוס בעקיפת RLS)
