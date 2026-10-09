import {randomUUID} from 'node:crypto';
import {DomainError} from './economy.mjs';
const fail=(code,message,status=409)=>{throw new DomainError(status,code,message);};
/** Local demo only. Web ad callbacks are not verified revenue receipts. */
export class RewardedViews{
 constructor(economy,{durationMs=30000,rewardG=100}={}){this.economy=economy;this.db=economy.db;this.durationMs=durationMs;this.rewardG=rewardG;this.db.exec(`CREATE TABLE IF NOT EXISTS rewarded_views(id TEXT PRIMARY KEY,user_id TEXT NOT NULL REFERENCES econ_accounts(user_id),status TEXT NOT NULL CHECK(status IN ('active','complete','cancelled')),started_at INTEGER NOT NULL,last_seen INTEGER NOT NULL,verified_ms INTEGER NOT NULL DEFAULT 0,reward_g INTEGER NOT NULL,completed_at INTEGER) STRICT;`);}
 config(){return {mode:'demo',provider:null,revenueEnabled:false,rewardG:this.rewardG,durationSeconds:this.durationMs/1000,dailyLimitG:1000};}
 get(userId,id){const r=this.db.prepare('SELECT * FROM rewarded_views WHERE id=? AND user_id=?').get(id,userId);if(!r)fail('VIEW_NOT_FOUND','この視聴は見つかりません。',404);return {id:r.id,status:r.status,startedAt:r.started_at,verifiedSeconds:r.verified_ms/1000,rewardG:r.reward_g,mode:'demo'};}
 start(userId,key){return this.economy._tx(()=>{this.economy._ensure(userId);const receipt=this.economy._receipt(userId,key,'rewardedStart',{},()=>{
  const active=this.db.prepare("SELECT id FROM rewarded_views WHERE user_id=? AND status='active'").get(userId);if(active)return {id:active.id};
  const now=this.economy._now(),dayStart=Math.floor((now+9*3600000)/86400000)*86400000-9*3600000,earned=this.db.prepare("SELECT COALESCE(SUM(reward_g),0) n FROM rewarded_views WHERE user_id=? AND status='complete' AND completed_at>=?").get(userId,dayStart).n;
  if(earned+this.rewardG>1000)fail('VIEW_LIMIT','本日のテスト視聴報酬は受け取り済みです。');
  const id=randomUUID();this.db.prepare("INSERT INTO rewarded_views(id,user_id,status,started_at,last_seen,reward_g) VALUES(?,?,'active',?,?,?)").run(id,userId,now,now,this.rewardG);return {id};
 });return this.get(userId,receipt.id);});}
 heartbeat(userId,id,key){return this.economy._tx(()=>this.economy._receipt(userId,key,'rewardedHeartbeat',{id},()=>{
  const row=this.get(userId,id);if(row.status!=='active')return row;
  const saved=this.db.prepare('SELECT last_seen FROM rewarded_views WHERE id=?').get(id),now=this.economy._now(),elapsed=now-saved.last_seen;
  if(elapsed<4000)fail('VIEW_TOO_FAST','視聴状況を確認しています。',429);
  this.db.prepare('UPDATE rewarded_views SET verified_ms=verified_ms+?,last_seen=? WHERE id=?').run(Math.min(elapsed,6000),now,id);return this.get(userId,id);
 }));}
 finish(userId,id,key){return this.economy._tx(()=>this.economy._receipt(userId,key,'rewardedFinish',{id},()=>{
  const row=this.get(userId,id);if(row.status==='complete')return {view:row,rewardG:row.rewardG,duplicate:true};
  const now=this.economy._now();if(row.status!=='active'||now-row.startedAt<this.durationMs||row.verifiedSeconds*1000<this.durationMs-1500)fail('VIEW_INCOMPLETE','動画を最後までご覧ください。');
  this.db.prepare("UPDATE rewarded_views SET status='complete',completed_at=? WHERE id=?").run(now,id);this.economy._writeLedger(userId,'G',row.rewardG,'rewarded_demo',id);return {view:this.get(userId,id),rewardG:row.rewardG,duplicate:false};
 }));}
 cancel(userId,id){return this.economy._tx(()=>{this.get(userId,id);this.db.prepare("UPDATE rewarded_views SET status='cancelled' WHERE id=? AND status='active'").run(id);return this.get(userId,id);});}
}
