import {test} from 'node:test';
import assert from 'node:assert/strict';
import * as loader from '../public/js/data.js';
import * as lobby from '../public/js/screens/lobby.js';
test('UI offers exact default-off two choices and keeps explicit solo/co-op capacity',()=>{
 assert.equal(typeof lobby.RosterPicker,'function','roster picker missing');
 const node=lobby.RosterPicker({enabled:false,onChange(){},disabled:false});
 const labels=[];function walk(v){if(typeof v==='string')labels.push(v);else if(Array.isArray(v))v.forEach(walk);else if(v?.props)walk(v.props.children);}walk(node);
 assert.ok(labels.includes('原版干员'));assert.ok(labels.includes('追加莱茵生命'));
 assert.equal(lobby.createRoomFields('solo','FUNNY',8,true).rhineEnabled,true);
 assert.equal(lobby.createRoomFields('solo','FUNNY',8,true).capacity,1);
});
test('profile caches prevent a late Rhine request from contaminating vanilla after leave',async()=>{
 assert.equal(typeof loader.createProfiledDataStore,'function','isolated cache missing');
 const urls=[];const cache=loader.createProfiledDataStore({fetch:async url=>{urls.push(url);return {ok:true,json:async()=>({unit:{name:url}})};},retryDelays:[]});
 await cache.load('chess');assert.equal(cache.profileId,'vanilla');
 cache.selectProfile(true);await cache.load('chess');assert.equal(cache.get('chess').unit.name,'/data/rhine/chess.json');
 cache.selectProfile(false);assert.equal(cache.get('chess').unit.name,'/data/chess.json');
 assert.deepEqual(urls,['/data/chess.json','/data/rhine/chess.json']);
});
