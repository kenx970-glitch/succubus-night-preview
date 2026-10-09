import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {Fal,FAL_MODELS,ttsInput} from '../src/fal.mjs';
import {CASTS,TOPICS,ITEMS,orderLine} from '../src/catalog.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),fal=new Fal(),submit=process.argv[2]==='submit';
const jobsPath=resolve(root,'data/casual-speech-v2-jobs.json');let jobs=[];
try{jobs=JSON.parse(await readFile(jobsPath,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;}
const save=()=>writeFile(jobsPath,JSON.stringify(jobs,null,2)+'\n');
const briefs=CASTS.flatMap(cast=>[
 {cast,lineId:'greeting',text:cast.greeting},
 ...TOPICS.map(topic=>({cast,lineId:'topic-'+topic.id,text:topic.reply})),
 ...ITEMS.map(item=>({cast,lineId:'order-'+item.id,text:orderLine(cast.id,item.id)}))
]);
for(const brief of briefs){
 let id=brief.cast.id+'-casual-v2-'+brief.lineId;
 const existing=jobs.filter(j=>j.castId===brief.cast.id&&j.lineId===brief.lineId);
 if(!submit||existing.some(j=>j.text===brief.text))continue;
 if(existing.length)id+='-revision-'+createHash('sha256').update(brief.text).digest('hex').slice(0,8);
 const input={...ttsInput(brief.cast),prompt:brief.text};
 const job={id,castId:brief.cast.id,lineId:brief.lineId,text:brief.text,file:id+'.wav',voice:input.voice,model:FAL_MODELS.tts,style:input.style_instructions,status:'submitting',createdAt:new Date().toISOString()};
 jobs.push(job);await save();
 try{Object.assign(job,await fal.submit(job.model,input),{status:'queued'});await save();console.log('accepted '+id);}
 catch(e){job.status='unknown';job.error=e.code||'UNKNOWN';await save();throw e;}
}
for(const job of jobs){
 if(['ready','failed','unknown','submitting'].includes(job.status))continue;
 const status=await fal.status(job);job.providerStatus=status.status;
 if(status.status==='COMPLETED'){
  if(status.error){job.status='failed';job.error='GENERATION_FAILED';}
  else{const result=await fal.result(job);job.bytes=await fal.download(result.audio.url,resolve(root,'public/media',job.file),'audio');job.status='ready';console.log('saved '+job.id);}
 }
 await save();
}
const manifestPath=resolve(root,'public/media/manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
manifest.assets=manifest.assets.filter(a=>a.variant!=='casual-v2');
const latest=new Map();for(const job of jobs.filter(j=>j.status==='ready'))latest.set(job.castId+':'+job.lineId,job);
manifest.assets.push(...[...latest.values()].map(j=>({id:j.id,castId:j.castId,lineId:j.lineId,variant:'casual-v2',kind:'audio',url:'/media/'+j.file,model:j.model,voice:j.voice,requestId:j.request_id,bytes:j.bytes})));
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({ready:jobs.filter(j=>j.status==='ready').length,total:jobs.length}));
