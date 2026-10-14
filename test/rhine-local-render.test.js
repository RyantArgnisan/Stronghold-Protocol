import {test} from 'node:test';
import assert from 'node:assert/strict';
import {UnitView} from '../public/js/render/units.js';
import {RHINE_DEVICES} from '../shared/rhineResearch.js';
test('research rigs accept stage/fx and use the isolated art prefix',()=>{
 assert.equal(typeof UnitView.prototype.setResearchStage,'function','research renderer missing');
 assert.equal(typeof UnitView.prototype.onResearchFx,'function');
 for(const d of RHINE_DEVICES){assert.ok(d.sprite.startsWith('/rhine-assets/'));assert.ok(d.icon.startsWith('/rhine-assets/'));}
});
