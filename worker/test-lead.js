// =====================================================================
//  test-lead.js — בדיקה: מזריק הודעה נכנסת מדומה ל"מוח" (logic.js)
//  שימוש:  node test-lead.js  ["טקסט ההודעה"]  ["שם הלקוחה"]
//  יוצר מספר אקראי בכל הרצה (כדי שזו תמיד "שיחה ראשונה").
// =====================================================================
import 'dotenv/config';
import { handleIncoming } from './src/logic.js';

const body = process.argv[2] || 'היי, אני מחפשת איפור לאירוע 💕';
const name = process.argv[3] || 'לקוחת בדיקה';
const phone = '9725' + Math.floor(10000000 + Math.random() * 89999999); // מספר "לא שמור" חדש

// מדמה client של whatsapp-web.js (רק כדי שלא ייפול; במצב DRY_RUN ממילא לא נשלח כלום)
const client = {
  sendMessage: async (to, text) => console.log(`   (מדמה שליחה ל-${to}): ${text}`),
};

// מדמה אובייקט הודעה נכנסת
const msg = {
  fromMe: false,
  body,
  getChat:    async () => ({ isGroup: false }),
  getContact: async () => ({ number: phone, pushname: name, isMyContact: false }),
};

console.log(`\n📨 מדמה הודעה נכנסת ממספר לא-שמור +${phone}:`);
console.log(`   "${body}"\n`);
await handleIncoming({ client, msg });
console.log('\n✅ בוצע. רענני את הדשבורד — אמור להופיע ליד חדש.\n');
process.exit(0);
