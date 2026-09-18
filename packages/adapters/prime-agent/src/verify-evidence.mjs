import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { probeRoot } from './profile.ts';
const read=async(name)=>JSON.parse(await readFile(path.join(probeRoot,name),'utf8'));
const cli=await read('cli-evidence.json');
assert.equal(cli[0].version,'0.9.5');
for(const variant of ['transport','native','native-followup','proxy']){
 const e=await read(`${variant}-evidence.json`);
 assert.equal(e.exitCode,0,`${variant}: client exit`);
 assert.equal(e.timedOut,false,`${variant}: deadline`);
 assert.equal(e.shutdownExitCode,0,`${variant}: isolated daemon cleanup`);
 for(const [check,passed]of Object.entries(e.checks)){
  assert.equal(passed,check==='roundChangesApplied'?false:true,`${variant}: ${check}`);
 }
 assert.equal(e.diagnostics.length,0,`${variant}: diagnostics`);
 const assistant=e.clientEvents.filter(e=>e.type==='message_end'&&e.model);
 assert.equal(assistant.length,variant==='native-followup'?4:3);
 assert.deepEqual(assistant.slice(0,3).map(e=>e.usage.totalTokens),[25,35,45]);
 if(variant.startsWith('native')){
  assert.deepEqual(e.requests.slice(0,3).map(e=>[e.model,e.effort]),Array(3).fill(['sabi-code','medium']));
  assert.equal(e.extensionEvents.filter(e=>e.type==='setters_returned').every(e=>e.accepted),true);
 }
 if(variant==='native-followup')assert.deepEqual([e.requests[3].model,e.requests[3].effort],['probe-first','minimal']);
 if(variant==='proxy'){
  assert.deepEqual(e.requests.map(e=>e.model),['mock-mid','mock-cheap','mock-cheap']);
  assert.equal(e.requests.every(e=>e.sabiHeadersStripped),true);
  assert.equal(assistant.every(e=>e.model==='sabi-code'),true);
  assert.equal(e.proxyDecisions.every(d=>d.client==='prime-agent'&&d.sessionKnown===false&&d.outcome==='ok'),true);
  assert.equal(new Set(e.proxyDecisions.map(d=>d.requestId)).size,3);
 }
}
console.log('PASS: installed CLI, direct transport, proxy transport, native timing rejection, same-session follow-up, cleanup');
