import {DatabaseSync} from 'node:sqlite';
const db=new DatabaseSync(process.env.DATABASE_PATH||'data/succubus.sqlite');
const rows=db.prepare('SELECT created_at,cost_usd,input_tokens,output_tokens FROM ai_costs ORDER BY created_at DESC LIMIT 20').all();
console.table(rows.map(r=>({at:new Date(r.created_at).toISOString(),reportedUSD:r.cost_usd,estimateJPYat150:r.cost_usd*150,inputTokens:r.input_tokens,outputTokens:r.output_tokens})));
console.log('Successful Fal text responses + safety check only. Provider-reported reference cost; not a final invoice. TTS, failures, starter assets and hosting are not included.');
if(db.prepare("SELECT name FROM sqlite_master WHERE name='live_usage'").get()){
 const live=db.prepare('SELECT created_at,status,model,first_audio_ms,usage_json FROM live_usage ORDER BY created_at DESC LIMIT 20').all();
 console.table(live.map(r=>{let usage={};try{usage=JSON.parse(r.usage_json)||{};}catch{}return {at:new Date(r.created_at).toISOString(),model:r.model,status:r.status,firstAudioMs:r.first_audio_ms,inputTokens:usage.promptTokenCount??null,outputTokens:usage.responseTokenCount??usage.candidatesTokenCount??null,totalTokens:usage.totalTokenCount??null};}));
 console.log('Gemini Live reports and response latency only. Token totals are not a dollar invoice; check Google usage/billing for exact charges. Failed starts also count toward test limits.');
}
db.close();
