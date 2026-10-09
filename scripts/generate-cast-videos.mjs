import {readFile,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {resolve} from 'node:path';
import {Fal,FAL_MODELS} from '../src/fal.mjs';
const root=fileURLToPath(new URL('../',import.meta.url)),fal=new Fal();
const submit=process.argv[2]==='submit';
const queue=resolve(root,'data/cast-video-jobs.json');
let jobs;try{jobs=JSON.parse(await readFile(queue,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;jobs=[];}
const save=()=>writeFile(queue,JSON.stringify(jobs,null,2)+'\n');
const moods={
 idle:'She quietly listens, breathes gently, blinks naturally once, gives a subtle acknowledging nod and a soft closed-mouth smile. No speaking movements.',
 neutral:'She naturally speaks a short friendly Japanese sentence with realistic subtle mouth movement, a little acknowledging nod and warm eye contact. Calm friendly expression.',
 happy:'She naturally speaks with a bright affectionate cafe-host smile, a little delighted laugh and small friendly nod. Her eyes smile warmly. Subtle realistic speaking mouth movements.',
 sad:'She naturally speaks softly with a gently sympathetic expression and slightly concerned eyebrows, giving a small reassuring nod. Subtle realistic speaking mouth movements. No tears or distress.',
 angry:'She naturally speaks with a gently indignant expression about an unfair event, slight eyebrow frown, then relaxes into reassurance. Subtle realistic speaking mouth movements. No aggression, no scolding, no threats.',
 surprised:'She naturally speaks with a brief pleasantly surprised expression, eyes widen slightly and eyebrows lift, then gives a small warm smile. Subtle realistic speaking mouth movements.'
};
const base='Cinematic ultra-photorealistic live-action cafe conversation. Preserve exactly the ONE adult woman in the reference, her facial identity, hairstyle, ornamental horns, fully covered burgundy uniform, hands, room and lighting. The camera is the eye-level perspective of a guest seated across the small cafe table. Locked camera, no camera cuts, no zoom, no camera shake. Only tiny natural head, facial and upper body motions, realistic breathing and blinking. Hands remain relaxed on the table. ';
for(const castId of ['luna','mio','reina'])for(const [mood,direction] of Object.entries(moods)){
 const id=castId+'-'+mood;if(jobs.some(j=>j.id===id)||!submit)continue;
 const job={id,castId,mood,kind:'video',file:id+'.mp4',model:FAL_MODELS.video,status:'submitting',createdAt:new Date().toISOString()};jobs.push(job);await save();
 const image='data:image/png;base64,'+(await readFile(resolve(root,'public/media',castId+'-seated.png'))).toString('base64');
 job.prompt=base+direction+' Return smoothly to exactly the original calm pose and original expression in the last half second. First and last frames match for a seamless loop. No other people, no text, no logos, no sexualization.';
 try{Object.assign(job,await fal.submit(job.model,{start_image_url:image,end_image_url:image,prompt:job.prompt,duration:'5',generate_audio:false,negative_prompt:'extra people, distorted face, distorted fingers, strong movement, camera cuts, camera movement, text, logos, nudity'}),{status:'queued'});await save();console.log('accepted '+id+' '+job.request_id);}
 catch(e){job.status='unknown';job.error=e.code||'UNKNOWN';await save();throw e;}
}
for(const job of jobs){
 if(['ready','failed','unknown','submitting'].includes(job.status))continue;
 const s=await fal.status(job);job.providerStatus=s.status;
 if(s.status==='COMPLETED'){
  if(s.error){job.status='failed';job.error='PROVIDER_GENERATION_FAILED';}
  else{const r=await fal.result(job);job.bytes=await fal.download(r.video.url,resolve(root,'public/media',job.file),'video');job.status='ready';console.log('saved '+job.id+' '+job.bytes);}
 }
 await save();
}
const manifestPath=resolve(root,'public/media/manifest.json'),manifest=JSON.parse(await readFile(manifestPath,'utf8'));
manifest.assets=manifest.assets.filter(a=>!a.mood);
manifest.assets.push(...jobs.filter(j=>j.status==='ready').map(j=>({id:j.id,castId:j.castId,mood:j.mood,kind:'video',url:'/media/'+j.file,model:j.model,requestId:j.request_id,bytes:j.bytes})));
await writeFile(manifestPath,JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify(jobs.map(j=>({id:j.id,status:j.status,providerStatus:j.providerStatus}))));
