-- =====================================================================
--  add-sessions-read.sql — הרשאת קריאה לשיחות הפופ-אפ בדשבורד
--
--  למה צריך: כדי שהדשבורד יוכל להציג בשורת הליד "בעוד X שעות תישלח
--  תזכורת", הוא צריך לקרוא את טבלת popup_sessions.
--  זו הרשאת קריאה בלבד (הכתיבה נשארת רק ל-Worker). לא נוגע בשום נתון.
--
--  איך מריצים (פעם אחת): Supabase → SQL Editor → הדבקה → Run.
-- =====================================================================

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public'
       and tablename  = 'popup_sessions'
       and policyname = 'auth read sessions'
  ) then
    create policy "auth read sessions" on popup_sessions
      for select to authenticated using (true);
  end if;
end $$;
