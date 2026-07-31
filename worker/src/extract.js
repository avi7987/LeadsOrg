// =====================================================================
//  extract.js — זיהוי חכם של תשובות הפופ-אפ → שדות מדויקים לליד
//  (מבוסס כללים, חינמי ומיידי. אפשר בהמשך לחזק עם שכבת AI.)
// =====================================================================

// מחליף משתנים בתבנית ({{name}}) בערכים שנאספו — לשיחה אישית ומתגלגלת
export function fill(text, answers = {}) {
  const name = cleanName(answers.name);
  return (text || '').replace(/\{\{\s*name\s*\}\}/g, name || 'יקרה');
}

// ניקוי שם מפתיחות מיותרות ("קוראים לי...", "היי, אני...")
export function cleanName(s) {
  if (!s) return '';
  let t = s.trim();
  t = t.replace(/^(היי+|שלום|אהלן|הי)\s*[,!.]*\s*/i, '');
  t = t.replace(/^(שמי|קוראים לי|השם שלי הוא|השם שלי|אני|זאת|זו)\s+/i, '');
  t = t.replace(/[.!,😊💕🌸💫✨🙂👋]+/g, ' ').trim();
  return t.split(/\s+/).slice(0, 3).join(' ');
}

// זיהוי כלה — מטרת-על. בודק בכל טקסט זמין (הודעה, תשובות, שירות)
export function detectBride(text) {
  return /כלה|כלות|מתחתנת|החתונה|חתונתי|כלולה|כלולות|נישואי|bride/i.test(text || '');
}

// סיווג סוג השירות לרשומה מסודרת (שומר גם את הניסוח המקורי)
// matched=true רק אם באמת זוהה שירות (ולא סתם הועתק הטקסט) — משמש לדילוג על שאלות מיותרות
export function classifyService(s) {
  const raw = (s || '').trim();
  const t = raw.toLowerCase();
  const makeup = /איפור|מייקאפ|make\s*up/.test(t);
  const hair   = /שיער|תסרוק|תספורת|פן|בלונד|החלקה/.test(t);
  const both   = /שתיהן|שתיים|שניהם|גם.?וגם|הכל|חבילה מלאה|המלאה|שילוב|ביחד|שתיהם/.test(t);
  const bride  = /כלה|מתחתנת|חתונה/.test(t);
  let label = raw, matched = true;
  if (both || (makeup && hair)) label = 'איפור + תסרוקת';
  else if (makeup) label = 'איפור';
  else if (hair)   label = 'תסרוקת';
  else if (bride)  label = 'כלה';
  else matched = false;
  return { label, raw, matched };
}

// ---------- זיהוי נתונים מתוך הודעה חופשית (לדילוג על שאלות שאין בהן צורך) ----------

// שם — רק כשהלקוחה מציגה את עצמה במפורש ("קוראים לי X" / "שמי X"), כדי לא לטעות
export function extractNameExplicit(text) {
  const m = (text || '').match(/(?:קוראים לי|שמי|השם שלי(?:\s+הוא)?)\s+([א-תa-zA-Z]{2,}(?:\s+[א-תa-zA-Z]{2,})?)/i);
  return m ? cleanName(m[1]) : '';
}

// תאריך — רק אם יש ממש רמז לתאריך בטקסט (מספרי או שם חודש עברי)
export function extractDateHint(text) {
  const raw = (text || '').trim();
  if (!raw) return '';
  const numeric = /(\d{1,2})\s*[.\/\-]\s*(\d{1,2})(?:\s*[.\/\-]\s*(\d{2,4}))?/.test(raw);
  const hebMonth = Object.keys(HE_MONTHS).some(m => raw.includes(m));
  if (!numeric && !hebMonth) return '';
  const out = normalizeDate(raw);
  return out === raw && !numeric && !hebMonth ? '' : out;
}

// תשובה אחת שמכילה גם תאריך וגם מקום → מפרקת לשניהם
// ("20.9 באולם הגן הקסום בראשל״צ" → date: "20.9", place: "אולם הגן הקסום בראשל״צ")
// מילים שאינן חלק מהמקום — מסוננות כמילים שלמות בלבד (כדי לא לפגוע ב"ירושלים"/"ראשל״צ")
const PLACE_NOISE = new Set(['תאריך','בתאריך','יום','בערך','בסביבות','בחודש','החתונה','האירוע','האירועים',
  'תהיה','יהיה','מתקיים','מתקיימת','נערך','נערכת','זה','של','שלנו','אצל','לנו','אנחנו','עדיין','לא',
  'יודעת','יודע','בטוחה','בטוח','איפה','מתי','עוד','אולי','כנראה','נראה','ליד','את','אני','הוא','היא']);

export function splitDateAndPlace(text) {
  const raw = (text || '').trim();
  if (!raw) return { date: '', place: '' };
  const date = extractDateHint(raw);
  let place = raw;
  place = place.replace(/(\d{1,2})\s*[.\/\-]\s*(\d{1,2})(?:\s*[.\/\-]\s*(\d{2,4}))?/g, ' ');   // תאריך מספרי
  place = place.replace(/\d+/g, ' ').replace(/[,\-–—]/g, ' ');                                  // מספרים ופיסוק
  // סינון ברמת מילה שלמה (כולל שמות חודשים ומילות קישור)
  place = place.split(/\s+/)
    .filter(w => w && w.length > 1 && !PLACE_NOISE.has(w) && !HE_MONTHS[w] && !HE_MONTHS[w.replace(/^ב/, '')])
    .join(' ').trim();
  if (place.replace(/[^א-תa-zA-Z]/g, '').length < 2) place = '';
  return { date, place };
}

// טקסט חופשי → תאריך אמיתי (Date). אם אין שנה — בוחר את המופע הבא בעתיד.
export function parseEventDate(text) {
  const raw = (text || '').trim();
  if (!raw) return null;
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const mk = (d, mo, y) => { const dt = new Date(y, mo - 1, d); return isNaN(dt.getTime()) ? null : dt; };
  const future = (d, mo) => { let dt = mk(d, mo, today.getFullYear()); if (dt && dt < today) dt = mk(d, mo, today.getFullYear() + 1); return dt; };
  const m = raw.match(/(\d{1,2})\s*[.\/\-]\s*(\d{1,2})(?:\s*[.\/\-]\s*(\d{2,4}))?/);
  if (m) {
    const d = +m[1], mo = +m[2]; let y = m[3] ? +m[3] : null; if (y && y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) return y ? mk(d, mo, y) : future(d, mo);
  }
  for (const [name, mo] of Object.entries(HE_MONTHS)) {
    if (raw.includes(name)) {
      const dm = raw.match(/(\d{1,2})/); const ym = raw.match(/(20\d{2})/);
      return ym ? mk(dm ? +dm[1] : 1, mo, +ym[1]) : future(dm ? +dm[1] : 1, mo);
    }
  }
  return null;
}

// נירמול תאריך לטקסט קריא (אם לא זוהה — שומר את המקור כפי שהוא)
const HE_MONTHS = {
  'ינואר':1,'פברואר':2,'מרץ':3,'מרס':3,'אפריל':4,'מאי':5,'יוני':6,
  'יולי':7,'אוגוסט':8,'ספטמבר':9,'אוקטובר':10,'נובמבר':11,'דצמבר':12,
};
export function normalizeDate(s) {
  const raw = (s || '').trim();
  if (!raw) return '';
  // פורמט מספרי: 15.8 / 15/8/26 / 15-08-2026
  const m = raw.match(/(\d{1,2})\s*[.\/\-]\s*(\d{1,2})(?:\s*[.\/\-]\s*(\d{2,4}))?/);
  if (m) {
    const d = +m[1], mo = +m[2];
    let y = m[3] ? +m[3] : null; if (y && y < 100) y += 2000;
    if (d >= 1 && d <= 31 && mo >= 1 && mo <= 12) {
      return y ? `${d}.${mo}.${String(y).slice(2)}` : `${d}.${mo}`;
    }
  }
  // שם חודש בעברית: "15 באוגוסט" / "אוגוסט"
  for (const [name, mo] of Object.entries(HE_MONTHS)) {
    if (raw.includes(name)) { const dm = raw.match(/(\d{1,2})/); return dm ? `${+dm[1]}.${mo}` : name; }
  }
  return raw;
}
