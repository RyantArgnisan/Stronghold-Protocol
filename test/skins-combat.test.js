import test from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './match/harness.js';
import { SKIN_CATALOGUE } from '../shared/skin-catalogue.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { getDefaultSource } from '../server/sim/simdata.js';
import { unitInfo } from '../server/sim/snapshot.js';
const normal = Object.values(DATA.chess).find(c => !c.isGolden && c.goldenId && !c.isDiy && SKIN_CATALOGUE.some(s => s.charId === c.charId));
const skin = SKIN_CATALOGUE.find(s => s.charId === normal.charId);
const siege = SKIN_CATALOGUE.find(s => s.charId === 'char_112_siege');
const slot = 'chess_char_5_diy1_a';
function setup(t) {
 const h = makeMatch({ seats: [0,1].map(i => ({seat:i,playerId:`p_${i}`,name:`P${i}`,isBot:false,connected:true,
  skins:i===0?{[skin.charId]:skin.id,[siege.charId]:siege.id}:{},diy:{[slot]:{charId:siege.charId,skillIndex:0}}})) }).start();
 t.after(()=>h.m.dispose()); return h;
}
test('combat inputs, real sim UnitInfo and scouting retain owner skin for normal elite and DIY', t => {
 const h=setup(t), ids=[normal.chessId,normal.goldenId,slot,DATA.chess[slot].goldenId];
 for(const ps of h.m.players.values()) {
  ps.board.clear(); ids.forEach((id,i)=>ps.board.set(`6,${i}`,{kind:'chess',id,uid:i+1,items:[]}));
  // this test checks transport, independent of the round's placement rules
  ps.deployMap=()=>{}; ps._legalityStale=false;
  const input=ps.battleInput(); assert.equal(input.units.length,4);
  input.units.forEach((u,i)=>assert.equal(u.skin,ps.playerId==='p_0'?(i<2?skin.id:siege.id):undefined));
  h.m.prepFieldMeta(ps).units.forEach((u,i)=>assert.equal(u.skin,ps.playerId==='p_0'?(i<2?skin.id:siege.id):undefined));
  const spec=buildBattleSpec({players:[input],seed:42,spawns:[],content:'none'});
  const battle=createBattleFromSpec(spec,getDefaultSource(),{content:'none',quiet:true});
  assert.equal(battle.allyUnits.length,4);
  battle.allyUnits.forEach((u,i)=>assert.equal(unitInfo(u).skin,ps.playerId==='p_0'?(i<2?skin.id:siege.id):undefined));
  const plain=structuredClone(spec); plain.players[0].units.forEach(u=>delete u.skin);
  const defaultBattle=createBattleFromSpec(plain,getDefaultSource(),{content:'none',quiet:true});
  assert.deepEqual(battle.allyUnits.map(u=>u.s),defaultBattle.allyUnits.map(u=>u.s),'cosmetics never change stats');
 }
});
test('sim rejects foreign skin bindings and token appearances', () => {
 const spec=buildBattleSpec({players:[{playerId:'p_0',units:[{chessId:normal.chessId,uid:1,row:6,col:0,skin:siege.id}]}],spawns:[],content:'none'});
 const b=createBattleFromSpec(spec,getDefaultSource(),{content:'none',quiet:true});
 assert.equal(Object.hasOwn(JSON.parse(JSON.stringify(unitInfo(b.allyUnits[0]))),'skin'),false);
 const token=buildBattleSpec({players:[{units:[{kind:'token',tokenId:'probe',skin:skin.id}]}]});
 assert.equal(Object.hasOwn(token.players[0].units[0],'skin'),false);
});
