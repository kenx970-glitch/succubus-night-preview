/** Two preloaded players overlap at loop boundaries; no black reset frame. */
export function setupCastStage(){
 const $=id=>document.getElementById(id),intro=$('cast-motion'),photo=$('cast-photo'),scene=$('scene'),players=[$('seat-a'),$('seat-b')];
 let assets=[],castId='luna',current=0,mood='idle',desired='idle',entered=false,enabled=!matchMedia('(prefers-reduced-motion: reduce)').matches,active=true,transition=false,epoch=0,loopFrame=null;
 const clip=()=>assets.find(a=>a.castId===castId&&a.mood===desired)||assets.find(a=>a.castId===castId&&a.mood==='idle');
 function ready(video){return new Promise(resolve=>{if(video.readyState>=3)return resolve(true);const timer=setTimeout(()=>finish(false),20000);const finish=value=>{clearTimeout(timer);video.removeEventListener('canplay',ok);video.removeEventListener('error',bad);resolve(value);};const ok=()=>finish(true),bad=()=>finish(false);video.addEventListener('canplay',ok,{once:true});video.addEventListener('error',bad,{once:true});});}
 async function swap(url,reset=false){
  const generation=++epoch;transition=true;const previous=players[current],next=players[1-current];
  if(new URL(next.src||location.href).href!==new URL(url,location.href).href){next.src=url;next.load();}else if(reset)next.currentTime=0;
  if(!await ready(next)||generation!==epoch){if(generation===epoch)transition=false;return;}
  if(!enabled||!active||document.hidden){transition=false;return;}
  next.currentTime=0;try{await next.play();}catch{transition=false;return;}
  if(generation!==epoch){next.pause();return;}
  next.style.opacity='1';previous.style.opacity='0';intro.style.opacity='0';photo.style.opacity='0';current=1-current;
  setTimeout(()=>{if(generation!==epoch)return;previous.pause();previous.currentTime=0;previous.src=url;previous.load();transition=false;},550);
 }
 function tick(){
  const v=players[current];if(active&&!document.hidden&&entered&&enabled&&!transition&&Number.isFinite(v.duration)&&v.duration>1&&v.currentTime>=v.duration-.65){const c=clip();if(c)swap(c.url,true);}
  loopFrame=requestAnimationFrame(tick);
 }
 function enter(){
  entered=true;scene.classList.add('seated');document.querySelector('.lounge-hero').classList.add('seated');
  photo.src='/media/'+castId+'-seated.png';photo.style.opacity='1';photo.style.objectPosition='60% 50%';photo.style.transform='none';photo.alt='席の向かいにいる、選択した成人AIキャスト';
  document.querySelector('.scene-caption').lastElementChild.textContent='YOUR SEAT · '+castId.toUpperCase();
  const c=clip();if(c&&enabled)swap(c.url);else{intro.pause();intro.style.opacity='0';}
 }
 intro.addEventListener('timeupdate',()=>{if(!entered&&intro.duration&&intro.currentTime>=intro.duration-.8)enter();});intro.addEventListener('ended',()=>{if(!entered)enter();});
 function select(id){if(id===castId&&entered)return;castId=id;desired='idle';mood='idle';for(const v of players){v.pause();v.style.opacity='0';}enter();}
 function expression(value){if(!['idle','neutral','happy','sad','angry','surprised'].includes(value))return;if(value===desired)return;desired=value;mood=value;if(entered&&enabled){const c=clip();if(c)swap(c.url);}}
 async function initialize(media,id){
  assets=media;castId=id;const welcome=assets.find(a=>a.id==='welcome');const initial=clip();
  if(initial){players[1].src=initial.url;players[1].load();}
  if(welcome&&enabled){intro.src=welcome.url;intro.hidden=false;intro.loop=false;intro.style.opacity='1';try{await intro.play();}catch{enter();}}
  else enter();
  if(!loopFrame)tick();
 }
 function toggle(){enabled=!enabled;if(enabled){const c=clip();if(c)swap(c.url);}else{++epoch;transition=false;intro.pause();for(const v of players){v.pause();v.style.opacity='0';}photo.style.opacity='1';}return enabled;}
 function setActive(value){active=value;if(!value){++epoch;transition=false;for(const v of players)v.pause();intro.pause();}else if(enabled&&!document.hidden){if(entered){const c=clip();if(c)swap(c.url);}else intro.play().catch(()=>enter());}}
 document.addEventListener('visibilitychange',()=>{if(document.hidden){for(const v of players)v.pause();intro.pause();}else if(enabled&&active){if(entered)players[current].play().catch(()=>{});else intro.play().catch(()=>enter());}});
 return {initialize,select,expression,toggle,setActive};
}
