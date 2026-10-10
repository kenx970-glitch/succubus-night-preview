import test from 'node:test';
import assert from 'node:assert/strict';
import WebSocket,{WebSocketServer} from 'ws';
import {once} from 'node:events';
import {createApp} from '../src/server.mjs';
import {PcmEncoder,decodePcm} from '../public/live-audio.mjs';

function messages(ws){
 const queue=[],waiting=[];ws.on('message',(data,binary)=>{const value=binary?{type:'audio',bytes:Buffer.from(data)}:JSON.parse(data.toString());const i=waiting.findIndex(w=>w.type===value.type);if(i<0)queue.push(value);else {const w=waiting.splice(i,1)[0];clearTimeout(w.timer);w.resolve(value);}});
 return type=>{const i=queue.findIndex(v=>v.type===type);if(i>=0)return Promise.resolve(queue.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={type,resolve,reject};w.timer=setTimeout(()=>{waiting.splice(waiting.indexOf(w),1);reject(new Error('Missing socket event: '+type));},2500);waiting.push(w);});};
}
async function fixture(t,live={}){
 const upstream=new WebSocketServer({port:0,host:'127.0.0.1'});await once(upstream,'listening');const peers=[],requests=[];
 upstream.on('connection',ws=>{peers.push(ws);ws.on('message',data=>{const m=JSON.parse(data.toString());requests.push(m);if(m.setup)ws.send(JSON.stringify({setupComplete:{}}));});});
 let opens=0;const app=createApp({port:0,dbPath:':memory:',voiceBackend:'gemini-live',live:{apiKey:'fixture-never-google',socketFactory:()=>{opens++;return new WebSocket('ws://127.0.0.1:'+upstream.address().port);},...live}}),origin=await app.listen();
 const clients=[];t.after(async()=>{await app.close();for(const ws of clients)ws.terminate();for(const ws of upstream.clients)ws.terminate();await new Promise(r=>upstream.close(r));});
 let cookie,csrf;
 const call=async(path,body,overrides={})=>{const r=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(cookie?{Cookie:cookie}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...overrides},body:body===undefined?undefined:JSON.stringify(body)});if(r.headers.get('set-cookie'))cookie=r.headers.get('set-cookie').split(';')[0];const data=await r.json();if(data.csrfToken)csrf=data.csrfToken;return {status:r.status,data};};
 await call('/api/session');const reg=await call('/api/auth/register',{name:'Liveテスト',password:'long-live-test-password'}),user=reg.data.user;
 app.economy._tx(()=>app.economy._writeLedger(user.id,'S',500,'fixture','live-test'));app.economy._tx(()=>app.economy._writeLedger(user.id,'G',1000,'fixture','live-test-g'));
 const body={key:'live_session_fixture',castId:'luna',priceS:5,adultConfirmed:true,consent:true};
 const open=async(extra={})=>{const r=await call('/api/live/session',{...body,...extra});assert.equal(r.status,200,JSON.stringify(r.data));const ws=new WebSocket(origin.replace('http:','ws:')+r.data.socketPath,{headers:{Origin:origin,Cookie:cookie}});clients.push(ws);const next=messages(ws);await next('ready');return {ws,next,path:r.data.socketPath};};
 return {app,origin,user,call,open,body,requests,peers,clients,get cookie(){return cookie;},get opens(){return opens;},reply(value){peers.at(-1).send(JSON.stringify(value));},wallet(){return app.economy.state(user.id).wallet;}};
}
const begin=(ws,key='live_audio_fixture')=>ws.send(JSON.stringify({type:'begin',key,priceS:5}));
function pcm(samples=1600,amplitude=6000){const b=Buffer.alloc(samples*2);for(let i=0;i<samples;i++)b.writeInt16LE(Math.round(Math.sin(i*.1)*amplitude),i*2);return b;}
const complete=h=>h.reply({serverContent:{outputTranscription:{text:'いいね！今日はどんな一日だった？'},modelTurn:{parts:[{inlineData:{mimeType:'audio/pcm;rate=24000',data:pcm(1200).toString('base64')}},{inlineData:{mimeType:'audio/pcm;rate=24000',data:pcm(800).toString('base64')}}]},turnComplete:true},usageMetadata:{promptTokenCount:70,responseTokenCount:50,totalTokenCount:120}});

test('default requires a Google key and never falls back to a configured Fal account',async t=>{
 const h=await fixture(t,{apiKey:''});const s=await h.call('/api/session');assert.equal(s.data.capabilities.aiProvider,'gemini-live');assert.equal(s.data.capabilities.ai,false);assert.equal(s.data.capabilities.realtime,false);
 assert.equal((await h.call('/api/live/session',h.body)).status,503);assert.equal((await h.call('/api/chat',{key:'legacy_chat_test',castId:'luna',text:'こんにちは',priceS:5})).status,503);assert.equal(h.opens,0);assert.equal(h.wallet().S,500);
});
test('session requires price, adult confirmation, CSRF and Origin before connecting or charging',async t=>{
 const h=await fixture(t);assert.equal((await h.call('/api/live/session',{...h.body,adultConfirmed:false})).status,400);assert.equal((await h.call('/api/live/session',{...h.body,priceS:1})).status,409);assert.equal((await h.call('/api/live/session',h.body,{'X-CSRF-Token':'invalid'})).status,403);assert.equal((await h.call('/api/live/session',h.body,{Origin:'https://other.invalid'})).status,403);assert.equal(h.opens,0);assert.equal(h.wallet().S,500);
});
test('native audio is reserved before streaming, plays multiple parts, persists once and replays for free',async t=>{
 const h=await fixture(t),{ws,next}=await h.open();assert.equal(h.wallet().S,500);assert.equal(h.requests[0].setup.model,'models/gemini-3.8-live');assert.equal(h.requests[0].setup.generationConfig.speechConfig.voiceConfig.prebuiltVoiceConfig.voiceName,'Aoede');assert.equal(h.requests[0].setup.realtimeInputConfig.automaticActivityDetection.disabled,true);
 begin(ws);const reserved=await next('reserved');assert.equal(reserved.state.wallet.S,495);begin(ws);ws.send(pcm());ws.send(JSON.stringify({type:'end',key:'live_audio_fixture'}));
 await new Promise(r=>setTimeout(r,25));assert.equal(h.requests.filter(m=>m.realtimeInput?.activityStart).length,1);assert.equal(h.requests.filter(m=>m.realtimeInput?.activityEnd).length,1);assert.equal(h.wallet().S,495);
 h.reply({serverContent:{inputTranscription:{text:'今日は散歩したよ'}}});complete(h);const first=await next('audio'),second=await next('audio'),done=await next('complete');assert.equal(first.bytes.length,2400);assert.equal(second.bytes.length,1600);assert.equal(done.result.source,'gemini-live');assert.equal(done.result.inputText,'今日は散歩したよ');assert.equal(done.result.state.wallet.S,495);assert.equal(done.result.state.wallet.G,1000);
 const r=await fetch(h.origin+done.result.audioUrl,{headers:{Cookie:h.cookie}}),bytes=Buffer.from(await r.arrayBuffer());assert.equal(r.status,200);assert.equal(bytes.readUInt32LE(24),24000);assert.equal(bytes.length,4044);
 const history=h.app.economy.db.prepare('SELECT * FROM live_usage').all();assert.equal(history.length,1);assert.equal(history[0].status,'complete');assert.equal(JSON.parse(history[0].usage_json).totalTokenCount,120);
 begin(ws);const replay=await next('complete');assert.equal(replay.replay,true);assert.equal(replay.result.voiceId,done.result.voiceId);assert.equal(h.wallet().S,495);assert.equal(h.requests.filter(m=>m.realtimeInput?.activityStart).length,1);
 const other=await fetch(h.origin+done.result.audioUrl);assert.equal(other.status,401);
});
test('audio without a reservation is rejected without sending it to Google',async t=>{
 const h=await fixture(t),{ws,next}=await h.open();ws.send(pcm());const error=await next('error');assert.equal(error.code,'LIVE_INPUT_NOT_RESERVED');assert.equal(h.wallet().S,500);assert.equal(h.requests.some(m=>m.realtimeInput?.audio),false);
});
test('disconnect releases an in-flight reservation once and records the failed attempt for limits',async t=>{
 const h=await fixture(t),{ws,next}=await h.open();begin(ws);const r=await next('reserved');assert.equal(h.wallet().S,495);ws.close();await new Promise(r=>setTimeout(r,30));assert.equal(h.wallet().S,500);assert.equal(h.app.voice.get(h.user.id,r.voiceId).status,'failed');h.app.voice.recoverInterrupted();assert.equal(h.wallet().S,500);assert.equal(h.app.economy.state(h.user.id).ledger.filter(l=>l.kind==='voice_release').length,1);
});
test('a second request cannot create an overlapping charged response',async t=>{
 const h=await fixture(t),{ws,next}=await h.open();begin(ws);await next('reserved');begin(ws,'another_live_turn');assert.equal((await next('error')).code,'LIVE_TURN_BUSY');assert.equal(h.wallet().S,500);assert.equal(h.app.voice.history(h.user.id).length,1);
});
test('silence and server duration limits return S and close the provider connection',async t=>{
 const h=await fixture(t,{maxInputSeconds:.2}),{ws,next}=await h.open();begin(ws);await next('reserved');ws.send(pcm(4000));assert.equal((await next('error')).code,'INPUT_TOO_LONG');assert.equal(h.wallet().S,500);
 const {ws:quiet,next:q}=await h.open();begin(quiet,'silent_voice_test');await q('reserved');quiet.send(pcm(1600,0));quiet.send(JSON.stringify({type:'end',key:'silent_voice_test'}));assert.equal((await q('error')).code,'NO_SPEECH');assert.equal(h.wallet().S,500);
});
test('response timeout and provider failures cannot leave paid reservations pending',async t=>{
 const h=await fixture(t,{responseTimeoutMs:80}),{ws,next}=await h.open();ws.send(JSON.stringify({type:'text',text:'こんにちは',key:'live_timeout_test',priceS:5}));await next('reserved');assert.equal((await next('error')).code,'LIVE_TURN_TIMEOUT');assert.equal(h.wallet().S,500);
 const {ws:w2,next:n2}=await h.open();begin(w2,'provider_fails_test');await n2('reserved');h.reply({error:{message:'provider fixture secret'}});const error=await n2('error');assert.equal(error.code,'GEMINI_PROVIDER_ERROR');assert.ok(!JSON.stringify(error).includes('provider fixture secret'));assert.equal(h.wallet().S,500);
});
test('output length and forbidden transcript stop streaming and release S',async t=>{
 const h=await fixture(t,{maxOutputSeconds:.05}),{ws,next}=await h.open();ws.send(JSON.stringify({type:'text',text:'こんにちは',key:'live_output_limit',priceS:5}));await next('reserved');complete(h);assert.equal((await next('error')).code,'LIVE_RESPONSE_TOO_LONG');assert.equal(h.wallet().S,500);
 const {ws:w2,next:n2}=await h.open();w2.send(JSON.stringify({type:'text',text:'こんにちは',key:'live_safety_stop',priceS:5}));await n2('reserved');h.reply({serverContent:{outputTranscription:{text:'課金しないなら見捨てる'}}});assert.equal((await n2('error')).code,'LIVE_SAFETY_STOP');assert.equal(h.wallet().S,500);
});
test('daily operator limits include failed attempts and one-time tickets cannot be reused',async t=>{
 const h=await fixture(t,{dailyMaxTurns:1}),{ws,next,path}=await h.open();begin(ws);await next('reserved');ws.send(JSON.stringify({type:'stop'}));await next('session_end');assert.equal(h.wallet().S,500);assert.equal((await h.call('/api/live/session',h.body)).status,429);
 const rejected=new WebSocket(h.origin.replace('http:','ws:')+path,{headers:{Origin:h.origin,Cookie:h.cookie}});rejected.on('error',()=>{});h.clients.push(rejected);const [,response]=await once(rejected,'unexpected-response');assert.equal(response.statusCode,403);response.resume();rejected.terminate();assert.equal(h.opens,1);
});
test('logout closes the active provider and refunds unfinished voice',async t=>{
 const h=await fixture(t),{ws,next}=await h.open();begin(ws);await next('reserved');assert.equal((await h.call('/api/auth/logout',{})).status,200);await next('session_end');assert.equal(h.wallet().S,500);assert.equal(h.app.live.rooms.size,0);
});
test('insufficient S and paid-currency holds reject setup before any provider call',async t=>{
 const h=await fixture(t);h.app.economy._tx(()=>h.app.economy._writeLedger(h.user.id,'S',-500,'fixture','spend-all'));assert.equal((await h.call('/api/live/session',h.body)).status,409);assert.equal(h.opens,0);assert.equal(h.wallet().G,1000);
});
test('resampling retains timing across microphone blocks and PCM decode preserves signed samples',()=>{
 for(const rate of [16000,44100,48000]){const encoder=new PcmEncoder(rate);let samples=0;for(let offset=0;offset<rate;offset+=2048){const input=new Float32Array(Math.min(2048,rate-offset));input.fill(.25);const bytes=encoder.push(input);const output=decodePcm(bytes);assert.ok(output.every(v=>Math.abs(v-.25)<.0001));samples+=output.length;}assert.ok(Math.abs(samples-16000)<=1,`${rate}: ${samples}`);}
 const v=new DataView(new ArrayBuffer(4));v.setInt16(0,-32768,true);v.setInt16(2,32767,true);assert.deepEqual([...decodePcm(v.buffer)],[-1,32767/32768]);
});
test('WebSocket origin and owner checks reject a stolen ticket before Google connection',async t=>{
 const h=await fixture(t),ticket=await h.call('/api/live/session',h.body);assert.equal(ticket.status,200);
 for(const headers of [{Origin:'https://other.invalid',Cookie:h.cookie},{Origin:h.origin}]){
  const ws=new WebSocket(h.origin.replace('http:','ws:')+ticket.data.socketPath,{headers});h.clients.push(ws);ws.on('error',()=>{});const [,response]=await once(ws,'unexpected-response');assert.equal(response.statusCode,403);response.resume();ws.terminate();
 }
 assert.equal(h.opens,0);assert.equal(h.wallet().S,500);
});
