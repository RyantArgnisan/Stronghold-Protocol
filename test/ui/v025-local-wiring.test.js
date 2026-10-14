import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { S2C } from '../../shared/protocol.js';
test('v025 preserves chat and damage server packet registrations beside new layer packets',()=>{
 for(const type of ['chat.message','chat.history','m.damage','m.layer']) assert.ok(S2C.includes(type),type);
});
test('v025 actual main damage handler updates the HUD store and retains layer audio',()=>{
 const source=readFileSync(new URL('../../public/js/main.js',import.meta.url),'utf8');
 const start=source.indexOf("  net.on('m.public'");const end=source.indexOf("  net.on('m.toast'",start);
 const handlers=new Map(),patches=[];
 const current={me:{playerId:'p'},room:{mode:'solo'}};
 new Function('net','store','PHASE','data','payload','maybeFinishRestore','recordResult','audio','selectRoute','let recordLiveResult=false,matchAt;\n'+source.slice(start,end))({on:(n,f)=>handlers.set(n,f)},{get:()=>current,patch:(...x)=>patches.push(x)},{},{},x=>x,()=>{},()=>{},{layerGain:()=>{}},()=> 'game');
 assert.equal(typeof handlers.get('m.damage'),'function');handlers.get('m.damage')({total:[{damage:9}]});
 assert.deepEqual(patches.at(-1),['match',{damage:{total:[{damage:9}]}}]);assert.equal(typeof handlers.get('m.layer'),'function');
});
