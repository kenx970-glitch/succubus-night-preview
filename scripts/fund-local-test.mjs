// Offline-only QA utility. Never expose this operation as an HTTP endpoint.
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {Economy} from '../src/economy.mjs';
const targetG=50000,targetS=2000;
if(process.argv[2]!=='--all-local-accounts')throw new Error('Explicit local test flag required.');
if(process.env.HOST&&!['127.0.0.1','localhost','::1'].includes(process.env.HOST))throw new Error('Local testing only.');
const path=fileURLToPath(new URL('../data/succubus.sqlite',import.meta.url)),db=new DatabaseSync(path),economy=new Economy(path);
for(const user of db.prepare('SELECT id,name FROM auth_users').all()){
 economy._tx(()=>{
  economy._ensure(user.id);
  const wallet=economy._wallet(user.id);
  const addG=Math.max(0,targetG-wallet.G),addS=Math.max(0,targetS-wallet.S);
  if(addG)economy._writeLedger(user.id,'G',addG,'test_credit','local-preview-g-'+Date.now());
  if(addS)economy._writeLedger(user.id,'S',addS,'test_credit','local-preview-s-'+Date.now());
 });
 const wallet=economy.state(user.id).wallet;console.log(JSON.stringify({name:user.name,G:wallet.G,S:wallet.S,testOnly:true,realPayment:false}));
}
economy.close();db.close();
