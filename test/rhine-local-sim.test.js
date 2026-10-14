import {test} from 'node:test';
import assert from 'node:assert/strict';
import {KITS,setupUnitKit} from '../server/sim/content/index.js';
import {DataSource} from '../server/sim/simdata.js';
import {getDataProfile} from '../server/data.js';
import {makeBattle,enemyRec} from './helpers/battleHarness.js';
test('all five new Rhine kits are authored, and medical device actually restores HP without sim errors',()=>{
 for(const id of ['mayer','ifrit','astgenne','dorothy','aphris'])assert.equal(typeof KITS[`chess_rhine_${id}_a`],'function',id+' kit missing');
 const raw=getDataProfile(true);const ds=new DataSource(raw,null);
 const research={active:true,devices:[{key:'medical',tokenId:'token_rhine_medical',uid:50,onBoard:true,stage:0}]};
 const h=makeBattle({players:[{playerId:'p1',seat:0,units:[{uid:1,chessId:'chess_char_2_02_a',row:10,col:4},{uid:50,kind:'token',tokenId:'token_rhine_medical',row:10,col:5,research:true}],bonds:{rhineShip:{count:3,active:true,layers:10}},research}],data:ds});
 h.step();const patient=h.unit(1);patient.hp-=500;
 const before=patient.hp;h.run(3);assert.ok(patient.hp>before);assert.deepEqual(h.b.errors,[]);
});
