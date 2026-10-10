import http from 'node:http';
import {readFile,stat} from 'node:fs/promises';
import {mkdirSync,createReadStream} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash,randomUUID} from 'node:crypto';
import {Economy} from './economy.mjs';
import {Auth,AuthError,cookieToken,cookie,checkCsrf} from './auth.mjs';
import {StripeTest,PaymentError,verifyWebhook} from './stripe.mjs';
import {CastAI} from './ai.mjs';
import {RewardedViews} from './rewarded-views.mjs';
import {VoiceTurns,validateMicAudio} from './voice-turns.mjs';
import {GeminiLive} from './gemini-live.mjs';
import {PACKS,ITEMS,CASTS,TOPICS,STORY_EVENTS,FICTION_NOTICE,orderLine} from './catalog.mjs';
const ROOT=fileURLToPath(new URL('../',import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');
const deny=(status,code,message)=>{throw new AuthError(status,code,message);};
export function createApp(options={}){
 const host=options.host||process.env.HOST||'127.0.0.1';
 if(!['127.0.0.1','localhost','::1'].includes(host))throw new Error('This prerelease binds to loopback only. Public hosting requires a reviewed deployment.');
 const port=options.port??Number(process.env.PORT||3210);
 let origin=options.origin||process.env.APP_ORIGIN||`http://${host==='::1'?'[::1]':host}:${port}`;
 if(!['127.0.0.1','localhost','[::1]'].includes(new URL(origin).hostname))throw new Error('APP_ORIGIN must be loopback in this test-only release.');
 const path=options.dbPath||resolve(ROOT,process.env.DATABASE_PATH||'data/succubus.sqlite');
 if(path!==':memory:')mkdirSync(dirname(path),{recursive:true});
 const economy=options.economy||new Economy(path);
 const auth=options.auth||new Auth(path);
 const stripe=options.stripe||new StripeTest({secretKey:process.env.STRIPE_SECRET_KEY,webhookSecret:process.env.STRIPE_WEBHOOK_SECRET,origin});
 const ai=options.ai||new CastAI({falKey:process.env.FAL_KEY,falModel:process.env.FAL_TEXT_MODEL});
 const voice=new VoiceTurns(economy,{priceS:options.voicePriceS??Number(process.env.VOICE_TURN_PRICE_S||5)});voice.recoverInterrupted();
 const rewards=new RewardedViews(economy);
 auth.db.exec(`CREATE TABLE IF NOT EXISTS payment_inbox(id TEXT PRIMARY KEY,payload_hash TEXT NOT NULL,payload TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,received_at INTEGER NOT NULL,last_error TEXT);
 CREATE TABLE IF NOT EXISTS ai_usage(user_id TEXT NOT NULL,day TEXT NOT NULL,kind TEXT NOT NULL,count INTEGER NOT NULL,PRIMARY KEY(user_id,day,kind));
 CREATE TABLE IF NOT EXISTS chat_turns(id INTEGER PRIMARY KEY,user_id TEXT NOT NULL,cast_id TEXT NOT NULL,role TEXT NOT NULL,text TEXT NOT NULL,created_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS idx_chat_user_cast ON chat_turns(user_id,cast_id,id);
 CREATE TABLE IF NOT EXISTS recovery_errors(purchase_id TEXT PRIMARY KEY,code TEXT NOT NULL,last_seen INTEGER NOT NULL);
 CREATE TABLE IF NOT EXISTS ai_requests(user_id TEXT NOT NULL,request_key TEXT NOT NULL,status TEXT NOT NULL,PRIMARY KEY(user_id,request_key));
 CREATE TABLE IF NOT EXISTS speech_cache(user_id TEXT NOT NULL,turn_id INTEGER NOT NULL,status TEXT NOT NULL,bytes BLOB,PRIMARY KEY(user_id,turn_id));
 CREATE TABLE IF NOT EXISTS ai_costs(user_id TEXT NOT NULL,request_key TEXT NOT NULL,cost_usd REAL NOT NULL,input_tokens INTEGER NOT NULL,output_tokens INTEGER NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(user_id,request_key));`);
 const locks=new Map(),limits=new Map();
 async function locked(key,fn){const previous=locks.get(key)||Promise.resolve();let release;const next=new Promise(r=>release=r);locks.set(key,next);await previous;try{return await fn();}finally{release();if(locks.get(key)===next)locks.delete(key);}}
 function rate(key,max,windowMs){const now=Date.now();let bucket=limits.get(key);if(!bucket||bucket.until<now){bucket={count:0,until:now+windowMs};limits.set(key,bucket);}if(++bucket.count>max)deny(429,'RATE_LIMIT','操作が続いています。少し待ってから再試行してください。');if(limits.size>5000){for(const[k,v]of limits)if(v.until<now)limits.delete(k);}}
 function apiUsage(userId,kind,max){const day=new Date(Date.now()+9*3600000).toISOString().slice(0,10);auth.db.prepare('INSERT INTO ai_usage VALUES(?,?,?,0) ON CONFLICT DO NOTHING').run(userId,day,kind);const r=auth.db.prepare('UPDATE ai_usage SET count=count+1 WHERE user_id=? AND day=? AND kind=? AND count<?').run(userId,day,kind,max);if(!r.changes)deny(429,'AI_DAILY_LIMIT','本日のAIサービス利用上限に達しました。定型会話は続けられます。');}
 const state=user=>({...economy.state(user.id),voiceTurns:voice.history(user.id)});
 const voiceBackend=options.voiceBackend||(options.ai?'fal-gemini':process.env.VOICE_BACKEND||'gemini-live');
 if(!['gemini-live','fal-gemini'].includes(voiceBackend))throw new Error('VOICE_BACKEND must be gemini-live or fal-gemini.');
 const live=new GeminiLive({economy,voice,auth,ai,state,rate,origin:()=>origin,apiKey:process.env.GEMINI_API_KEY||process.env.GOOGLE_API_KEY||'',model:process.env.GEMINI_LIVE_MODEL||'gemini-3.8-live',maxSessions:Number(process.env.LIVE_MAX_SESSIONS||2),dailyMaxTurns:Number(process.env.LIVE_DAILY_MAX_TURNS||100),userDailyMaxTurns:Number(process.env.LIVE_USER_DAILY_MAX_TURNS||60),...options.live});
 const voiceConfigured=()=>voiceBackend==='gemini-live'?live.configured:!!ai.falKey;
 function payloadKey(body){if(typeof body.key!=='string'||!/^[A-Za-z0-9_-]{8,120}$/.test(body.key))deny(400,'INVALID_KEY','操作番号が不正です。');return body.key;}
 async function ensureCheckout(p){
  if(p.sessionId)return stripe.session(p.sessionId);
  let session;
  if(Date.now()-p.createdAt>25*60000){
   session=await stripe.findCheckout(p);
   if(!session){economy.closeUnboundPurchase(p.id,'Stripe session list confirmed no Checkout was created');return null;}
  }else session=await stripe.createCheckout(p);
  economy.bindCheckout(p.id,session.id);return session;
 }
 async function adjustments(p,identity){
  if(!p.paymentIntent)return null;
  const pi=await stripe.paymentIntent(p.paymentIntent);
  if(pi.livemode!==false||pi.currency!=='jpy'||pi.amount!==p.yen||pi.metadata?.purchaseId!==p.id)throw new PaymentError(400,'PAYMENT_MISMATCH','元決済の照合に失敗しました。');
  if(!pi.latest_charge)return null;
  const charge=await stripe.charge(typeof pi.latest_charge==='string'?pi.latest_charge:pi.latest_charge.id);
  if(charge.livemode!==false||charge.currency!=='jpy'||charge.amount!==p.yen||charge.payment_intent!==p.paymentIntent)throw new PaymentError(400,'CHARGE_MISMATCH','課金情報の照合に失敗しました。');
  const refundedYen=await stripe.succeededRefundTotal(charge.id);
  const disputes=await stripe.all('disputes',{payment_intent:p.paymentIntent});
  if(disputes.some(d=>d.livemode!==false||d.currency!=='jpy'||d.charge!==charge.id||d.amount>p.yen))throw new PaymentError(400,'DISPUTE_MISMATCH','紛争情報の照合に失敗しました。');
  const current=disputes.filter(d=>!['won','warning_closed'].includes(d.status));
  const disputedYen=Math.max(0,...current.map(d=>d.amount));
  const disputeStatus=current.some(d=>d.status==='lost')?'lost':current.length?'open':disputes.length?'won':'none';
  const snapshot={refundedYen,disputedYen,disputeStatus};
  return economy.reconcilePayment(p.id,snapshot);
 }
 async function reconcileInternal(p,eventId){
  const session=await ensureCheckout(p);if(!session)return economy.purchaseById(p.id);
  if(session.payment_status==='paid'&&session.status==='complete'){
   economy.checkoutPaid(eventId||('sync-paid-'+session.id),session);
   await adjustments(economy.purchaseById(p.id));
  }else if(session.status==='expired')economy.checkoutClosed(eventId||('sync-expired-'+session.id),session);
  return economy.purchaseById(p.id);
 }
 async function processEvent(event){
  const object=event.data.object;
  if(event.type.startsWith('checkout.session.')){
   const session=await stripe.session(object.id);
   const p=typeof session.client_reference_id==='string'?economy.purchaseById(session.client_reference_id):null;
   if(!p)return {ignored:true};
   return locked('purchase:'+p.id,async()=>{
    if(!p.sessionId)economy.bindCheckout(p.id,session.id);
    if(session.status==='complete'&&session.payment_status==='paid'){const result=economy.checkoutPaid(event.id,session);await adjustments(economy.purchaseById(p.id));return result;}
    if(session.status==='expired')return economy.checkoutClosed(event.id,session);
    return {pending:true};
   });
  }
  if(['charge.refunded','charge.dispute.created','charge.dispute.updated','charge.dispute.closed','refund.created','refund.updated','refund.failed'].includes(event.type)){
   let chargeId;
   if(event.type==='charge.refunded')chargeId=object.id;
   else if(event.type.startsWith('charge.dispute.'))chargeId=(await stripe.dispute(object.id)).charge;
   else chargeId=(await stripe.request('GET','refunds/'+encodeURIComponent(object.id))).charge;
   if(typeof chargeId!=='string')chargeId=chargeId?.id;
   const charge=await stripe.charge(chargeId);
   const pi=await stripe.paymentIntent(typeof charge.payment_intent==='string'?charge.payment_intent:charge.payment_intent?.id);
   const p=typeof pi.metadata?.purchaseId==='string'?economy.purchaseById(pi.metadata.purchaseId):null;
   if(!p)return {ignored:true};
   return locked('purchase:'+p.id,async()=>{
    await reconcileInternal(economy.purchaseById(p.id));
    return adjustments(economy.purchaseById(p.id),event.id);
   });
  }
  return {ignored:true};
 }
 async function applyInbox(event){
  return locked('event:'+event.id,async()=>{
   const row=auth.db.prepare('SELECT * FROM payment_inbox WHERE id=?').get(event.id);
   if(row.status==='applied')return {duplicate:true};
   try{const result=await processEvent(event);auth.db.prepare("UPDATE payment_inbox SET status='applied',attempts=attempts+1,last_error=NULL WHERE id=?").run(event.id);return result;}
   catch(e){auth.db.prepare("UPDATE payment_inbox SET status='pending',attempts=attempts+1,last_error=? WHERE id=?").run(e.code||'INTERNAL',event.id);throw e;}
  });
 }
 async function webhook(req,res){
  const raw=await readBody(req,256000);
  const event=verifyWebhook(raw,req.headers['stripe-signature'],stripe.webhookSecret);
  const body=JSON.stringify(event),digest=hash(body);
  const old=auth.db.prepare('SELECT payload_hash FROM payment_inbox WHERE id=?').get(event.id);
  if(old&&old.payload_hash!==digest)deny(400,'EVENT_CONFLICT','同じイベント番号で内容が異なります。');
  auth.db.prepare("INSERT INTO payment_inbox(id,payload_hash,payload,status,received_at) VALUES(?,?,?,'pending',?) ON CONFLICT DO NOTHING").run(event.id,digest,body,Date.now());
  send(res,200,{received:true,result:await applyInbox(event)});
 }
 async function routes(req,res,url){
  if(req.method==='POST'&&url.pathname==='/api/webhooks/stripe')return webhook(req,res);
  const token=cookieToken(req);let session=auth.session(token);
  if(req.method==='GET'&&url.pathname==='/api/session'){
   if(!session){const next=auth.createSession();res.setHeader('Set-Cookie',cookie(next.token,origin.startsWith('https:')));session=auth.session(next.token);}
   return send(res,200,{user:session.id?{id:session.id,name:session.name}:null,csrfToken:session.csrf,capabilities:{stripe:stripe.configured,ai:voiceConfigured(),aiProvider:voiceBackend,tts:voiceConfigured(),realtime:voiceBackend==='gemini-live'&&live.configured,live:live.config(),voicePriceS:voice.priceS,mode:'test'},fictionNotice:FICTION_NOTICE});
  }
  if(req.method==='GET'&&url.pathname==='/api/catalog')return send(res,200,{packs:PACKS,items:ITEMS,casts:CASTS,topics:TOPICS,events:STORY_EVENTS,rewardedViews:rewards.config(),conversation:{voicePriceS:voice.priceS,includes:['音声認識','AI返答','Gemini日本語音声'],maxInputSeconds:30}});
  if(req.method==='GET'&&url.pathname==='/api/media'){
   try{return send(res,200,JSON.parse(await readFile(resolve(ROOT,'public/media/manifest.json'),'utf8')));}
   catch(e){if(e.code==='ENOENT')return send(res,200,{assets:[]});throw e;}
  }
  let body={};
  if(req.method==='POST'){
   if(req.headers.origin!==origin)deny(403,'ORIGIN_REJECTED','このページから操作してください。');
   if(!checkCsrf(session,req.headers['x-csrf-token']))deny(403,'CSRF_REJECTED','ページを更新してから再試行してください。');
   if(!/^application\/json(?:;|$)/i.test(req.headers['content-type']||''))deny(415,'JSON_REQUIRED','JSON形式で送信してください。');
   try{body=JSON.parse((await readBody(req,url.pathname==='/api/chat'?1400000:32000)).toString('utf8'));}catch(e){if(e.status)throw e;deny(400,'INVALID_JSON','JSON形式が不正です。');}
   if(!body||Array.isArray(body)||typeof body!=='object')deny(400,'INVALID_BODY','リクエストが不正です。');
  }
  const ip=req.socket.remoteAddress;
  if(req.method==='POST'&&['/api/auth/register','/api/auth/login'].includes(url.pathname)){
   rate('auth:'+ip,30,15*60000);rate('authname:'+String(body.name),12,15*60000);
   if(url.pathname.endsWith('register'))rate('register:'+ip,10,3600000);
   const user=url.pathname.endsWith('register')?auth.register(body.name,body.password):auth.login(body.name,body.password);
   economy.ensureAccount(user.id);auth.revoke(token);const next=auth.createSession(user.id);
   res.setHeader('Set-Cookie',cookie(next.token,origin.startsWith('https:')));
   return send(res,200,{user,csrfToken:next.csrfToken,state:state(user)});
  }
  if(!session?.id)deny(401,'AUTH_REQUIRED','ログインしてください。');
  const user={id:session.id,name:session.name};economy.ensureAccount(user.id);
  rate('api:'+user.id,240,60000);
  if(req.method==='GET'&&url.pathname==='/api/state')return send(res,200,state(user));
  if(req.method==='POST'&&url.pathname==='/api/auth/logout'){live.stop(user.id);auth.revoke(token);res.setHeader('Set-Cookie','sn_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');return send(res,200,{ok:true});}
  if(req.method==='POST'&&url.pathname==='/api/live/session'){
   payloadKey(body);if(voiceBackend!=='gemini-live')deny(503,'LIVE_NOT_SELECTED','音声方式をGemini Liveに設定してください。');
   return send(res,200,live.issue(user,body));
  }
  if(req.method==='POST'&&url.pathname==='/api/limit')return send(res,200,{monthly:economy.setLimit(user.id,body.yen),state:state(user)});
  if(req.method==='POST'&&url.pathname==='/api/order'){payloadKey(body);return send(res,200,{order:economy.order(user.id,body),reply:orderLine(body.castId,body.itemId),state:state(user)});}
  if(req.method==='POST'&&url.pathname==='/api/visit'){payloadKey(body);return send(res,200,{progress:economy.visit(user.id,body.castId,body.key),state:state(user)});}
  if(req.method==='POST'&&url.pathname==='/api/conversation'){
   payloadKey(body);const topic=TOPICS.find(t=>t.id===body.topicId),cast=CASTS.find(c=>c.id===body.castId);
   if(!topic||!cast)deny(400,'INVALID_TOPIC','話題・キャストが不正です。');
   const progress=economy.conversation(user.id,cast.id,topic.id,body.key);
   return send(res,200,{reply:cast.name+'：'+topic.reply,source:'scripted',progress,state:state(user)});
  }
  if(req.method==='POST'&&url.pathname==='/api/event'){
   payloadKey(body);const progress=economy.completeEvent(user.id,body.castId,body.eventId,body.key);
   return send(res,200,{progress,episode:STORY_EVENTS.find(e=>e.id===body.eventId)?.episode,state:state(user)});
  }
  if(req.method==='POST'&&url.pathname==='/api/rewards/start'){payloadKey(body);return send(res,200,{view:rewards.start(user.id,body.key),state:state(user)});}
  const rewardRoute=/^\/api\/rewards\/([A-Za-z0-9_-]+)\/(heartbeat|finish|cancel)$/.exec(url.pathname);
  if(req.method==='POST'&&rewardRoute){payloadKey(body);const id=rewardRoute[1],action=rewardRoute[2];const result=action==='finish'?rewards.finish(user.id,id,body.key):{view:action==='heartbeat'?rewards.heartbeat(user.id,id,body.key):rewards.cancel(user.id,id)};return send(res,200,{...result,state:state(user)});}
  if(req.method==='POST'&&url.pathname==='/api/job/start'){payloadKey(body);return send(res,200,{job:economy.startJob(user.id,body),state:state(user)});}
  const jobRoute=/^\/api\/job\/([A-Za-z0-9_-]+)\/(action|finish)$/.exec(url.pathname);
  if(req.method==='POST'&&jobRoute){payloadKey(body);const result=jobRoute[2]==='action'?economy.jobAction(user.id,jobRoute[1],body.answer,body.key):economy.finishJob(user.id,jobRoute[1],body.key);return send(res,200,{...result,state:state(user)});}
  if(req.method==='POST'&&url.pathname==='/api/purchases'){
   payloadKey(body);if(!stripe.configured)deny(503,'STRIPE_NOT_CONFIGURED','Stripeテスト用キーとWebhookを設定するとテスト購入できます。');
   rate('checkout:'+user.id,20,60000);
   const p=economy.reservePurchase(user.id,body.packId,body.key);
   return locked('purchase:'+p.id,async()=>{
    const current=economy.purchaseById(p.id);
    if(current.status==='paid')return send(res,200,{purchase:current,checkoutUrl:null,state:state(user)});
    if(current.status==='expired')deny(409,'PURCHASE_EXPIRED','この決済は終了しました。新しい購入を開始してください。');
    const checkout=await ensureCheckout(current);
    if(!checkout)deny(409,'PURCHASE_EXPIRED','決済の作成を確認できなかったため終了しました。新しい購入を開始してください。');
    return send(res,200,{purchase:economy.purchaseById(p.id),checkoutUrl:checkout.url||null,state:state(user)});
   });
  }
  const purchaseRoute=/^\/api\/purchases\/([A-Za-z0-9_-]+)(\/reconcile)?$/.exec(url.pathname);
  if(purchaseRoute){const p=economy.purchase(user.id,purchaseRoute[1]);
   if(req.method==='GET'&&!purchaseRoute[2])return send(res,200,p);
   if(req.method==='POST'&&purchaseRoute[2])return locked('purchase:'+p.id,async()=>{rate('reconcile:'+user.id,30,60000);if(!stripe.configured)deny(503,'STRIPE_NOT_CONFIGURED','テスト決済が未設定です。');const current=await reconcileInternal(economy.purchaseById(p.id));return send(res,200,{purchase:current,state:state(user)});});
  }
  if(req.method==='POST'&&url.pathname==='/api/chat'){
   const key=payloadKey(body);
   if(voiceBackend==='gemini-live')deny(503,'USE_GEMINI_LIVE','Gemini Liveの音声会話から開始してください。');
   if(live.busy(user.id))deny(409,'LIVE_TURN_BUSY','音声の返答が終わってから再開してください。');
   if(!ai.falKey)deny(503,'AI_NOT_CONFIGURED','Gemini音声の接続が未設定です。無料の定型会話は利用できます。');
   if(body.priceS!==voice.priceS)deny(409,'PRICE_CHANGED','現在の会話料金を確認してから開始してください。');
   const isAudio=body.audioDataURI!==undefined;
   if(isAudio&&body.text!==undefined)deny(400,'AMBIGUOUS_INPUT','テキストか音声のどちらかで話してください。');
   if(isAudio)validateMicAudio(body.audioDataURI);
   else if(typeof body.text!=='string'||!body.text.trim()||body.text.length>1200)deny(400,'INVALID_CHAT','会話は1〜1200文字にしてください。');
   const request={castId:body.castId,kind:isAudio?'audio':'text',inputHash:hash(isAudio?body.audioDataURI:body.text)};
   return locked('chat:'+user.id,async()=>{
    const turn=voice.reserve(user.id,key,request);
    const answer=t=>({...t.reply,voiceId:t.id,priceS:t.priceS,audioUrl:'/api/voice/'+t.id+'/audio',state:state(user)});
    if(turn.status==='complete')return send(res,200,answer(turn));
    if(turn.status==='failed')deny(409,'VOICE_FAILED','前の返答は完了せず、予約したSは戻しました。新しい発言として再開できます。');
    try{
     rate('paid-voice:'+user.id,12,60000);
     const text=isAudio?await ai.transcribe(body.audioDataURI):body.text.trim();
     const relation=state(user).affection.find(a=>a.castId===body.castId);
     const history=auth.db.prepare('SELECT role,text FROM chat_turns WHERE user_id=? AND cast_id=? ORDER BY id DESC LIMIT 8').all(user.id,body.castId).reverse().map(r=>({role:r.role,content:r.text}));
     const reply=await ai.chat(user.id,body.castId,relation?.score||0,user.name,text,history);
     if(reply.usage)auth.db.prepare('INSERT INTO ai_costs VALUES(?,?,?,?,?,?) ON CONFLICT DO NOTHING').run(user.id,key,reply.usage.costUsd,reply.usage.inputTokens,reply.usage.outputTokens,Date.now());
     delete reply.usage;
     const audio=await ai.speech(body.castId,reply.reply,reply.emotion||'neutral');
     const complete=voice.complete(user.id,turn.id,{...reply,inputText:text},audio);
     economy.conversation(user.id,body.castId,'day','voice-progress-'+turn.id);
     auth.db.prepare('INSERT INTO chat_turns(user_id,cast_id,role,text,created_at) VALUES(?,?,?,?,?)').run(user.id,body.castId,'user',text,Date.now());
     auth.db.prepare('INSERT INTO chat_turns(user_id,cast_id,role,text,created_at) VALUES(?,?,?,?,?)').run(user.id,body.castId,'assistant',reply.reply,Date.now());
     return send(res,200,answer(complete));
    }catch(e){voice.release(user.id,turn.id,e.code||'VOICE_FAILED');throw e;}
   });
  }
  const voiceRoute=/^\/api\/voice\/([A-Za-z0-9_-]+)(\/audio)?$/.exec(url.pathname);
  if(req.method==='GET'&&voiceRoute){
   if(!voiceRoute[2])return send(res,200,{turn:voice.get(user.id,voiceRoute[1]),state:state(user)});
   const bytes=voice.audio(user.id,voiceRoute[1]);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes.length});return res.end(bytes);
  }
  // Historic generated audio can be replayed, but this endpoint cannot create free speech.
  if(req.method==='POST'&&url.pathname==='/api/speech'){
   const cached=auth.db.prepare("SELECT bytes FROM speech_cache WHERE user_id=? AND turn_id=? AND status='ready'").get(user.id,Number.isSafeInteger(body.replyId)?body.replyId:-1);
   if(!cached)deny(404,'SPEECH_NOT_FOUND','生成済み音声は見つかりません。音声会話から開始してください。');
   const bytes=Buffer.from(cached.bytes);res.writeHead(200,{'Content-Type':'audio/wav','Content-Length':bytes.length});return res.end(bytes);
  }
  if(req.method==='POST'&&url.pathname==='/api/realtime/session')deny(503,'USE_GEMINI_VOICE','Gemini音声会話を利用してください。');
  deny(404,'NOT_FOUND','この操作はありません。');
 }
 const server=http.createServer(async(req,res)=>{
  try{
   res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');res.setHeader('Cache-Control','no-store');
   res.setHeader('Content-Security-Policy',`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' ${new URL(origin).origin.replace(/^http/,'ws')}; media-src 'self' blob:; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'`);
   res.setHeader('Permissions-Policy','camera=(), microphone=(self)');
   if(req.headers.host!==new URL(origin).host)deny(403,'HOST_REJECTED','このホストから接続してください。');
   const url=new URL(req.url,origin);
   if(url.pathname.startsWith('/api/'))return await routes(req,res,url);
   if(req.method!=='GET'&&req.method!=='HEAD')deny(405,'METHOD_NOT_ALLOWED','操作が不正です。');
   const assets={'/voice-input.mjs':'voice-input.mjs','/mobile.css':'mobile.css','/reward-viewer.mjs':'reward-viewer.mjs','/voice-client.mjs':'voice-client.mjs','/cast-stage.mjs':'cast-stage.mjs','/':'index.html','/index.html':'index.html','/app.mjs':'app.mjs','/style.css':'style.css','/favicon.svg':'favicon.svg','/casts.png':'casts.png','/legal':'legal.html','/media/welcome.mp4':'media/welcome.mp4','/media/luna-greeting.wav':'media/luna-greeting.wav','/media/mio-greeting.wav':'media/mio-greeting.wav','/media/reina-greeting.wav':'media/reina-greeting.wav','/media/luna-expressions.png':'media/luna-expressions.png','/media/mio-expressions.png':'media/mio-expressions.png','/media/reina-expressions.png':'media/reina-expressions.png'};
   Object.assign(assets,{'/gemini-live-client.mjs':'gemini-live-client.mjs','/live-audio.mjs':'live-audio.mjs'});
   if(/^\/media\/(luna|mio|reina)-casual-v2-(greeting|topic-(day|music|dream|memory)|order-(drink|luxury|champagne|premium))(-revision-[a-f0-9]{8})?\.wav$/.test(url.pathname))assets[url.pathname]=url.pathname.slice(1);
   for(const cast of ['luna','mio','reina']){assets['/media/'+cast+'-seated.png']='media/'+cast+'-seated.png';for(const mood of ['idle','neutral','happy','sad','angry','surprised'])assets['/media/'+cast+'-'+mood+'.mp4']='media/'+cast+'-'+mood+'.mp4';}
   for(const name of ['NotoSansJP.woff2','ZenMaruGothic-Medium.woff2'])assets['/fonts/'+name]='fonts/'+name;
   const asset=assets[url.pathname];if(!asset)deny(404,'NOT_FOUND','ページがありません。');
   const full=resolve(ROOT,'public',asset),info=await stat(full);
   if(/\.(mp4|png|wav|woff2)$/.test(asset))res.setHeader('Cache-Control','public, max-age=31536000, immutable');
   res.setHeader('Content-Type',({'.html':'text/html; charset=utf-8','.mjs':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.wav':'audio/wav','.mp4':'video/mp4','.woff2':'font/woff2'})[extname(asset)]);
   if(['.mp4','.wav'].includes(extname(asset))){
    res.setHeader('Accept-Ranges','bytes');const range=/^bytes=(\d+)-(\d*)$/.exec(req.headers.range||'');
    if(req.headers.range&&!range){res.writeHead(416,{'Content-Range':'bytes */'+info.size});return res.end();}
    if(range){const start=Number(range[1]),end=range[2]?Math.min(Number(range[2]),info.size-1):info.size-1;
     if(start> end||start>=info.size){res.writeHead(416,{'Content-Range':'bytes */'+info.size});return res.end();}
     res.setHeader('Content-Range',`bytes ${start}-${end}/${info.size}`);res.setHeader('Content-Length',end-start+1);res.writeHead(206);if(req.method==='HEAD')return res.end();createReadStream(full,{start,end}).on('error',()=>res.destroy()).pipe(res);return;
    }
   }
   res.setHeader('Content-Length',info.size);res.writeHead(200);if(req.method==='HEAD')return res.end();createReadStream(full).on('error',()=>res.destroy()).pipe(res);
  }catch(e){if(!res.headersSent)send(res,e.status||500,{error:{code:e.code||'INTERNAL',message:e.status?e.message:'処理を完了できませんでした。履歴を確認して再試行してください。'}});else res.end();}
 });
 live.attach(server);
 let recoveryTimer,recovering=false;
 async function recover(){
  if(recovering||!stripe.configured)return;recovering=true;
  try{
   for(const row of auth.db.prepare("SELECT payload FROM payment_inbox WHERE status='pending' ORDER BY received_at LIMIT 20").all()){
    try{await applyInbox(JSON.parse(row.payload));}catch{} // Durable inbox keeps retryable errors, no secrets in logs.
   }
   for(const p of economy.pendingAllPurchases().slice(0,20)){
    try{await locked('purchase:'+p.id,()=>reconcileInternal(economy.purchaseById(p.id)));auth.db.prepare('DELETE FROM recovery_errors WHERE purchase_id=?').run(p.id);}
    catch(e){auth.db.prepare('INSERT INTO recovery_errors VALUES(?,?,?) ON CONFLICT(purchase_id) DO UPDATE SET code=excluded.code,last_seen=excluded.last_seen').run(p.id,e.code||'INTERNAL',Date.now());}
   }
  }finally{recovering=false;}
 }
 return {server,economy,auth,stripe,ai,voice,live,rewards,recover,processEvent,
  async listen(){await new Promise((ok,fail)=>{server.once('error',fail);server.listen(port,host,ok);});if(port===0){origin=`http://${host==='::1'?'[::1]':host}:${server.address().port}`;stripe.origin=origin;}recoveryTimer=setInterval(()=>recover().catch(()=>{}),30000);recoveryTimer.unref();recover().catch(()=>{});return origin;},
  async close(){clearInterval(recoveryTimer);live.close();await new Promise(ok=>server.close(ok));economy.close();auth.close();},
  get origin(){return origin;}
 };
}
async function readBody(req,max){const chunks=[];let bytes=0;for await(const chunk of req){bytes+=chunk.length;if(bytes>max)deny(413,'BODY_TOO_LARGE','送信データが大きすぎます。');chunks.push(chunk);}return Buffer.concat(chunks);}
function send(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'});res.end(JSON.stringify(data));}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const app=createApp();app.listen().then(url=>console.log(`SUCCUBUS NIGHT — LOCAL TEST ONLY\n${url}\nStripe: ${app.stripe.configured?'test configured':'not configured'} / Gemini Live: ${app.live.configured?'key configured (connection not yet verified)':'key not configured'}`)).catch(e=>{console.error(e.message);process.exitCode=1;});
 for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>app.close().then(()=>process.exit(0)));
}

