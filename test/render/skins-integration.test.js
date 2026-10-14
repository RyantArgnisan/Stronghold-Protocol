import test from 'node:test';
import assert from 'node:assert/strict';
import { UnitView } from '../../public/js/render/units.js';
import * as info from '../../public/js/render/app/info.js';
import { SKIN_CATALOGUE } from '../../shared/skin-catalogue.js';
const s=SKIN_CATALOGUE[0];
test('UnitView asks for skin-specific front/back and avatar and distinct cache keys',()=>{
 const calls=[], view={info:{kind:'op',side:'ally',spine:s.charId,avatar:s.charId,skin:s.id},ctx:{assets:{
  spine:{},spineEntry:(id,opts)=>{calls.push({id,opts});return {skel:'skin'};},picture:(id,opts)=>{calls.push({id,opts});return null;}}},
  _wantsBack:()=>true,_acquireSpine:()=>{},_frameColor:()=>0};
 UnitView.prototype._loadSpine.call(view); assert.deepEqual(calls[0],{id:s.charId,opts:{back:true,skin:s.id}});
 UnitView.prototype._loadPicture.call(view); assert.equal(calls[1].opts.skin,s.id);
 assert.notEqual(info.appearanceKey(view.info),info.appearanceKey({...view.info,skin:undefined}));
 assert.equal(info.prepSkin({skin:s.id},{charId:s.charId}),s.id);
 assert.equal(info.prepSkin({skin:s.id},{charId:'char_other'}),undefined);
});
