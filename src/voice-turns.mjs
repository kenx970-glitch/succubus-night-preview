import {randomUUID} from 'node:crypto';
import {DomainError} from './economy.mjs';
const fail=(status,code,message)=>{throw new DomainError(status,code,message);};
/** Fixed-price, server-owned voice reservations. No balance comes from a browser. */
export class VoiceTurns{
 constructor(economy,{priceS=5}={}){
  if(!Number.isSafeInteger(priceS)||priceS<1||priceS>50)throw new Error('VOICE_TURN_PRICE_S must be an integer from 1 to 50.');
  this.economy=economy;this.db=economy.db;this.priceS=priceS;
  this.db.exec(`CREATE TABLE IF NOT EXISTS voice_turns(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES econ_accounts(user_id),request_key TEXT NOT NULL,cast_id TEXT NOT NULL,price_s INTEGER NOT NULL,status TEXT NOT NULL CHECK(status IN ('reserved','complete','failed')),reply_json TEXT,audio BLOB,error_code TEXT,created_at INTEGER NOT NULL,completed_at INTEGER,UNIQUE(user_id,request_key)) STRICT;`);
 }
 reserve(userId,key,request){
  return this.economy._tx(()=>{
   this.economy._ensure(userId);this.economy._cast(request.castId);
   const receipt=this.economy._receipt(userId,key,'voiceTurn',request,()=>{
    const wallet=this.economy._wallet(userId);
    if(wallet.debtS>0)fail(409,'paid_currency_frozen','Sの不足があるため、音声会話は停止しています。無料の定型会話は続けられます。');
    if(wallet.S<this.priceS)fail(409,'insufficient_funds',`音声の返答には${this.priceS}Sが必要です。残高の範囲で利用してください。`);
    const id=randomUUID();this.db.prepare("INSERT INTO voice_turns(id,user_id,request_key,cast_id,price_s,status,created_at) VALUES(?,?,?,?,?,'reserved',?)").run(id,userId,key,request.castId,this.priceS,this.economy._now());
    this.economy._writeLedger(userId,'S',-this.priceS,'voice_reservation',id);return {id};
   });
   return this.get(userId,receipt.id);
  });
 }
 get(userId,id){const row=this.db.prepare('SELECT * FROM voice_turns WHERE id=? AND user_id=?').get(id,userId);if(!row)fail(404,'VOICE_NOT_FOUND','この音声会話は見つかりません。');return {id:row.id,castId:row.cast_id,priceS:row.price_s,status:row.status,reply:row.reply_json?JSON.parse(row.reply_json):null,errorCode:row.error_code,createdAt:row.created_at,completedAt:row.completed_at};}
 complete(userId,id,reply,audio){
  if(!Buffer.isBuffer(audio)||audio.length<12||audio.length>5000000)fail(400,'INVALID_AUDIO','返答の音声が不正です。');
  return this.economy._tx(()=>{const turn=this.get(userId,id);if(turn.status==='complete')return turn;if(turn.status!=='reserved')fail(409,'VOICE_CLOSED','この会話は終了しました。');
   this.db.prepare("UPDATE voice_turns SET status='complete',reply_json=?,audio=?,completed_at=? WHERE id=?").run(JSON.stringify(reply),audio,this.economy._now(),id);return this.get(userId,id);
  });
 }
 release(userId,id,code='VOICE_FAILED'){
  return this.economy._tx(()=>{const turn=this.get(userId,id);if(turn.status!=='reserved')return turn;
   this.economy._writeLedger(userId,'S',turn.priceS,'voice_release',id);
   this.db.prepare("UPDATE voice_turns SET status='failed',error_code=?,completed_at=? WHERE id=?").run(code,this.economy._now(),id);return this.get(userId,id);
  });
 }
 audio(userId,id){const turn=this.get(userId,id);if(turn.status!=='complete')fail(409,'VOICE_NOT_READY','返答を準備しています。');return Buffer.from(this.db.prepare('SELECT audio FROM voice_turns WHERE id=?').get(id).audio);}
 history(userId){return this.db.prepare('SELECT id FROM voice_turns WHERE user_id=? ORDER BY created_at DESC LIMIT 30').all(userId).map(r=>this.get(userId,r.id));}
 recoverInterrupted(){for(const row of this.db.prepare("SELECT id,user_id FROM voice_turns WHERE status='reserved'").all())this.release(row.user_id,row.id,'SERVER_RESTARTED');}
}
export function validateMicAudio(dataURI){
 if(typeof dataURI!=='string'||!/^data:audio\/wav;base64,[A-Za-z0-9+/]+={0,2}$/.test(dataURI)||dataURI.length>1300000)fail(400,'INVALID_MIC_AUDIO','音声は30秒以内のWAVにしてください。');
 const bytes=Buffer.from(dataURI.slice(dataURI.indexOf(',')+1),'base64');
 if(bytes.length<1004||bytes.length>960044||bytes.length%2!==0||bytes.subarray(0,4).toString()!=='RIFF'||bytes.subarray(8,12).toString()!=='WAVE'||bytes.subarray(12,16).toString()!=='fmt '||bytes.readUInt32LE(16)!==16||bytes.readUInt16LE(20)!==1||bytes.readUInt16LE(22)!==1||bytes.readUInt32LE(24)!==16000||bytes.readUInt32LE(28)!==32000||bytes.readUInt16LE(32)!==2||bytes.readUInt16LE(34)!==16||bytes.subarray(36,40).toString()!=='data'||bytes.readUInt32LE(40)!==bytes.length-44||bytes.readUInt32LE(4)!==bytes.length-8)fail(400,'INVALID_MIC_AUDIO','音声の形式を確認できませんでした。');
 let energy=0;for(let i=44;i<bytes.length;i+=2){const sample=bytes.readInt16LE(i)/32768;energy+=sample*sample;}
 if(Math.sqrt(energy/((bytes.length-44)/2))<.004)fail(400,'NO_SPEECH','音声が小さすぎます。Sは消費していません。');
 return {bytes,durationSeconds:(bytes.length-44)/32000};
}
