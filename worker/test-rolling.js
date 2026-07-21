// בדיקה: מוודא ששיחת בדיקה (__test) שולחת באמת (force) ומתגלגלת אחת-אחת
import 'dotenv/config';
import { handleIncoming } from './src/logic.js';
const { createClient } = await import('@supabase/supabase-js');
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

const phone = '9725' + Math.floor(10000000 + Math.random() * 89999999);
const { data: lead } = await sb.from('leads')
  .insert({ source: 'הודעת פופ-אפ', phone, note: '🧪 בדיקה', status: 'new' }).select().single();
await sb.from('popup_sessions').upsert({ phone, lead_id: lead.id, step: 0, answers: { __test: true } });

const sent = [];
const client = { sendMessage: async (_to, t) => sent.push(t) };  // רק שליחות אמת מגיעות לכאן
const mk = b => ({ fromMe: false, body: b, getChat: async () => ({ isGroup: false }), getContact: async () => ({ number: phone, pushname: '', isMyContact: false }) });

for (const line of ['נועה כהן', '20 בספטמבר', 'רק איפור']) {
  const before = sent.length;
  await handleIncoming({ client, msg: mk(line) });
  console.log(`👰 "${line}"  →  נשלחו ${sent.length - before} הודעות אמת בתגובה`);
}
console.log('\n📤 סה"כ הודעות אמת שנשלחו (force):', sent.length);
sent.forEach((s, i) => console.log(`   ${i + 1}. ${s}`));
const { data: f } = await sb.from('leads').select('name,event_date,service,note').eq('id', lead.id).single();
console.log('\n📋 ליד סופי:', JSON.stringify(f, null, 1));
process.exit(0);
