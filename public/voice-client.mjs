import {rmsOf,chunksRms,inputGain,voiceDetected} from './voice-input.mjs';
import {setupGeminiLive} from './gemini-live-client.mjs';
export function setupVoiceConversation(options){
 let lastResult=null;const onReply=async result=>{if(result.reply)lastResult=result;await options.onReply(result);};
 const batch=setupBatchVoiceConversation({...options,onReply,bindControls:false});
 const live=setupGeminiLive({...options,onReply});
 const selected=()=>options.session().capabilities.aiProvider==='gemini-live'?live:batch;
 const $=id=>document.getElementById(id);
 const stop=()=>{live.stop();batch.stop();};
 $('mic-start').addEventListener('click',()=>selected().start().catch(e=>options.onError(e.message)));
 $('mic-stop').addEventListener('click',stop);$('mic-send').addEventListener('click',()=>{try{selected().finish();}catch(e){options.onError(e.message);}});
 $('voice-replay').addEventListener('click',()=>{if(lastResult){live.stop();batch.replay(lastResult).catch(()=>options.onError('音声を再生できませんでした。'));}});
 return {start:()=>selected().start(),stop,clearReplay(){lastResult=null;live.stop();batch.clearReplay();},textTurn:text=>selected().textTurn(text),replay:async result=>{live.stop();lastResult=result;return batch.replay(result);},get active(){return live.active||batch.active;},get processing(){return live.processing||batch.processing;}};
}
function setupBatchVoiceConversation({session,state,cast,request,onReply,onStage,onError,bindControls=true}){
 const $=id=>document.getElementById(id),audio=$('cached-audio');
 let running=false,processing=false,mic=null,ctx=null,source=null,processor=null,analyser=null,playerSource=null;
 let samples=[],started=0,lastLoud=0,speechStarted=false,frameTimer=null,lastResult=null,spokenEmotion='neutral',playEpoch=0;
 const price=()=>session().capabilities.voicePriceS||5;
 const canStart=()=>session().capabilities.ai&&$('voice-consent').checked&&(state()?.wallet?.S||0)>=price()&&!state()?.wallet?.debtS&&!running&&!processing;
 const stage=(name,message)=>{onStage(name,message);if(message)$('voice-status').textContent=message;$('mic-start').disabled=!canStart();$('mic-stop').hidden=!running&&!processing&&audio.paused;$('mic-input').hidden=!running||processing;if(!running||processing)$('mic-level').value=0;$('mic-send').hidden=!running;$('mic-send').disabled=!running||processing;};
 function ensureBalance(){if((state()?.wallet?.S||0)<price()||state()?.wallet?.debtS>0)throw new Error(`音声の返答には${price()}Sが必要です。残高内で利用してください。無料の定型会話は続けられます。`);}
 async function context(){if(!ctx){ctx=new AudioContext();playerSource=ctx.createMediaElementSource(audio);analyser=ctx.createAnalyser();analyser.fftSize=256;playerSource.connect(analyser);analyser.connect(ctx.destination);}if(ctx.state!=='running')await ctx.resume();return ctx;}
 function setMicEnabled(value){mic?.getAudioTracks().forEach(t=>t.enabled=value);}
 function listen(){if(!running)return;try{ensureBalance();}catch(e){stop();onError(e.message);return;}samples=[];started=performance.now();lastLoud=started;speechStarted=false;setMicEnabled(true);stage('listening',`${cast().name}が聞いています · 返答1回 ${price()}S · 話し終えると自動送信`);}
 function encodeWav(chunks,rate){
  const total=chunks.reduce((n,c)=>n+c.length,0),input=new Float32Array(total);let offset=0;for(const c of chunks){input.set(c,offset);offset+=c.length;}
  const gain=inputGain(input);for(let i=0;i<input.length;i++)input[i]*=gain;
  const count=Math.min(480000,Math.floor(input.length*16000/rate)),buffer=new ArrayBuffer(44+count*2),v=new DataView(buffer);
  function word(at,s){for(let i=0;i<s.length;i++)v.setUint8(at+i,s.charCodeAt(i));}
  word(0,'RIFF');v.setUint32(4,buffer.byteLength-8,true);word(8,'WAVE');word(12,'fmt ');v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);v.setUint32(24,16000,true);v.setUint32(28,32000,true);v.setUint16(32,2,true);v.setUint16(34,16,true);word(36,'data');v.setUint32(40,count*2,true);
  for(let i=0;i<count;i++){const x=i*rate/16000,p=Math.floor(x),t=x-p,s=(input[p]||0)*(1-t)+(input[p+1]||0)*t;v.setInt16(44+i*2,Math.round(Math.max(-1,Math.min(1,s))*(s<0?32768:32767)),true);}
  const bytes=new Uint8Array(buffer);let binary='';for(let i=0;i<bytes.length;i+=8192)binary+=String.fromCharCode(...bytes.subarray(i,i+8192));return 'data:audio/wav;base64,'+btoa(binary);
 }
 async function send(data){
  if(processing)throw new Error('返答の準備中です。');ensureBalance();const generation=playEpoch;processing=true;setMicEnabled(false);await context();
  stage('thinking',`${cast().name}がお返事を考えています…`);
  const waitingSince=performance.now(),waitingTimer=setInterval(()=>{if(generation===playEpoch)$('voice-status').textContent=`音声の返答を作成中 · ${Math.floor((performance.now()-waitingSince)/1000)}秒経過 · 完了すると自動で再生します`;},1000);
  try{
   const result=await request({...data,castId:cast().id,priceS:price()});clearInterval(waitingTimer);lastResult=result;spokenEmotion=result.emotion||'neutral';
   await onReply(result);$('voice-replay').disabled=false;
   const url=new URL(result.audioUrl,location.origin);if(url.origin!==location.origin||!/^\/api\/voice\/[A-Za-z0-9_-]+\/audio$/.test(url.pathname))throw new Error('音声の取得先を確認できませんでした。');
   audio.src=url.href;if(generation===playEpoch){stage('speaking',`${cast().name}の返答 · ${result.priceS}S使用 · 聞き直しは追加消費なし`);await audio.play();}return result;
  }catch(e){stop();stage('idle',e.message+' 履歴で残高を確認できます。');onError(e.message);throw e;}
  finally{clearInterval(waitingTimer);processing=false;$('mic-start').disabled=!canStart();$('mic-send').disabled=!running;}
 }
 async function finishUtterance(manual=false){
  if(!running||processing)return;
  if(samples.length<3||(!speechStarted&&!manual)||chunksRms(samples)<.0015){stage('listening','音声が小さめです。マイクを近づけて、話し終えたら「話し終えた」を押してください。Sは消費していません。');return;}
  const data=encodeWav(samples,ctx.sampleRate);samples=[];speechStarted=false;
  try{await send({audioDataURI:data});}catch{}
 }
 async function start(){
  if(running)return;ensureBalance();if(!$('voice-consent').checked)throw new Error('返答料金と音声の送信先を確認してください。');
  if(!navigator.mediaDevices?.getUserMedia||!window.AudioContext)throw new Error('このブラウザではマイク入力に対応していません。ChromeまたはEdgeで開いてください。');
  await context();try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true}});}catch(e){const reasons={NotAllowedError:'マイクが許可されていません。ブラウザのマイク設定で、このサイトへのアクセスを許可してください。',NotFoundError:'マイクが見つかりません。PCにマイクを接続してから再開してください。',NotReadableError:'マイクを使用できません。ほかの通話アプリを閉じて、Windowsのマイクアクセス設定を確認してください。'};throw new Error(reasons[e.name]||'マイクに接続できません。ChromeまたはEdgeでゲームを開き、マイクを許可してください。');}
  source=ctx.createMediaStreamSource(mic);processor=ctx.createScriptProcessor(4096,1,1);source.connect(processor);processor.connect(ctx.destination);
  processor.onaudioprocess=e=>{
   if(!running||processing||!audio.paused)return;
   const data=e.inputBuffer.getChannelData(0),rms=rmsOf(data),now=performance.now();
   $('mic-level').value=Math.min(1,rms*10);
   if(voiceDetected(rms,speechStarted)){if(!speechStarted)samples=samples.slice(-4);speechStarted=true;lastLoud=now;}
   samples.push(new Float32Array(data));
   if(!speechStarted&&samples.length*4096/ctx.sampleRate>25)samples.shift();
   if(speechStarted&&((now-lastLoud>1200&&samples.length>3)||samples.length*4096/ctx.sampleRate>=25)){finishUtterance();}
   else if(!speechStarted&&now-started>45000){stop();stage('idle','お話がなかったため、マイクを停止しました。Sは消費していません。');}
  };
  running=true;audio.pause();listen();
 }
 function stop(){playEpoch++;running=false;setMicEnabled(false);processor?.disconnect();source?.disconnect();if(processor)processor.onaudioprocess=null;processor=null;source=null;mic?.getTracks().forEach(t=>t.stop());mic=null;samples=[];speechStarted=false;audio.pause();stage('idle',processing?'マイクを停止しました。送信済みの返答は処理中です。完了するとSを使用し、履歴に保存します。':'マイク停止 · 基本会話と物語は無料です。');}
 function animateMouth(){
  if(frameTimer)cancelAnimationFrame(frameTimer);if(audio.paused||audio.ended)return;
  if(analyser){const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteTimeDomainData(data);const energy=Math.sqrt(data.reduce((n,x)=>n+(x-128)*(x-128),0)/data.length);onStage('speaking',null,energy>4?'talking':spokenEmotion);}
  frameTimer=requestAnimationFrame(animateMouth);
 }
 audio.addEventListener('play',()=>{spokenEmotion=lastResult?.emotion||'happy';stage('speaking',lastResult?.priceS?`Geminiの返答 · ${lastResult.priceS}Sで作成済み · 再生の追加消費なし`:'Gemini音声を再生中 · Sの消費なし。');animateMouth();});
 audio.addEventListener('ended',()=>{onStage('idle',null,spokenEmotion);if(running)listen();else stage('idle','返答が終わりました。聞き直しは追加消費なし。');});
 audio.addEventListener('pause',()=>{if(frameTimer)cancelAnimationFrame(frameTimer);onStage('idle',null,spokenEmotion);});
 if(bindControls){$('mic-start').addEventListener('click',()=>start().catch(e=>onError(e.message)));$('mic-stop').addEventListener('click',stop);$('mic-send').addEventListener('click',()=>finishUtterance(true));
 $('voice-replay').addEventListener('click',async()=>{try{await context();audio.currentTime=0;await audio.play();}catch(e){onError('音声を再生できませんでした。');}});}
 window.addEventListener('pagehide',stop);
 return {stop,finish:()=>finishUtterance(true),clearReplay(){stop();lastResult=null;audio.removeAttribute("src");audio.load();$("voice-replay").disabled=true;},textTurn:async text=>{await context();return send({text});},async replay(result){stop();await context();lastResult=result;spokenEmotion=result.emotion||'neutral';audio.src=result.audioUrl;await audio.play();$('voice-replay').disabled=false;},start,get processing(){return processing;},get active(){return running;}};
}
