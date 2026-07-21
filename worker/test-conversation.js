// בדיקה מקצה-לקצה: מדמה שיחה שלמה עם לקוחה (טקסט חופשי) ומראה את הליד שנרשם
import 'dotenv/config';
import { handleIncoming } from './src/logic.js';

const phone = '9725' + Math.floor(10000000 + Math.random() * 89999999);
const client = { sendMessage: async (_to, t) => console.log('   🤖 בוט →', t) };
const mk = body => ({
  fromMe: false, body,
  getChat: async () => ({ isGroup: false }),
  getContact: async () => ({ number: phone, pushname: '', isMyContact: false }),
});

// לקוחה שכותבת בצורה חופשית ומבולגנת (כמו במציאות)
const script = [
  'היי ראיתי אותך באינסטגרם, אני מתחתנת ומחפשת איפור לחתונה',
  'קוראים לי נועה כהן 😊',
  'זה יהיה ב15 באוגוסט',
  'בא לי גם איפור וגם תסרוקת, החבילה המלאה',
];

for (const line of script) {
  console.log('\n👰 לקוחה:', line);
  await handleIncoming({ client, msg: mk(line) });
  await new Promise(r => setTimeout(r, 300));
}

const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
const { data } = await sb.from('leads').select('name,event_date,service,source,note').eq('phone', phone).single();
console.log('\n📋 ===== הליד שנרשם אוטומטית בטבלה =====');
console.log(JSON.stringify(data, null, 1));
process.exit(0);
