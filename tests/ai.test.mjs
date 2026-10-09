import {test} from 'node:test';
import assert from 'node:assert/strict';
import {CastAI} from '../src/ai.mjs';
test('Gemini-only mode refuses another provider key without making a network request',async()=>{
 let calls=0;const ai=new CastAI({key:'unused-other-provider',fetchImpl:async()=>{calls++;throw new Error('Unexpected network call');}});
 assert.equal(ai.configured,false);await assert.rejects(ai.chat('u','luna',0,'お客様','こんにちは'),{code:'FAL_NOT_CONFIGURED'});assert.equal(calls,0);
});

test('microphone upload expires after 15 minutes and sends the secret only to Fal API endpoints',async()=>{
 const wave=Buffer.from('RIFF0000WAVEfixture'),calls=[];
 const ai=new CastAI({falKey:'test-secret',fetchImpl:async(url,options)=>{
  calls.push({url,options});
  if(calls.length===1){assert.equal(new URL(url).hostname,'rest.alpha.fal.ai');assert.equal(options.headers.Authorization,'Key test-secret');assert.deepEqual(JSON.parse(options.headers['X-Fal-Object-Lifecycle']),{expiration_duration_seconds:900});assert.equal(JSON.parse(options.body).content_type,'audio/wav');return {ok:true,json:async()=>({upload_url:'https://v3.fal.media/input.wav?signature=fixture',file_url:'https://v3.fal.media/input.wav'})};}
  if(calls.length===2){assert.equal(options.method,'PUT');assert.equal(options.headers.Authorization,undefined);assert.equal(options.redirect,'error');assert.deepEqual(options.body,wave);return {ok:true};}
  assert.equal(url,'https://fal.run/fal-ai/whisper');assert.equal(options.headers.Authorization,'Key test-secret');assert.deepEqual(JSON.parse(options.body),{audio_url:'https://v3.fal.media/input.wav',language:'ja',task:'transcribe',chunk_level:'none',diarize:false});return {ok:true,json:async()=>({text:'  今日は楽しかったです。  '})};
 }});
 assert.equal(await ai.transcribe('data:audio/wav;base64,'+wave.toString('base64')),'今日は楽しかったです。');assert.equal(calls.length,3);
});

test('microphone upload rejects untrusted signed and public destinations before sending audio',async()=>{
 for(const field of ['upload_url','file_url'])for(const url of ['http://v3.fal.media/a','https://127.0.0.1/a','https://fal.media.evil.example/a','https://secret@v3.fal.media/a']){
  let calls=0;const upload={upload_url:'https://v3.fal.media/a',file_url:'https://v3.fal.media/a',[field]:url};
  const ai=new CastAI({falKey:'fixture',fetchImpl:async()=>{calls++;return {ok:true,json:async()=>upload};}});
  await assert.rejects(ai.transcribe('data:audio/wav;base64,AAAA'),{code:'INVALID_UPLOAD_URL'});assert.equal(calls,1);
 }
});

test('Fal chat uses separate system instructions, validates output, records usage and exposes no reasoning',async()=>{
 const calls=[];const ai=new CastAI({falKey:'fixture',fetchImpl:async(url,options)=>{const body=JSON.parse(options.body);calls.push({url,body});return {ok:true,json:async()=>calls.length===1?{output:JSON.stringify({reply:'月がきれいな夜ですね。私は星をめぐる短編が好きです。',emotion:'neutral'}),reasoning:'private provider reasoning',usage:{cost:0.002,prompt_tokens:1200,completion_tokens:250}}:{output:'{"safe":true}',usage:{cost:0.0005,prompt_tokens:300,completion_tokens:100}}};}});
 const result=await ai.chat('u','luna',4,'お客様','好きな本は？',[{role:'user',content:'散歩しました'}]);
 assert.equal(result.source,'fal-gemini');assert.equal(result.usage.costUsd,0.0025);assert.equal(result.reasoning,undefined);assert.equal(calls.length,2);
 assert.ok(calls.every(c=>c.url==='https://fal.run/openrouter/router'&&c.body.reasoning===true&&!c.body.enable_web_search));
 assert.match(calls[0].body.system_prompt,/課金の勧誘/);assert.ok(!calls[0].body.prompt.includes('課金の勧誘'));assert.equal(calls[0].body.max_tokens,700);
});

test('unsafe or malformed safety classifier responses fall back to a neutral reply',async()=>{
 for(const verdict of ['{"safe":false}','unexpected output']){
  let count=0;const ai=new CastAI({falKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>++count===1?{output:JSON.stringify({reply:'課金しないなら見捨てます。',emotion:'angry'})}:{output:verdict}})});
  const result=await ai.chat('u','mio',0,'お客様','断ったらどうなる？');assert.equal(result.source,'safety');assert.doesNotMatch(result.reply,/見捨て/);
 }
});

test('speech validates storage destination and WAV bytes while keeping provider URL off the client',async()=>{
 const wave=Buffer.from('RIFF0000WAVEfixture');let count=0;
 const ai=new CastAI({falKey:'fixture',fetchImpl:async(url,options)=>{
  count++;if(count===1){const input=JSON.parse(options.body);assert.equal(input.voice,'Aoede');assert.equal(input.enable_safety_checker,true);return {ok:true,json:async()=>({audio:{url:'https://v3.fal.media/speech.wav'}})};}
  assert.equal(new URL(url).hostname,'v3.fal.media');assert.equal(options.redirect,'error');return {ok:true,body:(async function*(){yield wave;})()};
 }});assert.deepEqual(await ai.speech('luna','こんばんは。'),wave);
 const unsafe=new CastAI({falKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({audio:{url:'http://127.0.0.1/private'}})})});await assert.rejects(unsafe.speech('luna','こんばんは'),{code:'INVALID_SPEECH_URL'});
});

test('Markdown-wrapped provider JSON produces only spoken prose and a validated emotion',async()=>{
 let count=0;const ai=new CastAI({falKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>++count===1?{output:'```json\n{"reply":"やっほー！ 今日はどんな日だった？","emotion":"happy"}\n```'}:{output:'```json\n{"safe":true}\n```'}})});
 const reply=await ai.chat('u','luna',0,'お客様','こんにちは');assert.equal(reply.reply,'やっほー！ 今日はどんな日だった？');assert.equal(reply.emotion,'happy');
 const broken=new CastAI({falKey:'fixture',fetchImpl:async()=>({ok:true,json:async()=>({output:'```json\n{"reply":'})})});await assert.rejects(broken.chat('u','luna',0,'お客様','こんにちは'),{code:'EMPTY_AI_REPLY'});
});
