import {rmsOf,inputGain,voiceDetected} from './voice-input.mjs';
import {PcmEncoder,decodePcm} from './live-audio.mjs';

export function setupGeminiLive({session,state,cast,requestSession,onReply,onStage,onError,onPartial}){
 const $=id=>document.getElementById(id),audio=$('cached-audio');
 let socket=null,context=null,analyser=null,mic=null,source=null,processor=null,encoder=null;
 let active=false,processing=false,connecting=false,ready=false,utterance=null,preRoll=[],lastLoud=0,listenSince=0,playAt=0,epoch=0,completed=false;
 let sources=new Set(),drainTimer,animation,lastResult,waitTimer,connectPromise,resolveReady,rejectReady,textResolve,textReject,closeExpected=false;
 const price=()=>session().capabilities.voicePriceS||5;
 const canStart=()=>session().capabilities.realtime&&$('voice-consent').checked&&$('adult-consent').checked&&(state()?.wallet?.S||0)>=price()&&!state()?.wallet?.debtS&&!active&&!processing&&!connecting;
 const stage=(name,message)=>{onStage(name,message);if(message)$('voice-status').textContent=message;$('mic-start').disabled=!canStart();$('mic-stop').hidden=!active&&!processing&&!connecting;$('mic-send').hidden=!active||processing;$('mic-send').disabled=!utterance||processing;$('mic-input').hidden=!active||processing;if(!active||processing)$('mic-level').value=0;};
 function ensure(){if(!$('voice-consent').checked||!$('adult-consent').checked)throw new Error('18歳以上であることと、返答料金・音声の送信先を確認してください。');if((state()?.wallet?.S||0)<price()||state()?.wallet?.debtS>0)throw new Error(`返答には${price()}Sが必要です。無料の会話と物語は続けられます。`);}
 async function initAudio(){if(!context){context=new AudioContext({latencyHint:'interactive'});analyser=context.createAnalyser();analyser.fftSize=256;analyser.connect(context.destination);}await context.resume();}
 function send(value){if(socket?.readyState!==WebSocket.OPEN||!ready)throw new Error('音声接続が切れました。再開してください。');if(socket.bufferedAmount>1000000)throw new Error('通信が遅れています。音声を再開してください。');socket.send(value instanceof ArrayBuffer?value:JSON.stringify(value));}
 function waiting(){clearInterval(waitTimer);const started=performance.now();waitTimer=setInterval(()=>stage('thinking',`${cast().name}のお返事を待っています · ${Math.floor((performance.now()-started)/1000)}秒`),1000);}
 function stopPlayback(){clearTimeout(drainTimer);for(const s of sources){try{s.stop();}catch{}}sources.clear();playAt=context?.currentTime||0;if(animation)cancelAnimationFrame(animation);}
 function animate(){if(!sources.size)return;const data=new Uint8Array(analyser.frequencyBinCount);analyser.getByteTimeDomainData(data);const power=Math.sqrt(data.reduce((n,x)=>n+(x-128)**2,0)/data.length);onStage('speaking',null,power>3?'talking':lastResult?.emotion||'neutral');animation=requestAnimationFrame(animate);}
 function play(buffer){
  clearInterval(waitTimer);const samples=decodePcm(buffer),chunk=context.createBuffer(1,samples.length,24000);chunk.copyToChannel(samples,0);
  const node=context.createBufferSource();node.buffer=chunk;node.connect(analyser);sources.add(node);node.onended=()=>{sources.delete(node);node.disconnect();};
  playAt=Math.max(playAt,context.currentTime+.06);node.start(playAt);playAt+=chunk.duration;
  stage('speaking',`${cast().name}のお返事 · Gemini Live`);if(sources.size===1)animate();
 }
 async function afterPlayback(result){
  completed=true;lastResult=result;await onReply(result);audio.src=result.audioUrl;$('voice-replay').disabled=false;
  clearTimeout(drainTimer);const generation=epoch;
  drainTimer=setTimeout(()=>{if(generation!==epoch)return;processing=false;utterance=null;stage('idle',`返答に${result.priceS}S使用 · 聞き直しは追加消費なし`);textResolve?.(result);textResolve=textReject=null;if(active)listen().catch(failure);},Math.max(0,(playAt-(context?.currentTime||0))*1000)+100);
 }
 function failure(error){const message=error?.message||'音声を再開してください。';const reject=textReject;stop();reject?.(new Error(message));stage('idle',message);onError(message);}
 async function connect(){
  if(ready&&socket?.readyState===WebSocket.OPEN)return;
  if(connectPromise)return connectPromise;
  const generation=epoch;connecting=true;stage('connecting','Gemini Liveにつないでいます…');
  connectPromise=(async()=>{
   const room=await requestSession({castId:cast().id,priceS:price(),adultConfirmed:$('adult-consent').checked,consent:$('voice-consent').checked,key:crypto.randomUUID()});
   if(generation!==epoch)throw new Error('接続を停止しました。');
   const url=new URL(room.socketPath,location.href);if(url.origin!==location.origin||url.pathname!=='/api/live/socket')throw new Error('接続先を確認できませんでした。');url.protocol=location.protocol==='https:'?'wss:':'ws:';
   const ws=new WebSocket(url.href);socket=ws;ws.binaryType='arraybuffer';closeExpected=false;
   await new Promise((resolve,reject)=>{
    resolveReady=resolve;rejectReady=reject;const timeout=setTimeout(()=>reject(new Error('接続の準備に時間がかかっています。再開してください。')),20000);
    ws.onmessage=async event=>{
     if(generation!==epoch)return;
     try{
      if(event.data instanceof ArrayBuffer){if(!processing)throw new Error('予期しない音声が届きました。');play(event.data);return;}
      const message=JSON.parse(event.data);
      if(message.type==='ready'){clearTimeout(timeout);ready=true;connecting=false;resolve();return;}
      if(message.type==='reserved'){await onReply({state:message.state});if(utterance){utterance.reserved=true;for(const chunk of utterance.pending)send(chunk);utterance.pending=[];if(utterance.ended)send({type:'end',key:utterance.key});}return;}
      if(message.type==='transcript'){onPartial?.(message.text,message.emotion);return;}
      if(message.type==='complete'){
       clearInterval(waitTimer);if(message.replay){const response=await fetch(message.result.audioUrl,{credentials:'same-origin'});if(!response.ok)throw new Error('保存済み音声を取得できませんでした。');const wav=await response.arrayBuffer();play(wav.slice(44));}
       await afterPlayback(message.result);return;
      }
      if(message.type==='session_end'){ready=false;closeExpected=true;if(message.state)await onReply({state:message.state});if(message.code!=='LIVE_ROTATE'){active=false;stopMicrophone();if(!(processing&&completed)){failure(new Error(message.message));}}return;}
      if(message.type==='error'){if(message.state)await onReply({state:message.state});clearTimeout(timeout);reject(new Error(message.message));failure(new Error(message.message));}
     }catch(e){clearTimeout(timeout);reject(e);failure(e);}
    };
    ws.onerror=()=>{clearTimeout(timeout);reject(new Error('音声接続を確認できませんでした。'));};
    ws.onclose=()=>{clearTimeout(timeout);ready=false;connecting=false;socket=null;if(generation!==epoch)return;if(!closeExpected){reject(new Error('音声接続が切れました。未完了の返答はSが戻ります。'));failure(new Error('音声接続が切れました。履歴で残高を確認して再開してください。'));}};
   });
  })().finally(()=>{connecting=false;connectPromise=null;resolveReady=rejectReady=null;});return connectPromise;
 }
 async function listen(){ensure();if(!active)return;await connect();if(!active)return;utterance=null;preRoll=[];listenSince=performance.now();lastLoud=listenSince;stage('listening',`${cast().name}が聞いています · 返答1回 ${price()}S`);}
 function finish(){
  if(!active||processing)return;if(!utterance){stage('listening','声が小さめです。マイクを近づけて話してください。Sは消費していません。');return;}
  utterance.ended=true;processing=true;if(utterance.reserved)send({type:'end',key:utterance.key});stage('thinking',`${cast().name}がお返事しています…`);waiting();
 }
 function stopMicrophone(){if(processor){processor.onaudioprocess=null;processor.disconnect();}source?.disconnect();processor=source=null;mic?.getTracks().forEach(t=>t.stop());mic=null;}
 function stop(){
  epoch++;active=false;processing=false;connecting=false;ready=false;clearInterval(waitTimer);stopPlayback();stopMicrophone();utterance=null;preRoll=[];
  rejectReady?.(new Error('接続を停止しました。'));textReject?.(new Error('会話を停止しました。'));textResolve=textReject=null;
  if(socket?.readyState===WebSocket.OPEN)socket.send(JSON.stringify({type:'stop'}));socket?.close();socket=null;audio.pause();stage('idle','マイク停止 · 未完了の返答のSは戻ります。');
 }
 async function start(){
  if(active||processing||connecting)return;ensure();if(!navigator.mediaDevices?.getUserMedia)throw new Error('マイクに対応したChrome・Edge・Safariで開いてください。');
  await initAudio();audio.pause();const generation=epoch;
  try{mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true,channelCount:1}});}catch(e){const reasons={NotAllowedError:'マイクを許可してください。ブラウザのサイト設定から変更できます。',NotFoundError:'マイクが見つかりません。接続を確認してください。',NotReadableError:'マイクを使用中の別の通話アプリを閉じてください。'};throw new Error(reasons[e.name]||'マイクに接続できませんでした。');}
  if(generation!==epoch){stopMicrophone();return;}
  active=true;try{await connect();}catch(e){stop();throw e;}if(!active)return;
  encoder=new PcmEncoder(context.sampleRate);source=context.createMediaStreamSource(mic);processor=context.createScriptProcessor(2048,1,1);source.connect(processor);processor.connect(context.destination);
  processor.onaudioprocess=event=>{
   if(!active||processing||!ready||sources.size)return;
   try{
    const input=event.inputBuffer.getChannelData(0),rms=rmsOf(input),now=performance.now(),pcm=encoder.push(input,inputGain(input));$('mic-level').value=Math.min(1,rms*10);
    if(!utterance){
     preRoll.push(pcm);if(preRoll.length>8)preRoll.shift();
     if(voiceDetected(rms)){
      ensure();completed=false;utterance={key:crypto.randomUUID(),reserved:false,pending:preRoll.slice(),ended:false,started:now};preRoll=[];lastLoud=now;send({type:'begin',key:utterance.key,priceS:price()});stage('listening',`${cast().name}が聞いています · 話し終えると返答します`);
     }else if(now-listenSince>40000){stop();stage('idle','お話がなかったためマイクを停止しました。Sは消費していません。');}
    }else{
     if(voiceDetected(rms,true))lastLoud=now;if(utterance.reserved)send(pcm);else {utterance.pending.push(pcm);if(utterance.pending.length>200)throw new Error('音声送信を開始できませんでした。');}
     if(now-lastLoud>800||now-utterance.started>28000)finish();
    }
   }catch(e){failure(e);}
  };
  await listen();
 }
 async function textTurn(text){
  if(active||processing||connecting)throw new Error('現在の音声会話を停止してから送信してください。');ensure();await initAudio();await connect();processing=true;completed=false;utterance=null;playAt=context.currentTime;stage('thinking',`${cast().name}がお返事しています…`);waiting();
  return new Promise((resolve,reject)=>{textResolve=resolve;textReject=reject;try{send({type:'text',key:crypto.randomUUID(),priceS:price(),text});}catch(e){failure(e);}});
 }
 window.addEventListener('pagehide',stop);document.addEventListener('visibilitychange',()=>{if(document.hidden&&(active||processing||connecting))stop();});
 return {start,stop,textTurn,finish,get active(){return active||connecting;},get processing(){return processing;}};
}
