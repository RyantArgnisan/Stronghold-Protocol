// Explicit immutable-image staging probe; no browser, full battle, or reconnect pressure.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {TestClient} from '../helpers/wsClient.js';
import {loadBrowserSim} from '../../public/js/battle/runner.js';
if (process.env.SP_RHINE_SMOKE !== '1') process.exit(0);
const base=process.env.SP_URL;if(!base)throw Error('SP_URL required');
const cs=[],checks=[];const mark=x=>{checks.push(x);console.log('PASS',x);};
async function connect(name){const c=await TestClient.connect(base.replace('http','ws')+'/ws');cs.push(c);await c.hello(name);return c;}
async function ok(c,x){const r=await c.request(x);assert.equal(r.t,'ok',JSON.stringify(r));}
try{
 const health=await(await fetch(base+'/healthz')).json();assert.equal(health.app,'0.2.3-local.3');mark('exact candidate app/build '+health.build);
 const paths=['public/index.html','public/js/screens/lobby.js','public/js/screens/room.js','public/js/data.js','public/js/battle/runner.js','public/css/rhine-local.css','shared/constants.js','shared/protocol.js','shared/rhineResearch.js','server/sim/content/rhine.js','server/sim/damage.js','server/sim/spec.js'];
 for(const p of paths){const url='/'+p.replace(/^public\//,'').replace(/^server\/sim\//,'sim/');const r=await fetch(base+url);assert.equal(r.status,200,url);assert.deepEqual(Buffer.from(await r.arrayBuffer()),fs.readFileSync('/app/'+p));}mark('12 exact served client/protocol/sim/CSS resources');
 const vanilla=await(await fetch(base+'/data/chess.json')).json(),rhine=await(await fetch(base+'/data/rhine/chess.json')).json();assert.ok(!vanilla.chess_rhine_mayer_a&&rhine.chess_rhine_mayer_a);mark('HTTP profiles remain separate');
 for(const url of ['/rhine-assets/art/rhine/medical-unit.png','/rhine-assets/art/rhine/energy-unit.png','/rhine-assets/art/rhine/laser.svg']){const r=await fetch(base+url);assert.equal(r.status,200);assert.ok((await r.arrayBuffer()).byteLength>0);}mark('representative research art HTTP');
 const raw=await(await fetch(base+'/data/rhine/assets.json')).json();const spine=raw.operators?.char_135_halo?.front??raw.spines?.char_135_halo; // PNG/spine completeness is checked separately against the extraction manifest.
 const coop=[];for(let i=0;i<8;i++)coop.push(await connect('莱茵探测'+i));const a=coop[0];
 await ok(a,{t:'room.create',mode:'coop',difficulty:'FUNNY',capacity:8,rhineEnabled:true});const room=await a.waitFor('room.state');assert.equal(room.rhineEnabled,true);
 for(const c of coop.slice(1))await ok(c,{t:'room.join',code:room.code});await a.waitFor('room.state',r=>r.seats.filter(Boolean).length===8);mark('eight seats in Rhine room');
 await ok(a,{t:'chat.send',clientId:'rhine-smoke',text:'保留八人中文交流'});await coop[7].waitFor('chat.message',m=>m.text==='保留八人中文交流');mark('Chinese chat reaches seat eight');
 const solo=await connect('原版单人');await ok(solo,{t:'room.create',mode:'solo',difficulty:'FUNNY',capacity:1});const sr=await solo.waitFor('room.state');assert.equal(sr.rhineEnabled,false);
 for(const c of coop.slice(1))await ok(c,{t:'room.ready',ready:true});await ok(a,{t:'room.start'});await ok(solo,{t:'room.start'});
 const rp=await a.waitFor('m.public',p=>p.phase==='INFO_CHECK'),vp=await solo.waitFor('m.public',p=>p.phase==='INFO_CHECK');assert.equal(rp.rhineEnabled,true);assert.equal(vp.rhineEnabled,false);
 const damage=await a.waitFor('m.damage');assert.deepEqual(damage.total,[]);mark('simultaneous real Rhine co-op and vanilla solo INFO_CHECK; new-match damage zero');
 assert.equal((await a.request({t:'room.setRhine',on:false})).code,'ROOM_STARTED');mark('started roster is locked');
 const sims=[];for(const profile of ['vanilla','rhine'])sims.push(await loadBrowserSim({profile,base:'file:///app/server/sim/',dataBase:base+'/data/'+(profile==='rhine'?'rhine/':'')}));
 assert.ok(!sims[0].ds.getChess('chess_rhine_mayer_a'));assert.ok(sims[1].ds.getChess('chess_rhine_mayer_a'));mark('real browser loader obtains immutable per-profile simulation data');
 const sim=sims[1],stageId=Object.keys(sim.ds.contentData.stages)[0];
 const spec=sim.spec.buildBattleSpec({dataProfile:'rhine',seed:8,stageId,spawns:[],timeLimit:4,players:[{playerId:'x',seat:0,units:[{uid:1,chessId:'chess_rhine_mayer_a',row:10,col:1},{uid:2,chessId:'chess_rhine_ifrit_a',row:10,col:2},{uid:3,kind:'token',tokenId:'token_rhine_medical',row:10,col:3,research:true}],bonds:{rhineShip:{active:true,count:3,layers:10}},research:{active:true,devices:[{key:'medical',tokenId:'token_rhine_medical',uid:3,onBoard:true,stage:0}]}}]});
 const b=sim.spec.createBattleFromSpec(spec,sim.ds);b.start();for(let i=0;i<90&&!b.finished;i++)b.step();assert.deepEqual(b.errors,[]);assert.ok(b.allyUnits.some(u=>u.defId==='chess_rhine_mayer_a'));mark('short BattleSpec actual authored-kit/device simulation has no errors');
}finally{
 for(const c of cs)if(c.isOpen){try{await c.request({t:'room.leave'});}catch{}}
 await Promise.all(cs.map(c=>c.close()));
}
const final=await(await fetch(base+'/healthz')).json();for(const k of ['humans','sockets','rooms','matches'])assert.equal(final[k],0,k);mark('staging probe rooms/matches/humans/sockets cleaned');
fs.writeFileSync('/out/staging-probe.json',JSON.stringify({base,checks,health:final},null,2));
