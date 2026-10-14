import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
globalThis.PIXI={Container:class {},Graphics:class {},Sprite:class {}};
const {headTilesForUnit}=await import('../../public/js/render/units.js');
test('v025 head-height refactor preserves authored Rhine actor height without reverting enemy fixes',()=>{
 assert.equal(headTilesForUnit({isEnemy:false,isBoss:false,spineShown:false,modelK:1,modelKY:1,researchHead:1.8}),1.8);
 const source=readFileSync(new URL('../../public/js/render/units.js',import.meta.url),'utf8');
 assert.match(source,/researchHead: this\.researchActor\?\.look\.head/);
});
