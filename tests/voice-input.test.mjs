import test from 'node:test';
import assert from 'node:assert/strict';
import {rmsOf,chunksRms,inputGain,voiceDetected} from '../public/voice-input.mjs';
test('quiet speech triggers capture, hysteresis preserves endings and silence stays silent',()=>{
 assert.equal(voiceDetected(.008),true);assert.equal(voiceDetected(.004,true),true);assert.equal(voiceDetected(0),false);
 const quiet=new Float32Array([.005,-.005,.005,-.005]);assert.ok(inputGain(quiet)>1);assert.ok(rmsOf(quiet)*inputGain(quiet)>.004);
 const silence=new Float32Array(100);assert.equal(inputGain(silence),1);assert.equal(chunksRms([silence]),0);
 assert.ok(Math.abs(chunksRms([quiet,quiet])-.005)<1e-6);
 const loud=new Float32Array([1,-1]);assert.ok(inputGain(loud)*Math.max(...loud)<=.95);
});
