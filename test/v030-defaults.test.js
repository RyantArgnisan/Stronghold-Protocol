import {test} from 'node:test';import assert from 'node:assert/strict';
import {readPolicy} from '../server/plugins/policy.js';
import {trustDecision} from '../server/plugins/trusted.js';
import {studioMode,studioAllowed} from '../server/studio/gate.js';
test('v030 scripts stay default-off; explicit deployment off also denies trusted execution',()=>{
 for(const env of [{},{SP_PLUGIN_SCRIPTS:'off'}]){
  const {policy,problems}=readPolicy(null,{env});assert.deepEqual(problems,[]);assert.deepEqual(policy.default,[]);assert.notEqual(policy.classes.script,true);assert.notEqual(policy.classes.trusted,true);
  assert.equal(trustDecision({},{mode:env.SP_PLUGIN_SCRIPTS,host:'0.0.0.0',pins:{}}).code,'PLUGIN_SCRIPTS_DISABLED');
 }
});
test('v030 disabled studio cannot admit even loopback',()=>{
 assert.equal(studioMode({SP_STUDIO:'off'}),'off');assert.equal(studioAllowed({socket:{remoteAddress:'127.0.0.1'},headers:{host:'localhost'}},{mode:'off'}).ok,false);
});
