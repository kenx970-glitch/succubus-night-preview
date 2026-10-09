import {DatabaseSync} from 'node:sqlite';
import {randomBytes,randomUUID,createHash,scryptSync,timingSafeEqual} from 'node:crypto';
const hash = s => createHash('sha256').update(s).digest('hex');
export class AuthError extends Error {constructor(status,code,message){super(message);Object.assign(this,{status,code});}}
export class Auth {
 constructor(path){
  this.db=new DatabaseSync(path);
  this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA foreign_keys=ON;
   CREATE TABLE IF NOT EXISTS auth_users(id TEXT PRIMARY KEY,name TEXT UNIQUE NOT NULL,password TEXT NOT NULL,created_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS auth_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT REFERENCES auth_users(id),csrf TEXT NOT NULL,expires_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS ai_replies(user_id TEXT NOT NULL,request_key TEXT NOT NULL,request_hash TEXT NOT NULL,reply TEXT NOT NULL,PRIMARY KEY(user_id,request_key));
  `);
 }
 session(token){return token && this.db.prepare('SELECT s.csrf,s.expires_at,u.id,u.name FROM auth_sessions s LEFT JOIN auth_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires_at>?').get(hash(token),Date.now());}
 createSession(userId=null){
  const token=randomBytes(32).toString('base64url'),csrf=randomBytes(32).toString('base64url');
  this.db.prepare('DELETE FROM auth_sessions WHERE expires_at < ?').run(Date.now());
  this.db.prepare('INSERT INTO auth_sessions VALUES(?,?,?,?)').run(hash(token),userId,csrf,Date.now()+7*86400000);
  return {token,csrfToken:csrf};
 }
 revoke(token){if(token)this.db.prepare('DELETE FROM auth_sessions WHERE token_hash=?').run(hash(token));}
 register(name,password){
  if(typeof name!=='string'||!/^[\p{L}\p{N}_ー .-]{2,32}$/u.test(name.trim()))throw new AuthError(400,'INVALID_NAME','名前は2〜32文字の文字・数字で入力してください。');
  if(typeof password!=='string'||password.length<12||password.length>128)throw new AuthError(400,'INVALID_PASSWORD','パスワードは12〜128文字にしてください。');
  const salt=randomBytes(16).toString('hex'),digest=scryptSync(password,salt,64).toString('hex'),id=randomUUID();
  try {this.db.prepare('INSERT INTO auth_users VALUES(?,?,?,?)').run(id,name.trim(),salt+':'+digest,Date.now());}
  catch(e){if(e.code==='ERR_SQLITE_ERROR'&&String(e.message).includes('UNIQUE'))throw new AuthError(409,'NAME_EXISTS','この名前は既に使われています。');throw e;}
  return {id,name:name.trim()};
 }
 login(name,password){
  if(typeof name!=='string'||typeof password!=='string'||password.length>128)throw new AuthError(401,'LOGIN_FAILED','名前またはパスワードが違います。');
  const user=this.db.prepare('SELECT * FROM auth_users WHERE name=?').get(name.trim());
  const [salt,digest]=(user?.password||('0'.repeat(32)+':'+ '0'.repeat(128))).split(':');
  const actual=scryptSync(password,salt,64),expected=Buffer.from(digest,'hex');
  if(!user||!timingSafeEqual(actual,expected))throw new AuthError(401,'LOGIN_FAILED','名前またはパスワードが違います。');
  return {id:user.id,name:user.name};
 }
 reply(userId,key,request){
  const row=this.db.prepare('SELECT * FROM ai_replies WHERE user_id=? AND request_key=?').get(userId,key);
  if(row&&row.request_hash!==hash(JSON.stringify(request)))throw new AuthError(409,'KEY_CONFLICT','同じ操作番号で別の会話を送信できません。');
  return row?JSON.parse(row.reply):null;
 }
 saveReply(userId,key,request,reply){this.db.prepare('INSERT INTO ai_replies VALUES(?,?,?,?)').run(userId,key,hash(JSON.stringify(request)),JSON.stringify(reply));}
 close(){this.db.close();}
}
export function cookieToken(req){return /(?:^|;\s*)sn_session=([A-Za-z0-9_-]+)/.exec(req.headers.cookie||'')?.[1];}
export function cookie(token,secure=false){return `sn_session=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=604800${secure?'; Secure':''}`;}
export function checkCsrf(session,value){return !!session&&typeof value==='string'&&value.length===session.csrf.length&&timingSafeEqual(Buffer.from(value),Buffer.from(session.csrf));}
