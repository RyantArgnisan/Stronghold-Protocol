import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {loadBrowserSim} from '../public/js/battle/simLoader.js';
import {createBattleRunner} from '../public/js/battle/runner.js';
import {createStore, initialState} from '../public/js/store.js';
test('v030 moved sim loader retains explicit Rhine data and scopes its raw DataSource',async()=>{
 const urls=[];const fetchFn=async u=>{urls.push(u);return {ok:true,json:async()=>JSON.parse(fs.readFileSync(new URL('../'+u.replace(/^\//,''),import.meta.url),'utf8'))};};
 const sim=await loadBrowserSim({profile:'rhine',base:new URL('../server/sim/',import.meta.url).href,fetchFn});
 assert.ok(urls.every(u=>u.startsWith('/data/rhine/')));assert.equal(sim.raw.rosterVariant,'rhine');assert.ok(sim.raw.chess.chess_rhine_mayer_a);
});
test('v030 runner never shares vanilla and Rhine cached simulations',async()=>{
 const calls=[];const r=createBattleRunner({net:{on(){return()=>{}}},store:createStore(initialState),doc:null,loadSim:async(c,p)=>{calls.push(p);return {cs:c?.cs,profile:p}},raf(){},caf(){},setInterval(){},clearInterval(){}});
 const a=await r.ensureSim(null,'vanilla'),b=await r.ensureSim(null,'rhine'),c=await r.ensureSim(null,'vanilla');
 assert.deepEqual(calls,['vanilla','rhine','vanilla']);assert.notEqual(a,b);assert.notEqual(a,c);r.dispose();
});
