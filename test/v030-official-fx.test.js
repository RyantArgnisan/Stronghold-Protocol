import {test} from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';
test('v030 official update local-fx manifest is shipped alongside its extracted effects',()=>{
 const url=new URL('../data/local-fx.json',import.meta.url);assert.ok(fs.existsSync(url),'v030 release local-fx.json must accompany the verified effect assets');const m=JSON.parse(fs.readFileSync(url));assert.equal(m.format,'fx-manifest');assert.ok(Object.keys(m.groups).length>0);
});
