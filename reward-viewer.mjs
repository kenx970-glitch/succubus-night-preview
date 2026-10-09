export function setupRewardViewer({request,onResult,onError,onStart}){
 const $=id=>document.getElementById(id),video=$('reward-video');
 let view=null,playing=false,starting=false,lastPing=0,timer=null,config=null,sending=false,epoch=0;
 const update=()=>{$('reward-start').disabled=playing||starting||!config;$('reward-stop').hidden=!playing;$('reward-player').hidden=!playing;};
 async function close(){
  if(!playing&&!starting&&!view)return;
  const previous=view;++epoch;playing=false;starting=false;sending=false;view=null;
  clearInterval(timer);video.pause();update();$('reward-status').textContent='視聴を終了しました。';
  if(previous?.status==='active')await request('/rewards/'+previous.id+'/cancel',{}).catch(()=>{});
 }
 async function start(){
  if(playing||starting||!config)return;
  const token=++epoch;starting=true;update();
  try{
   await onStart();const result=await request('/rewards/start',{});
   if(token!==epoch){await request('/rewards/'+result.view.id+'/cancel',{}).catch(()=>{});return;}
   view=result.view;playing=true;starting=false;sending=false;update();lastPing=performance.now();
   $('reward-progress').value=view.verifiedSeconds||0;
   $('reward-count').textContent=Math.floor(view.verifiedSeconds||0)+' / '+config.durationSeconds+'秒';
   $('reward-status').textContent='視聴中 · '+config.durationSeconds+'秒で'+config.rewardG+'G';video.currentTime=0;
   try{await video.play();}catch{await close();throw new Error('動画を再生できませんでした。');}
   if(token!==epoch)return;
   timer=setInterval(async()=>{
    if(token!==epoch||!playing||sending||document.hidden||video.paused||video.readyState<3||performance.now()-lastPing<5000)return;
    sending=true;lastPing=performance.now();const id=view.id;
    try{
     const r=await request('/rewards/'+id+'/heartbeat',{});if(token!==epoch)return;
     view=r.view;$('reward-progress').value=Math.min(config.durationSeconds,view.verifiedSeconds);
     $('reward-count').textContent=Math.floor(view.verifiedSeconds)+' / '+config.durationSeconds+'秒';
     if(view.verifiedSeconds>=config.durationSeconds){
      const done=await request('/rewards/'+id+'/finish',{});if(token!==epoch)return;
      view=null;playing=false;clearInterval(timer);video.pause();update();
      await onResult(done);$('reward-status').textContent=done.rewardG+'Gを受け取りました。';
     }
    }catch(e){if(token===epoch)$('reward-status').textContent=e.message;}
    finally{if(token===epoch)sending=false;}
   },1000);
  }finally{if(token===epoch){starting=false;update();}}
 }
 $('reward-start').addEventListener('click',()=>start().catch(e=>onError(e.message)));
 $('reward-stop').addEventListener('click',()=>close().catch(e=>onError(e.message)));
 document.addEventListener('visibilitychange',()=>{
  if(!playing)return;if(document.hidden)video.pause();else{lastPing=performance.now();video.play().catch(()=>{});}
 });
 window.addEventListener('pagehide',()=>{clearInterval(timer);video.pause();});
 update();
 return {initialize(c){config=c;$('reward-progress').max=c.durationSeconds;$('reward-start').textContent='動画を見て'+c.rewardG+'Gを受け取る';update();},close};
}

