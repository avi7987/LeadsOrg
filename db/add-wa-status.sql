-- =====================================================================
--  add-wa-status.sql — חיבור וואטסאפ מאובטח דרך הדשבורד
--
--  במקום דף QR ציבורי (שכל מי שיודע את הכתובת יכול לסרוק!), ה-Worker
--  כותב את מצב החיבור ואת קוד ה-QR לטבלה הזו, והדשבורד קורא אותם —
--  רק אחרי התחברות, ורק לקריאה.
--
--  אבטחה:
--   • כתיבה: רק ה-Worker (service_role) — עוקף RLS.
--   • קריאה: רק משתמש מחובר (authenticated).
--   • ה-QR נמחק מהטבלה ברגע שהחיבור מצליח — לא נשאר "תלוי" באוויר.
--
--  איך מריצים (פעם אחת): Supabase → SQL Editor → הדבקה → Run.
-- =====================================================================

create table if not exists wa_status (
  id          smallint primary key default 1,
  status      text not null default 'starting',   -- starting | qr | ready | disconnected
  qr          text,                                -- תמונת QR (data-URI) — רק בזמן המתנה לסריקה
  phone       text,                                -- המספר המחובר (לתצוגה)
  detail      text,                                -- הסבר קצר (סיבת ניתוק וכו')
  updated_at  timestamptz not null default now(),  -- דופק — מאפשר לזהות ש-Worker נפל
  constraint wa_status_single_row check (id = 1)
);

insert into wa_status(id, status) values (1, 'starting')
  on conflict (id) do nothing;

alter table wa_status enable row level security;

-- קריאה בלבד, ורק למשתמש מחובר
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname='public' and tablename='wa_status' and policyname='auth read wa status'
  ) then
    create policy "auth read wa status" on wa_status
      for select to authenticated using (true);
  end if;
end $$;

-- עדכון חי לדשבורד (כדי שהמחוון יתחלף מיד)
alter publication supabase_realtime add table wa_status;
