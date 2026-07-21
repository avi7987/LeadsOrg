# חיבור יומן גוגל — מדריך הגדרה חד-פעמי

המדריך הזה מסביר איך לחבר את הדשבורד ל**יומן גוגל** דרך "התחברות עם Google".
עושים את זה **פעם אחת** (הבעלים של המוצר). מרגע זה כל משתמשת פשוט מתחברת עם
גוגל, מאשרת גישה ליומן פעם אחת, ואז כל "הוספה ליומן" קורית לבד — בלי קבצים,
בלי תוספים.

> **חשוב:** בגלל שזו התחברות אמיתית מול גוגל, הדשבורד חייב לרוץ מ**כתובת אינטרנט**
> (https) ולא מקובץ מקומי. אפשר לארח אותו חינם (למשל Netlify / Vercel / GitHub
> Pages). לבדיקות מקומיות, גוגל מאפשר גם `http://localhost`.

---

## חלק א׳ — Google Cloud (יצירת ההרשאה)

1. נכנסים ל-<https://console.cloud.google.com> עם חשבון הגוגל של העסק.
2. למעלה: **Select a project → New Project** → שם: `Aya Leads` → **Create**.
3. בתפריט (☰) → **APIs & Services → Library** → מחפשים **Google Calendar API** →
   נכנסים → **Enable**.
4. תפריט → **APIs & Services → OAuth consent screen**:
   - **User Type: External** → **Create**.
   - ממלאים: App name = `מערכת הלידים`, אימייל תמיכה, אימייל מפתח → **Save and Continue**.
   - **Scopes** → **Add or remove scopes** → מדביקים בשורת החיפוש:
     `https://www.googleapis.com/auth/calendar.events` → מסמנים → **Update** → **Save and Continue**.
   - **Test users** → **Add users** → מוסיפים את כתובת הגוגל שלך (וכל מי שיבדוק) → **Save**.
     *(במצב בדיקה מותר עד 100 משתמשים בלי אימות של גוגל. לשלב מסחרי מלא — מגישים
     בקשת אימות לגוגל בהמשך.)*
5. תפריט → **APIs & Services → Credentials → Create Credentials → OAuth client ID**:
   - **Application type: Web application**.
   - **Authorized JavaScript origins** → **Add URI** → כתובת הדשבורד (למשל
     `https://your-app.netlify.app`, ולבדיקות גם `http://localhost:4321`).
   - **Authorized redirect URIs** → **Add URI** → מדביקים בדיוק:
     ```
     https://lmpmnsjzommpvnerouyz.supabase.co/auth/v1/callback
     ```
   - **Create**. נפתח חלון עם **Client ID** ו-**Client Secret** — שומרים את שניהם.

---

## חלק ב׳ — Supabase (הפעלת ההתחברות)

1. נכנסים ל-<https://supabase.com> → הפרויקט.
2. **Authentication → Providers → Google** → מפעילים (**Enable**).
3. מדביקים את **Client ID** ואת **Client Secret** מחלק א׳ → **Save**.
4. **Authentication → URL Configuration**:
   - **Site URL** = כתובת הדשבורד (למשל `https://your-app.netlify.app`).
   - **Redirect URLs** → מוסיפים את אותה כתובת (וגם `http://localhost:4321` לבדיקות).

---

## חלק ג׳ — איך זה עובד אחר כך (למשתמשת)

1. נכנסים לדשבורד → לוחצים **"התחברות עם Google"**.
2. בפעם הראשונה גוגל מבקש אישור גישה ליומן — מאשרים פעם אחת.
   *(אם מופיע מסך "האפליקציה לא מאומתת" בזמן הבדיקות — לוחצים
   Advanced → Go to מערכת הלידים. זה נעלם אחרי אימות גוגל בשלב המסחרי.)*
3. כשליד עובר ל**"סגרה"** → לוחצים **"הוספה ליומן גוגל"** (בכרטיס או בהתראה שקופצת) →
   האירוע נכנס ישר ליומן: **קוביה של שעתיים, 09:00–11:00, בתאריך האירוע**, עם כותרת
   ופרטים אחידים. לחיצה כפולה על אותו ליד **לא** תיצור אירוע כפול.

---

## פתרון תקלות

- **"redirect_uri_mismatch"** — כתובת ה-redirect ב-Google לא זהה לזו של Supabase.
  מוודאים שהודבק בדיוק `https://lmpmnsjzommpvnerouyz.supabase.co/auth/v1/callback`.
- **מתחבר אבל "הוספה ליומן" מבקשת להתחבר שוב** — ההרשאה ליומן לא אושרה, או שפג תוקף
  האסימון. מתחברים שוב עם גוגל ומאשרים את הגישה ליומן.
- **האירוע לא נוסף** — בודקים שה-Google Calendar API מופעל (חלק א׳ שלב 3).
