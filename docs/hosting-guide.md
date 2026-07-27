# אירוח ה-Worker 24/7 — מדריך (Railway)

המדריך מסביר איך להעלות את ה-Worker (המוח שמאזין לוואטסאפ) לענן, כדי שירוץ
**תמיד** — גם כשהמחשב כבוי. עלות: ~5$ לחודש ב-Railway (יש קרדיט התחלתי חינם).

> הכל כבר מוכן בקוד: יש `Dockerfile` שמתקין Chromium ומריץ את ה-Worker.

---

## שלב 1 — פתיחת פרויקט ב-Railway

1. נכנסים ל-<https://railway.app> → **Login with GitHub**.
2. **New Project → Deploy from GitHub repo** → בוחרים את `avi7987/LeadsOrg`.
3. Railway יזהה את ה-`Dockerfile` אוטומטית ויתחיל בנייה. (הבנייה הראשונה ~3–5 דק'.)

## שלב 2 — משתני סביבה (Variables)

בפרויקט → לשונית **Variables** → **New Variable**, מוסיפים אחד-אחד:

| שם | ערך |
|---|---|
| `SUPABASE_URL` | `https://lmpmnsjzommpvnerouyz.supabase.co` |
| `SUPABASE_SERVICE_ROLE_KEY` | *(מעתיקים מהקובץ `worker/.env` שבמחשב — המפתח הסודי)* |
| `DRY_RUN` | `true` *(מצב בדיקה — נשנה ל-`false` בסוף)* |
| `WA_SESSION_PATH` | `/app/.wwebjs_auth` |

## שלב 3 — Volume (שמירת חיבור הוואטסאפ)

כדי שלא תצטרכי לסרוק QR בכל פריסה מחדש:
1. בפרויקט → **New → Volume** (או בשירות → **Volumes**).
2. **Mount path:** `/app/.wwebjs_auth`
3. שומרים. (החיבור לוואטסאפ יישמר על ה-Volume לתמיד.)

## שלב 4 — כתובת ציבורית (לסריקת ה-QR)

1. בשירות → **Settings → Networking → Generate Domain**.
2. נוצרת כתובת כמו `https://leadsorg-production.up.railway.app`.

## שלב 5 — קישור הוואטסאפ (פעם אחת)

1. פותחים את הכתובת מהשלב הקודם בדפדפן.
2. מופיע **קוד QR**. בטלפון של איה: **וואטסאפ → הגדרות → מכשירים מקושרים → קישור מכשיר → סורקים**.
3. הדף יעבור ל"✅ מחובר". מרגע זה ה-Worker רץ 24/7 ומאזין.

## שלב 6 — מעבר למצב חי (כשמוכנים)

עד עכשיו `DRY_RUN=true` (מזהה לידים אבל לא שולח פופ-אפים אמיתיים ללקוחות).
כשרוצים לצאת חי:
1. **Variables** → משנים `DRY_RUN` ל-`false` → Railway יפרוס מחדש אוטומטית.
2. מעכשיו לקוחות אמיתיות יקבלו את הפופ-אפ. 🚀

---

## תקלות נפוצות

- **הבנייה נכשלת על Chromium/puppeteer** — ודאי ש-Railway משתמש ב-`Dockerfile` (ולא ב-Nixpacks). בדרך כלל אוטומטי.
- **סורקים QR אבל מתנתק** — כנראה אין Volume (שלב 3). בלי Volume החיבור נמחק בכל פריסה.
- **הדף לא נטען** — ודאי ש-Generate Domain בוצע (שלב 4) ושהבנייה הסתיימה.
