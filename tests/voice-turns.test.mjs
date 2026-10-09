import test from 'node:test';
import assert from 'node:assert/strict';
import {Economy} from '../src/economy.mjs';
import {VoiceTurns,validateMicAudio} from '../src/voice-turns.mjs';
function fixture(t){const economy=new Economy(':memory:');t.after(()=>economy.close());const p=economy.reservePurchase('u','s500','voice-fund');economy.bindCheckout(p.id,'cs_test_voice_fixture');economy.checkoutPaid('evt_voice_fixture',{id:'cs_test_voice_fixture',client_reference_id:p.id,currency:'jpy',amount_total:500,payment_status:'paid',status:'complete',livemode:false,payment_intent:'pi_voice_fixture',metadata:{purchaseId:p.id,userId:'u',packId:'s500'}});return {economy,voice:new VoiceTurns(economy)};}
test('reserved voice balance is unavailable to simultaneous turns and restart refunds once',t=>{
 const {economy,voice}=fixture(t);const request={castId:'luna',kind:'text',inputHash:'hash'};
 const first=voice.reserve('u','voice-first',request);assert.equal(economy.state('u').wallet.S,495);voice.reserve('u','voice-second',request);assert.equal(economy.state('u').wallet.S,490);
 assert.equal(voice.reserve('u','voice-first',request).id,first.id);assert.equal(economy.state('u').wallet.S,490);
 assert.throws(()=>voice.get('other',first.id),{code:'VOICE_NOT_FOUND'});voice.recoverInterrupted();voice.recoverInterrupted();assert.equal(economy.state('u').wallet.S,500);
 assert.equal(voice.reserve('u','voice-first',request).status,'failed');assert.equal(economy.state('u').wallet.S,500);
});
test('completed voice remains charged once through duplicate completion, release and replay',t=>{
 const {economy,voice}=fixture(t),r=voice.reserve('u','complete-once',{castId:'mio',kind:'audio',inputHash:'hash'}),bytes=Buffer.from('RIFF0000WAVEfixture');
 voice.complete('u',r.id,{reply:'こんばんは',emotion:'happy'},bytes);voice.complete('u',r.id,{reply:'overwrite'},bytes);voice.release('u',r.id);voice.recoverInterrupted();assert.equal(economy.state('u').wallet.S,495);assert.equal(voice.get('u',r.id).reply.reply,'こんばんは');assert.deepEqual(voice.audio('u',r.id),bytes);assert.throws(()=>voice.audio('other',r.id),{code:'VOICE_NOT_FOUND'});
});
function wav(seconds=1,amplitude=6000){const n=seconds*16000,b=Buffer.alloc(44+n*2);b.write('RIFF');b.writeUInt32LE(b.length-8,4);b.write('WAVEfmt ',8);b.writeUInt32LE(16,16);b.writeUInt16LE(1,20);b.writeUInt16LE(1,22);b.writeUInt32LE(16000,24);b.writeUInt32LE(32000,28);b.writeUInt16LE(2,32);b.writeUInt16LE(16,34);b.write('data',36);b.writeUInt32LE(n*2,40);for(let i=0;i<n;i++)b.writeInt16LE(Math.round(Math.sin(i*.1)*amplitude),44+i*2);return 'data:audio/wav;base64,'+b.toString('base64');}
test('microphone format bounds block silence, oversized duration and header tampering before billing',()=>{
 assert.equal(validateMicAudio(wav()).durationSeconds,1);assert.throws(()=>validateMicAudio(wav(1,0)),{code:'NO_SPEECH'});assert.throws(()=>validateMicAudio(wav(31)),{code:'INVALID_MIC_AUDIO'});
 const b=Buffer.from(wav().split(',')[1],'base64');b.writeUInt32LE(999999999,24);assert.throws(()=>validateMicAudio('data:audio/wav;base64,'+b.toString('base64')),{code:'INVALID_MIC_AUDIO'});
 const odd=Buffer.concat([Buffer.from(wav().split(',')[1],'base64'),Buffer.alloc(1)]);odd.writeUInt32LE(odd.length-8,4);odd.writeUInt32LE(odd.length-44,40);assert.throws(()=>validateMicAudio('data:audio/wav;base64,'+odd.toString('base64')),{code:'INVALID_MIC_AUDIO'});
});
