import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHmac,randomUUID} from 'node:crypto';
import {createApp} from '../src/server.mjs';
import {Economy} from '../src/economy.mjs';
import {StripeTest,verifyWebhook} from '../src/stripe.mjs';
const secret='whsec_local_test_signature';
test('mobile modules, compressed fonts and streamed video support HEAD and byte ranges',async t=>{
 const app=createApp({port:0,dbPath:':memory:'});const origin=await app.listen();t.after(()=>app.close());
 for(const path of ['/mobile.css','/reward-viewer.mjs','/fonts/NotoSansJP.woff2','/fonts/ZenMaruGothic-Medium.woff2']){
  const r=await fetch(origin+path,{method:'HEAD'});assert.equal(r.status,200);assert.ok(Number(r.headers.get('content-length'))>0);assert.equal((await r.arrayBuffer()).byteLength,0);
 }
 const r=await fetch(origin+'/media/luna-idle.mp4',{headers:{Range:'bytes=0-1023'}});assert.equal(r.status,206);assert.match(r.headers.get('content-range'),/^bytes 0-1023\/\d+$/);assert.equal((await r.arrayBuffer()).byteLength,1024);assert.match(r.headers.get('cache-control'),/immutable/);
 const bad=await fetch(origin+'/media/luna-idle.mp4',{headers:{Range:'bytes=9999999999-'}});assert.equal(bad.status,416);
});
function sign(raw,age=0){const t=Math.floor(Date.now()/1000)+age;return `t=${t},v1=${createHmac('sha256',secret).update(t+'.').update(raw).digest('hex')}`;}
function provider(){
 const sessions=new Map(),requests=[],refunds=new Map(),disputes=new Map();let requestsFail=false;
 const fetchImpl=async(url,options)=>{
  if(requestsFail)throw new Error('simulated network break');
  const path=new URL(url).pathname,params=new URLSearchParams(options.body||new URL(url).search.slice(1));
  requests.push({path,params,key:options.headers['Idempotency-Key']});let data;
  if(path==='/v1/checkout/sessions'&&options.method==='POST'){
   const id='cs_test_'+params.get('client_reference_id').replaceAll('-','');
   data=sessions.get(id)||{id,livemode:false,status:'open',payment_status:'unpaid',currency:params.get('line_items[0][price_data][currency]'),amount_total:Number(params.get('line_items[0][price_data][unit_amount]')),client_reference_id:params.get('client_reference_id'),metadata:{purchaseId:params.get('metadata[purchaseId]'),userId:params.get('metadata[userId]'),packId:params.get('metadata[packId]')},payment_intent:null,url:'https://checkout.stripe.com/c/pay/'+id};sessions.set(id,data);
  }else if(path.startsWith('/v1/checkout/sessions/'))data=sessions.get(path.split('/').at(-1));
  else if(path==='/v1/checkout/sessions')data={data:[...sessions.values()],has_more:false};
  else if(path.startsWith('/v1/payment_intents/')){const id=path.split('/').at(-1),s=[...sessions.values()].find(s=>s.payment_intent===id);data=s&&{id,livemode:false,currency:s.currency,amount:s.amount_total,metadata:{purchaseId:s.client_reference_id},latest_charge:'ch_'+id.slice(3)};}
  else if(path.startsWith('/v1/charges/')){const id=path.split('/').at(-1),s=[...sessions.values()].find(s=>'ch_'+s.payment_intent?.slice(3)===id);data=s&&{id,livemode:false,currency:s.currency,amount:s.amount_total,payment_intent:s.payment_intent};}
  else if(path==='/v1/refunds'){data={data:[...refunds.values()].filter(r=>r.charge===params.get('charge')),has_more:false};}
  else if(path.startsWith('/v1/refunds/'))data=refunds.get(path.split('/').at(-1));
  else if(path==='/v1/disputes'){data={data:[...disputes.values()].filter(d=>d.payment_intent===params.get('payment_intent')),has_more:false};}
  else if(path.startsWith('/v1/disputes/'))data=disputes.get(path.split('/').at(-1));
  return {ok:!!data,json:async()=>data||{error:{message:'not found'}}};
 };
 const stripe=new StripeTest({secretKey:'sk_test_local_only',webhookSecret:secret,fetchImpl,origin:'http://127.0.0.1:0'});
 return {stripe,sessions,requests,refunds,disputes,setFail(v){requestsFail=v;},pay(id){const s=sessions.get(id);Object.assign(s,{status:'complete',payment_status:'paid',payment_intent:'pi_'+s.client_reference_id.replaceAll('-','')});return s;}};
}
async function setup(t,extras={}){
 const fake=provider(),economy=extras.economy||new Economy(':memory:',{allowFastJobs:true}),app=createApp({port:0,dbPath:':memory:',economy,stripe:fake.stripe,...extras});
 const origin=await app.listen();t.after(()=>app.close());
 let token,csrf;
 async function call(path,body,overrides={}){
  const response=await fetch(origin+path,{method:body===undefined?'GET':'POST',headers:{...(token?{Cookie:token}:{}),...(body===undefined?{}:{Origin:origin,'Content-Type':'application/json','X-CSRF-Token':csrf}),...overrides},body:body===undefined?undefined:JSON.stringify(body)});
  const set=response.headers.get('set-cookie');if(set)token=set.split(';')[0];
  const data=await response.json();if(data.csrfToken)csrf=data.csrfToken;return {status:response.status,data};
 }
 await call('/api/session');
 const reg=await call('/api/auth/register',{name:'テスト_'+randomUUID().slice(0,6),password:'long-test-password-123'});assert.equal(reg.status,200);
 const user=reg.data.user;
 async function event(type,object,id='evt_'+randomUUID().replaceAll('-','')){const raw=Buffer.from(JSON.stringify({id,livemode:false,type,data:{object}}));const r=await fetch(origin+'/api/webhooks/stripe',{method:'POST',headers:{'Stripe-Signature':sign(raw),'Content-Type':'application/json'},body:raw});return {status:r.status,data:await r.json(),id};}
 return {app,fake,origin,call,event,user,get token(){return token;}};
}
test('signature checks raw payload, signed timestamp, secret, event id and test mode',()=>{
 const raw=Buffer.from(JSON.stringify({id:'evt_signed',livemode:false,data:{object:{id:'cs_test_fake'}}}));
 assert.equal(verifyWebhook(raw,sign(raw),secret).id,'evt_signed');
 assert.throws(()=>verifyWebhook(Buffer.from(raw.toString()+' '),sign(raw),secret),{code:'INVALID_SIGNATURE'});
 assert.throws(()=>verifyWebhook(raw,sign(raw,-400),secret),{code:'INVALID_SIGNATURE'});
 assert.throws(()=>verifyWebhook(raw,'t=1,v1=bad',secret),{code:'INVALID_SIGNATURE'});
 const live=Buffer.from(JSON.stringify({id:'evt_live',livemode:true,data:{object:{}}}));assert.throws(()=>verifyWebhook(live,sign(live),secret),{code:'LIVE_REJECTED'});
 assert.throws(()=>new StripeTest({secretKey:'sk_live_rejected'}),{code:'LIVE_REJECTED'});
});
test('checkout -> signed provider event -> S credit -> item, replay never double charges',async t=>{
 const h=await setup(t);
 const created=await h.call('/api/purchases',{packId:'s3000',key:'purchase_full_flow',yen:1,coins:99999});assert.equal(created.status,200);
 const p=created.data.purchase,session=h.fake.pay(p.sessionId);
 assert.equal(created.data.state.wallet.S,0);assert.equal(h.fake.requests[0].params.get('line_items[0][price_data][unit_amount]'),'3000');
 const event=await h.event('checkout.session.completed',{id:session.id});assert.equal(event.status,200);
 const again=await h.event('checkout.session.completed',{id:session.id},event.id);assert.equal(again.status,200);assert.equal(again.data.result.duplicate,true);
 const differentEvent=await h.event('checkout.session.completed',{id:session.id});assert.equal(differentEvent.status,200);
 const balance=await h.call('/api/state');assert.equal(balance.data.wallet.S,3000);assert.equal(balance.data.ledger.filter(l=>l.kind==='purchase').length,1);
 h.app.economy._tx(()=>h.app.economy._writeLedger(h.user.id,'G',3000,'fixture_earned_gold','gift_http_funding'));
 const ordered=await h.call('/api/order',{itemId:'drink',castId:'luna',currency:'G',key:'order_drink_1',amount:1});assert.equal(ordered.status,200);assert.equal(ordered.data.state.wallet.S,3000);assert.equal(ordered.data.state.wallet.G,1500);
 const retry=await h.call('/api/order',{itemId:'drink',castId:'luna',currency:'G',key:'order_drink_1'});assert.equal(retry.data.state.wallet.S,3000);assert.equal(retry.data.state.orders.length,1);
});
test('no unsigned, return-url or client balance grant; missing currency and foreign origin fail',async t=>{
 const h=await setup(t);
 let r=await h.call('/api/order',{itemId:'drink',castId:'luna',key:'missing_currency'});assert.equal(r.status,400);
 r=await h.call('/api/visit',{castId:'luna',key:'valid_visit_key'},{Origin:'https://attacker.example'});assert.equal(r.status,403);
 r=await h.call('/api/visit',{castId:'luna',key:'valid_visit_key'},{'X-CSRF-Token':'fake'});assert.equal(r.status,403);
 r=await h.call('/api/grant',{amount:99999,currency:'S'});assert.equal(r.status,404);
 const noSignature=await fetch(h.origin+'/api/webhooks/stripe',{method:'POST',body:JSON.stringify({id:'evt_spoof',livemode:false,data:{object:{}}})});assert.equal(noSignature.status,400);
 const state=await h.call('/api/state?purchaseId=made_up&checkout=success');assert.equal(state.data.wallet.S,0);
});
test('owner isolation and limits include concurrent pending checkouts',async t=>{
 const h=await setup(t);assert.equal((await h.call('/api/limit',{yen:1500})).status,200);
 const first=await h.call('/api/purchases',{packId:'s1500',key:'purchase_first_1500'});assert.equal(first.status,200);
 const second=await h.call('/api/purchases',{packId:'s500',key:'purchase_second_500'});assert.equal(second.status,409);
 const foreign=h.app.economy.reservePurchase('other_player','s500','other_purchase_key');
 assert.equal((await h.call('/api/purchases/'+foreign.id)).status,404);
 assert.equal((await h.call('/api/purchases/'+foreign.id+'/reconcile',{})).status,404);
 assert.equal((await h.call('/api/state')).data.monthly.reservedYen,1500);
});
test('lost provider response can retry same purchase and reconcile without webhook',async t=>{
 const h=await setup(t);h.fake.setFail(true);
 const failed=await h.call('/api/purchases',{packId:'s1500',key:'outage_purchase_key'});assert.equal(failed.status,502);
 let s=await h.call('/api/state');assert.equal(s.data.wallet.S,0);assert.equal(s.data.purchases.length,1);assert.equal(s.data.monthly.reservedYen,1500);
 h.fake.setFail(false);const retried=await h.call('/api/purchases',{packId:'s1500',key:'outage_purchase_key'});assert.equal(retried.status,200);h.fake.pay(retried.data.purchase.sessionId);
 const restored=await h.call('/api/purchases/'+retried.data.purchase.id+'/reconcile',{});assert.equal(restored.status,200);assert.equal(restored.data.state.wallet.S,1500);
 const replay=await h.call('/api/purchases/'+retried.data.purchase.id+'/reconcile',{});assert.equal(replay.data.state.wallet.S,1500);
});
test('refund status, partial amounts, dispute win and duplicate events preserve S ledger',async t=>{
 const h=await setup(t),p=(await h.call('/api/purchases',{packId:'s3000',key:'refunds_purchase'})).data.purchase,s=h.fake.pay(p.sessionId);await h.event('checkout.session.completed',{id:s.id});
 const charge='ch_'+s.payment_intent.slice(3),refund={id:'re_partial',charge,currency:'jpy',amount:500,status:'pending',livemode:false};h.fake.refunds.set(refund.id,refund);
 assert.equal((await h.event('refund.created',{id:refund.id})).status,200);assert.equal((await h.call('/api/state')).data.wallet.S,3000);
 refund.status='failed';await h.event('refund.failed',{id:refund.id});assert.equal((await h.call('/api/state')).data.wallet.S,3000);
 refund.status='succeeded';await h.event('refund.updated',{id:refund.id});assert.equal((await h.call('/api/state')).data.wallet.S,2500);
 const dispute={id:'dp_case',charge,payment_intent:s.payment_intent,currency:'jpy',amount:3000,status:'needs_response',livemode:false};h.fake.disputes.set(dispute.id,dispute);
 await h.event('charge.dispute.created',{id:dispute.id});assert.equal((await h.call('/api/state')).data.wallet.S,0);
 dispute.status='won';const won=await h.event('charge.dispute.closed',{id:dispute.id});assert.equal(won.status,200);assert.equal((await h.call('/api/state')).data.wallet.S,2500);
 await h.event('charge.dispute.closed',{id:dispute.id},won.id);assert.equal((await h.call('/api/state')).data.wallet.S,2500);
});
test('refund after spending freezes paid actions but preserves free conversations',async t=>{
 const h=await setup(t),p=(await h.call('/api/purchases',{packId:'s1500',key:'spent_then_refund'})).data.purchase,s=h.fake.pay(p.sessionId);await h.event('checkout.session.completed',{id:s.id});
 h.app.economy._tx(()=>h.app.economy._writeLedger(h.user.id,'S',-1500,'fixture_voice_usage','spent_voice_refund'));
 h.fake.refunds.set('re_full',{id:'re_full',charge:'ch_'+s.payment_intent.slice(3),currency:'jpy',amount:1500,status:'succeeded',livemode:false});await h.event('refund.updated',{id:'re_full'});
 const state=await h.call('/api/state');assert.equal(state.data.wallet.debtS,1500);
 assert.equal((await h.call('/api/purchases',{packId:'s500',key:'blocked_purchase_key'})).status,409);
 assert.equal((await h.call('/api/conversation',{castId:'luna',topicId:'music',key:'free_after_refund'})).status,200);
});
test('durable webhook inbox retries a temporary provider outage',async t=>{
 const h=await setup(t),p=(await h.call('/api/purchases',{packId:'s500',key:'inbox_purchase_key'})).data.purchase,s=h.fake.pay(p.sessionId);
 h.fake.setFail(true);const failed=await h.event('checkout.session.completed',{id:s.id});assert.equal(failed.status,502);assert.equal(h.app.auth.db.prepare('SELECT status FROM payment_inbox WHERE id=?').get(failed.id).status,'pending');
 h.fake.setFail(false);await h.app.recover();assert.equal((await h.call('/api/state')).data.wallet.S,500);assert.equal(h.app.auth.db.prepare('SELECT status FROM payment_inbox WHERE id=?').get(failed.id).status,'applied');
});

test('job HTTP contract advances the challenge and returns the completed reward at top level',async t=>{
 const h=await setup(t);let r=await h.call('/api/job/start',{difficulty:'easy',key:'job_start_http'}),job=r.data.job;
 assert.equal(job.status,'active');
 for(let i=0;i<8;i++){
  const previous=job.challenge.id,choiceId=/グラス/.test(job.challenge.prompt)?'glass':/ケーキ|サンド|フルーツ/.test(job.challenge.prompt)?'food':'bottle';
  r=await h.call('/api/job/'+job.id+'/action',{key:'job_answer_http_'+i,answer:{challengeId:previous,choiceId}});
  assert.equal(r.status,200);assert.equal(typeof r.data.correct,'boolean');job=r.data.job;assert.equal(job.actions,i+1);assert.notEqual(job.challenge?.id,previous);
 }
 await new Promise(resolve=>setTimeout(resolve,1000));
 r=await h.call('/api/job/'+job.id+'/finish',{key:'job_finish_http'});
 assert.equal(r.status,200);assert.equal(r.data.job.status,'complete');assert.ok(r.data.reward>=70);assert.equal(r.data.state.wallet.G,r.data.reward);
 const repeated=await h.call('/api/job/'+job.id+'/finish',{key:'job_finish_http'});assert.equal(repeated.data.state.wallet.G,r.data.reward);
});

test('fresh provider snapshots undo a failed refund and apply a subsequent dispute',async t=>{
 const h=await setup(t),p=(await h.call('/api/purchases',{packId:'s1500',key:'refund_bank_reversal'})).data.purchase,s=h.fake.pay(p.sessionId);await h.event('checkout.session.completed',{id:s.id});
 const charge='ch_'+s.payment_intent.slice(3),refund={id:'re_reversed',charge,currency:'jpy',amount:500,status:'succeeded',livemode:false};h.fake.refunds.set(refund.id,refund);
 await h.event('refund.updated',{id:refund.id});assert.equal((await h.call('/api/state')).data.wallet.S,1000);
 refund.status='failed';await h.event('refund.failed',{id:refund.id});assert.equal((await h.call('/api/state')).data.wallet.S,1500);
 const d={id:'dp_first',charge,payment_intent:s.payment_intent,currency:'jpy',amount:1500,status:'needs_response',livemode:false};h.fake.disputes.set(d.id,d);
 await h.event('charge.dispute.created',{id:d.id});assert.equal((await h.call('/api/state')).data.wallet.S,0);
 d.status='won';await h.event('charge.dispute.closed',{id:d.id});assert.equal((await h.call('/api/state')).data.wallet.S,1500);
 const d2={...d,id:'dp_second',status:'needs_response'};h.fake.disputes.set(d2.id,d2);await h.event('charge.dispute.created',{id:d2.id});assert.equal((await h.call('/api/state')).data.wallet.S,0);
 const ledgerCount=(await h.call('/api/state')).data.ledger.length;await h.call('/api/purchases/'+p.id+'/reconcile',{});assert.equal((await h.call('/api/state')).data.ledger.length,ledgerCount);
});


async function paidCoins(h){const p=(await h.call('/api/purchases',{packId:'s500',key:'voice_test_funding'})).data.purchase,s=h.fake.pay(p.sessionId);await h.event('checkout.session.completed',{id:s.id});}
test('paid voice reserves S before provider calls, completes once, replays freely and isolates owners',async t=>{
 let chats=0,speeches=0;const ai={configured:true,falKey:'test-fixture',async chat(){chats++;return {reply:'散歩できてよかったですね。どんな景色でしたか？',emotion:'happy',source:'fal-gemini'};},async speech(){speeches++;return Buffer.from('RIFF0000WAVEfixture');}};
 const h=await setup(t,{ai}),body={castId:'luna',text:'今日は散歩しました。',priceS:5,key:'chat_paid_request'};
 assert.equal((await h.call('/api/chat',body)).status,409);assert.equal(chats,0);await paidCoins(h);
 assert.equal((await h.call('/api/chat',{...body,priceS:1})).status,409);assert.equal(chats,0);
 const r=await h.call('/api/chat',body);assert.equal(r.status,200);assert.ok(r.data.voiceId);assert.equal(r.data.state.wallet.S,495);assert.equal(r.data.state.wallet.G,0);
 const again=await h.call('/api/chat',body);assert.equal(again.data.voiceId,r.data.voiceId);assert.equal(again.data.state.wallet.S,495);assert.equal(chats,1);assert.equal(speeches,1);
 assert.equal((await h.call('/api/chat',{...body,text:'別の入力'})).status,409);assert.equal(chats,1);
 const audio=await fetch(h.origin+r.data.audioUrl,{headers:{Cookie:h.token}});assert.equal(audio.status,200);assert.equal(audio.headers.get('content-type'),'audio/wav');await audio.arrayBuffer();assert.equal(speeches,1);
 const foreign=await fetch(h.origin+r.data.audioUrl);assert.equal(foreign.status,401);
 assert.equal((await h.call('/api/speech',{replyId:1})).status,404);assert.equal((await h.call('/api/realtime/session',{})).status,503);
 assert.equal((await h.call('/api/conversation',{castId:'luna',topicId:'music',key:'free_voice_companion'})).data.state.wallet.S,495);
});
test('failed or uncertain voice generation returns reserved S once and same-key retry cannot resubmit',async t=>{
 let calls=0;const h=await setup(t,{ai:{configured:true,falKey:'fixture',async chat(){calls++;throw Object.assign(new Error('unknown outcome'),{status:502});}}});await paidCoins(h);
 const body={castId:'luna',text:'散歩の話を聞かせて',priceS:5,key:'unknown_voice_fixture'};
 assert.equal((await h.call('/api/chat',body)).status,502);assert.equal((await h.call('/api/state')).data.wallet.S,500);
 assert.equal((await h.call('/api/chat',body)).status,409);assert.equal(calls,1);const s=(await h.call('/api/state')).data;assert.equal(s.ledger.filter(l=>l.kind==='voice_release').length,1);
});
test('TTS failure returns S and invalid microphone payload never reaches transcription',async t=>{
 let transcriptions=0;const h=await setup(t,{ai:{configured:true,falKey:'fixture',async transcribe(){transcriptions++;},async chat(){return {reply:'テストの返答',source:'fal-gemini'};},async speech(){throw Object.assign(new Error('audio error'),{status:502});}}});await paidCoins(h);
 assert.equal((await h.call('/api/chat',{castId:'luna',audioDataURI:'data:audio/wav;base64,dGVzdA==',priceS:5,key:'invalid_microphone'})).status,400);assert.equal(transcriptions,0);
 assert.equal((await h.call('/api/chat',{castId:'luna',text:'こんにちは',priceS:5,key:'tts_fails_fixture'})).status,502);assert.equal((await h.call('/api/state')).data.wallet.S,500);
});

test('video demo declares no revenue, rejects early grants, isolates views and credits G once',async t=>{
 let now=Date.now();const economy=new Economy(':memory:',{clock:()=>now}),h=await setup(t,{economy});const c=(await h.call('/api/catalog')).data.rewardedViews;assert.equal(c.revenueEnabled,false);assert.equal(c.mode,'demo');
 let r=await h.call('/api/rewards/start',{key:'start_video_http'});const id=r.data.view.id;
 assert.equal((await h.call('/api/rewards/'+id+'/finish',{key:'finish_early_http'})).status,409);
 const foreign=h.app.rewards.start('other','foreign_view');assert.equal((await h.call('/api/rewards/'+foreign.id+'/finish',{key:'steal_view_http'})).status,404);
 for(let i=0;i<6;i++){now+=5000;r=await h.call('/api/rewards/'+id+'/heartbeat',{key:'heartbeat_http_'+i});assert.equal(r.status,200);}
 r=await h.call('/api/rewards/'+id+'/finish',{key:'finish_video_http'});assert.equal(r.status,200);assert.equal(r.data.state.wallet.G,100);assert.equal(r.data.state.wallet.S,0);
 const again=await h.call('/api/rewards/'+id+'/finish',{key:'finish_video_http'});assert.equal(again.data.state.wallet.G,100);
 const otherKey=await h.call('/api/rewards/'+id+'/finish',{key:'finish_video_http_again'});assert.equal(otherKey.data.state.wallet.G,100);
 assert.equal((await h.call('/api/order',{itemId:'drink',castId:'luna',currency:'S',key:'s_gift_rejected'})).status,400);
});
