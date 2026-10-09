import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.env.DATABASE_PATH||'data/succubus.sqlite');
const rows=db.prepare('SELECT created_at,cost_usd,input_tokens,output_tokens FROM ai_costs ORDER BY created_at DESC LIMIT 20').all();
console.table(rows.map(r=>({at:new Date(r.created_at).toISOString(),reportedUSD:r.cost_usd,estimateJPYat150:r.cost_usd*150,inputTokens:r.input_tokens,outputTokens:r.output_tokens})));
console.log('Successful Fal text responses + safety check only. Provider-reported reference cost; not a final invoice. TTS, failures, starter assets and hosting are not included.');
db.close();
