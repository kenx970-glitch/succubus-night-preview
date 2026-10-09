import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {resolve} from 'node:path';
import {CASTS} from './catalog.mjs';
export const FAL_MODELS={video:'fal-ai/kling-video/v3/pro/image-to-video',tts:'google/gemini-3.8-flash-tts'};
export class FalError extends Error{constructor(code,message){super(message);this.code=code;}}
export class Fal {
 constructor({key=process.env.FAL_KEY,fetchImpl=fetch}={}){this.key=key;this.fetch=fetchImpl;}
 async request(url,method='GET',body){
  if(!this.key)throw new FalError('FAL_NOT_CONFIGURED','FAL_KEY is not configured.');
  const target=new URL(url);if(target.protocol!=='https:'||target.hostname!=='queue.fal.run'||target.username||target.password)throw new FalError('INVALID_FAL_URL','Untrusted fal queue URL.');
  let response;try{response=await this.fetch(url,{method,headers:{Authorization:'Key '+this.key,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(60000),redirect:'error'});}catch{throw new FalError('FAL_UNKNOWN','Submission outcome unknown. Do not automatically resubmit a billable request. Check fal request history.');}
  if(!response.ok)throw new FalError('FAL_PROVIDER_ERROR',`fal request failed (HTTP ${response.status}). Check model access and account balance.`);
  return response.json();
 }
 submit(model,input){if(!Object.values(FAL_MODELS).includes(model))throw new FalError('MODEL_NOT_ALLOWED','Model is not allowlisted.');return this.request('https://queue.fal.run/'+model,'POST',input);}
 async status(job){const status=await this.request(job.status_url);if(status.request_id&&status.request_id!==job.request_id)throw new FalError('REQUEST_MISMATCH','Provider request ID mismatch.');return status;}
 result(job){return this.request(job.response_url);}
 async download(url,destination,kind){
  const target=new URL(url);
  if(target.protocol!=='https:'||target.username||target.password||!(target.hostname==='fal.media'||target.hostname.endsWith('.fal.media')||target.hostname==='storage.googleapis.com'))throw new FalError('UNTRUSTED_MEDIA_URL','Unexpected media storage origin.');
  const response=await this.fetch(url,{signal:AbortSignal.timeout(60000),redirect:'error'});
  if(!response.ok||Number(response.headers.get('content-length')||0)>50000000)throw new FalError('INVALID_MEDIA','Media download failed or too large.');
  const chunks=[];let count=0;for await(const part of response.body){count+=part.length;if(count>50000000)throw new FalError('MEDIA_TOO_LARGE','Media exceeds limit.');chunks.push(part);}
  const bytes=Buffer.concat(chunks);
  const valid=kind==='video'?bytes.subarray(4,8).toString()==='ftyp':(bytes.subarray(0,4).toString()==='RIFF'&&bytes.subarray(8,12).toString()==='WAVE');
  if(!valid)throw new FalError('INVALID_MEDIA_TYPE','Output is not the expected MP4 or WAV.');
  await writeFile(destination,bytes);return count;
 }
}
export const VOICES={luna:'Aoede',mio:'Zephyr',reina:'Leda'};
export function ttsInput(cast){return {prompt:cast.greeting,voice:VOICES[cast.id],style_instructions:`自然な日本語。可愛く明るい成人女性の声で、少し高めの柔らかな声色。${cast.personality} 隣に座った友達とおしゃべりするように、笑顔が伝わる軽い相づちと生き生きした抑揚。丁寧な店内放送や朗読ではなく、フランクな普段の会話。軽快なテンポ、短い自然な間。語尾を引き伸ばしすぎない。幼児や極端なアニメ声にはしない。過度な息遣いや誘惑的な声を避ける。名前の読みはルナ、ミオ、レイナ。`,enable_safety_checker:true};}
export const VIDEO_PROMPT='A five-second cinematic welcoming moment in an elegant burgundy and gold Japanese fantasy concept cafe. Preserve exactly these three adult women and their distinct faces, hairstyles, fully covered burgundy uniforms and small horn accessories. They gently lower their extended hands, breathe naturally, blink once and give a small warm smile. Realistic subtle movements, stable identities, correct hands, same framing and lighting, locked-off camera, no camera cuts. No speaking, no mouth talking motions, no sexualization, no text. End in a relaxed pose suitable for a gentle looping game scene.';
export async function generateStarterMedia(directory,{fal=new Fal(),submit=true}={}){
 const mediaDir=resolve(directory,'public/media');await mkdir(mediaDir,{recursive:true});
 const queueFile=resolve(directory,'data/fal-jobs.json');await mkdir(resolve(directory,'data'),{recursive:true});
 let jobs;try{jobs=JSON.parse(await readFile(queueFile,'utf8'));}catch(e){if(e.code!=='ENOENT')throw e;jobs=[];}
 const save=()=>writeFile(queueFile,JSON.stringify(jobs,null,2)+'\n');
 const briefs=[{id:'welcome',kind:'video',file:'welcome.mp4',model:FAL_MODELS.video},...CASTS.map(c=>({id:c.id+'-greeting',kind:'audio',castId:c.id,file:c.id+'-greeting.wav',model:FAL_MODELS.tts}))];
 for(const brief of briefs){
  let job=jobs.find(j=>j.id===brief.id);if(job||!submit)continue;
  job={...brief,status:'submitting',createdAt:new Date().toISOString()};jobs.push(job);await save();
  let input;
  if(brief.kind==='video')input={start_image_url:'data:image/png;base64,'+(await readFile(resolve(directory,'public/casts.png'))).toString('base64'),prompt:VIDEO_PROMPT,duration:'5',generate_audio:false,negative_prompt:'blur, distorted faces, extra fingers, extra people, nudity, talking, text, logos, camera cuts'};
  else input=ttsInput(CASTS.find(c=>c.id===brief.castId));
  try{const accepted=await fal.submit(brief.model,input);Object.assign(job,accepted,{status:'queued'});await save();console.log('fal accepted: '+brief.id+' / '+accepted.request_id);}
  catch(e){job.status='unknown';job.error=e.code||'UNKNOWN';await save();console.log('fal submission unresolved: '+brief.id+' / '+job.error);throw e;}
 }
 const publicManifest=async()=>{await writeFile(resolve(mediaDir,'manifest.json'),JSON.stringify({generatedAt:new Date().toISOString(),models:FAL_MODELS,assets:jobs.filter(j=>j.status==='ready').map(j=>({id:j.id,castId:j.castId,kind:j.kind,url:'/media/'+j.file,model:j.model,requestId:j.request_id,bytes:j.bytes}))},null,2)+'\n');};
 await publicManifest();
 for(const job of jobs){
  if(job.status==='ready'||job.status==='failed'||job.status==='unknown'||job.status==='submitting')continue;
  const status=await fal.status(job);job.providerStatus=status.status;
  if(status.status==='COMPLETED'){
   if(status.error){job.status='failed';job.error='PROVIDER_GENERATION_FAILED';console.log('fal generation failed: '+job.id);}
   else {const result=await fal.result(job),asset=job.kind==='video'?result.video:result.audio;if(!asset?.url)throw new FalError('MISSING_MEDIA','Provider did not return media.');job.bytes=await fal.download(asset.url,resolve(mediaDir,job.file),job.kind);job.status='ready';console.log('fal media saved: '+job.id+' ('+job.bytes+' bytes)');}
  }
  await save();await publicManifest();
 }
 return jobs.map(j=>({id:j.id,status:j.status,providerStatus:j.providerStatus}));
}
