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

// סיווג סוג השירות לרשומה מסודרת (שומר גם את הניסוח המקורי)
export function classifyService(s) {
  const raw = (s || '').trim();
  const t = raw.toLowerCase();
  const makeup = /איפור|מייקאפ|make\s*up/.test(t);
  const hair   = /שיער|תסרוק|תספורת|פן|בלונד|החלקה/.test(t);
  const both   = /שתיהן|שתיים|שניהם|גם.?וגם|הכל|חבילה מלאה|המלאה|שילוב|ביחד|שתיהם/.test(t);
  const bride  = /כלה|מתחתנת|חתונה/.test(t);
  let label = raw;
  if (both || (makeup && hair)) label = 'איפור + תסרוקת';
  else if (makeup) label = 'איפור';
  else if (hair)   label = 'תסרוקת';
  else if (bride)  label = 'כלה';
  return { label, raw };
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
