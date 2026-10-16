import {test} from 'node:test';import assert from 'node:assert/strict';import {getDataProfile} from '../server/data.js';
test('Rhine additive profile keeps current official choices after v030 resource integration',()=>{
 const base=getDataProfile(false),rhine=getDataProfile(true);assert.deepEqual(rhine.choices,base.choices);
});
