import {createHmac,timingSafeEqual} from 'node:crypto';
export class PaymentError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
export function verifyWebhook(raw,signature,secret,now=Date.now()){
 if(!secret||!secret.startsWith('whsec_'))throw new PaymentError(503,'WEBHOOK_NOT_CONFIGURED','テストWebhookが未設定です。');
 const parts=String(signature||'').split(',').map(x=>x.split('='));
 const timestamp=parts.find(([k])=>k==='t')?.[1],signatures=parts.filter(([k])=>k==='v1').map(([,v])=>v);
 if(!/^\d+$/.test(timestamp||'')||Math.abs(now/1000-Number(timestamp))>300)throw new PaymentError(400,'INVALID_SIGNATURE','Webhookの署名または時刻が不正です。');
 const expected=createHmac('sha256',secret).update(timestamp+'.').update(raw).digest();
 if(!signatures.some(s=>/^[a-f0-9]{64}$/i.test(s||'')&&timingSafeEqual(Buffer.from(s,'hex'),expected)))throw new PaymentError(400,'INVALID_SIGNATURE','Webhookの署名が不正です。');
 let event;try{event=JSON.parse(raw.toString('utf8'));}catch{throw new PaymentError(400,'INVALID_EVENT','Webhook JSONが不正です。');}
 if(event.livemode!==false||typeof event.id!=='string'||!event.id.startsWith('evt_')||!event.data?.object)throw new PaymentError(400,'LIVE_REJECTED','テスト環境のイベントのみ受け付けます。');
 return event;
}
export class StripeTest {
 constructor({secretKey='',webhookSecret='',origin,fetchImpl=fetch}={}){
  if(secretKey&&!/^(sk_test_|rk_test_)/.test(secretKey))throw new PaymentError(503,'LIVE_REJECTED','本番用Stripeキーは無効です。この版はテスト専用です。');
  this.key=secretKey;this.webhookSecret=webhookSecret;this.origin=origin;this.fetch=fetchImpl;
 }
 get configured(){return !!this.key&&!!this.webhookSecret;}
 async request(method,path,params={},key){
  if(!this.key)throw new PaymentError(503,'STRIPE_NOT_CONFIGURED','Stripeテスト用キーとWebhook署名シークレットを設定してください。');
  let url='https://api.stripe.com/v1/'+path;
  const headers={Authorization:'Bearer '+this.key};
  const form=new URLSearchParams();for(const [k,v]of Object.entries(params))form.append(k,String(v));
  let body;if(method==='GET'){if(form.size)url+='?'+form;}else{body=form.toString();headers['Content-Type']='application/x-www-form-urlencoded';}
  if(key)headers['Idempotency-Key']=key;
  let response;try {response=await this.fetch(url,{method,headers,body,signal:AbortSignal.timeout(20000)});}catch{throw new PaymentError(502,'PROVIDER_UNAVAILABLE','決済サービスへの通信を確認できません。同じ操作で再試行してください。');}
  const data=await response.json();
  if(!response.ok)throw new PaymentError(502,'PROVIDER_ERROR','決済サービスが処理を完了できませんでした。履歴から再確認してください。');
  if(data.livemode===true||data.data?.some(x=>x.livemode===true))throw new PaymentError(400,'LIVE_REJECTED','本番の決済データは受け付けません。');
  return data;
 }
 async createCheckout(p){
  const params={mode:'payment','payment_method_types[0]':'card',client_reference_id:p.id,
   'line_items[0][price_data][currency]':'jpy','line_items[0][price_data][unit_amount]':p.yen,
   'line_items[0][price_data][product_data][name]':`Succubus Coin ${p.coins}S — TEST`,
   'line_items[0][price_data][product_data][description]':'テスト決済／1円=1S／表示価格は税込総額／Sは無期限',
   'line_items[0][quantity]':1,'metadata[purchaseId]':p.id,'metadata[userId]':p.userId,'metadata[packId]':p.packId,
   'payment_intent_data[metadata][purchaseId]':p.id,
   success_url:this.origin+'/?purchaseId='+encodeURIComponent(p.id)+'&checkout=success',
   cancel_url:this.origin+'/?purchaseId='+encodeURIComponent(p.id)+'&checkout=cancel',
   expires_at:Math.floor((p.createdAt+60*60000)/1000)};
  const session=await this.request('POST','checkout/sessions',params,'sn-checkout-'+p.id);
  if(session.livemode!==false||session.client_reference_id!==p.id||session.amount_total!==p.yen||session.currency!=='jpy')throw new PaymentError(502,'SESSION_MISMATCH','決済の金額・通貨を確認できませんでした。');
  if(session.url&&new URL(session.url).hostname!=='checkout.stripe.com')throw new PaymentError(502,'INVALID_CHECKOUT_URL','決済先を確認できませんでした。');
  return session;
 }
 session(id){if(!/^cs_test_[A-Za-z0-9_]+$/.test(id))throw new PaymentError(400,'INVALID_SESSION','テスト決済番号が不正です。');return this.request('GET','checkout/sessions/'+encodeURIComponent(id));}
 paymentIntent(id){if(!/^pi_[A-Za-z0-9_]+$/.test(id))throw new PaymentError(400,'INVALID_PAYMENT','決済番号が不正です。');return this.request('GET','payment_intents/'+id);}
 charge(id){if(!/^ch_[A-Za-z0-9_]+$/.test(id))throw new PaymentError(400,'INVALID_CHARGE','課金番号が不正です。');return this.request('GET','charges/'+id);}
 dispute(id){if(!/^dp_[A-Za-z0-9_]+$/.test(id))throw new PaymentError(400,'INVALID_DISPUTE','紛争番号が不正です。');return this.request('GET','disputes/'+id);}
 async succeededRefundTotal(chargeId){
  let total=0,cursor;
  for(let page=0;page<1000;page++){
   const list=await this.request('GET','refunds',{charge:chargeId,limit:100,...(cursor?{starting_after:cursor}:{})});
   for(const refund of list.data){if(refund.charge!==chargeId||refund.currency!=='jpy')throw new PaymentError(400,'REFUND_MISMATCH','返金通貨・元決済が一致しません。');if(refund.status==='succeeded')total+=refund.amount;}
   if(!list.has_more)return total;
   cursor=list.data.at(-1)?.id;if(!cursor)break;
  }
  throw new PaymentError(502,'INCOMPLETE_REFUNDS','返金一覧を完全に取得できませんでした。');
 }
 async all(path,params){
  const result=[];let cursor;
  for(let page=0;page<1000;page++){
   const list=await this.request('GET',path,{...params,limit:100,...(cursor?{starting_after:cursor}:{})});
   result.push(...list.data);if(!list.has_more)return result;
   cursor=list.data.at(-1)?.id;if(!cursor)break;
  }
  throw new PaymentError(502,'INCOMPLETE_PROVIDER_DATA','決済データを完全に取得できませんでした。');
 }
 async findCheckout(p){
  const all=await this.all('checkout/sessions',{'created[gte]':Math.floor(p.createdAt/1000)-5,'created[lte]':Math.floor(p.createdAt/1000)+3600});
  const sessions=all.filter(s=>s.client_reference_id===p.id&&s.metadata?.purchaseId===p.id);
  if(sessions.length>1)throw new PaymentError(409,'MULTIPLE_SESSIONS','決済の重複候補が見つかりました。運営側の照合が必要です。');
  return sessions[0]||null;
 }
}
