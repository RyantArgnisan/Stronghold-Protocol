import {test} from 'node:test';
import assert from 'node:assert/strict';
import {makeMatch} from './match/harness.js';
import {getDataProfile} from '../server/data.js';
test('Rhine research reserve activates from actual members; participates and settles only once per main round',()=>{
 const h=makeMatch({data:getDataProfile(true),clientCombat:true,clients:false});
 try {
 const p=h.ps('p_0');assert.equal(typeof p.researchView,'function','research methods missing');
 h.start();h.toPrep(1);p.board.clear();
 const ids=['chess_char_2_02_a','chess_rhine_mayer_a','chess_rhine_astgenne_a'];
 for(let i=0;i<ids.length;i++)p.board.set(`1,${i+1}`,p.newPiece('chess',ids[i]));
 p._legalityStale=false;p.recompute();
 assert.equal(p.bonds.rhineShip.count,3);assert.equal(p.researchView().capacity,1);
 assert.equal(p.research.hand.filter(Boolean).length,2);
 const device=p.research.hand[0];
 const tiles=[...p.deployMap()].filter(([k,v])=>v!=='none'&&!p.board.has(k));
 let deployed=false;
 for(const [key] of tiles){const [row,col]=key.split(',').map(Number);if(p.move(device.uid,{area:'board',row,col}).ok){deployed=true;break;}}
 assert.ok(deployed);assert.equal(p.deployCount,3);
 const input=p.battleInput();assert.equal(input.research.devices.filter(d=>d.onBoard).length,1);
 p.freezeResearch(input,'normal');assert.equal(p.settleResearch(true),true);assert.equal(p.settleResearch(true),false);
 assert.equal(p.research.points.medical,2);
 assert.equal(p.researchView().devices.find(d=>d.key==='laser').locked,true);
 const plain=makeMatch({data:getDataProfile(false)});try{assert.ok(!plain.ps('p_0').researchView().active);}finally{plain.m.dispose();}
 } finally {h.m.dispose();}
});
