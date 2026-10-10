/** Preserve resampling position across microphone blocks (44.1/48kHz -> 16kHz). */
export class PcmEncoder{
 constructor(rate){this.step=rate/16000;this.tail=new Float32Array();this.position=0;}
 push(input,gain=1){
  const data=new Float32Array(this.tail.length+input.length);data.set(this.tail);data.set(input,this.tail.length);
  const values=[];
  while(this.position+1<data.length){const i=Math.floor(this.position),mix=this.position-i,value=Math.max(-1,Math.min(1,(data[i]*(1-mix)+data[i+1]*mix)*gain));values.push(Math.round(value*(value<0?32768:32767)));this.position+=this.step;}
  const consumed=Math.min(Math.floor(this.position),Math.max(0,data.length-1));this.tail=data.slice(consumed);this.position-=consumed;
  const buffer=new ArrayBuffer(values.length*2),view=new DataView(buffer);values.forEach((value,i)=>view.setInt16(i*2,value,true));return buffer;
 }
}
export function decodePcm(buffer){
 const view=new DataView(buffer),result=new Float32Array(buffer.byteLength/2);for(let i=0;i<result.length;i++)result[i]=view.getInt16(i*2,true)/32768;return result;
}
