import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as shared from '../../shared/statsRecords.js';
import {validCloudPayload} from '../../shared/cloudSave.js';
import * as browser from '../../public/js/ui/stats.js';
test('v030 browser and cloud normalize the same eight-player plugin-aware official statistics',()=>{
 const raw={id:'local-v030-fixture',selfId:'p0',t:1,vs:'a'.repeat(64),content:{cs:'b'.repeat(64),plugins:[{id:'fixture',version:'1.0.0'}]},players:Array.from({length:8},(_,i)=>({playerId:'p'+i,seat:i,creditedKills:21,usedBondIds:['bond_x'],trophies:7,bonds:[{bondId:'bond_x',layers:42,active:true}],stats:{kills:3}}))};
 const a=shared.normalizeRecord(raw),b=browser.normalizeRecord(raw);
 assert.equal(a.v,2);assert.equal(a.players.length,8);assert.equal(a.players[0].creditedKills,21);assert.deepEqual(a.players[0].usedBondIds,['bond_x']);assert.equal(a.vs,'a'.repeat(64));assert.ok(a.content);assert.deepEqual(a,b);assert.deepEqual(shared.compactRecord(a),browser.compactRecord(b));
 assert.equal(validCloudPayload({v:1,stats:{v:2,records:[a]}}),true);
 assert.equal(validCloudPayload({v:1,stats:{v:1,records:[{id:'legacy',v:1,players:[{playerId:'p'}]}]}}),true);
 assert.equal(validCloudPayload({v:1,stats:{v:3,records:[a]}}),false);
});
