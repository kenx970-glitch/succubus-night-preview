export const rmsOf=data=>Math.sqrt(data.reduce((sum,x)=>sum+x*x,0)/Math.max(1,data.length));
export function chunksRms(chunks){let energy=0,count=0;for(const chunk of chunks){count+=chunk.length;for(const x of chunk)energy+=x*x;}return Math.sqrt(energy/Math.max(1,count));}
export function inputGain(data){
 const rms=rmsOf(data);if(rms<.0015)return 1;
 const peak=data.reduce((max,x)=>Math.max(max,Math.abs(x)),0);
 return Math.min(12,.06/rms,peak?0.95/peak:1);
}
export const voiceDetected=(rms,alreadySpeaking=false)=>rms>(alreadySpeaking ? .0035 : .006);
