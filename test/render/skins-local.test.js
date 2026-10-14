import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as art from '../../public/js/assets.js';
import { SKIN_CATALOGUE } from '../../shared/skin-catalogue.js';
import { renderInfo } from '../../public/js/render/app/info.js';
import { chessAvatarUrl } from '../../public/js/ui/assetUrls.js';

test('UI chess avatars apply explicit owner skin to both elite and composed DIY records', () => {
  const m = { ...base, skinsAssets: overlay };
  for (const c of [{charId: skin.charId}, {charId: skin.charId, isGolden:true, assets:{avatar:skin.charId+'_2'}}, {charId:skin.charId,isDiy:true}])
    assert.equal(chessAvatarUrl(m,c,{skin:skin.id}),overlay.chars[skin.charId].skins[skin.id].avatar);
  assert.equal(chessAvatarUrl(m,{charId:skin.charId}),'/assets/default.png');
});

test('remote UnitInfo carries only its owner skin, never viewer preferences or enemy/token skins', () => {
  const packet = { id: 1, kind: 'op', side: 'ally', spine: skin.charId, avatar: skin.charId, skin: skin.id };
  assert.equal(renderInfo(packet).skin, skin.id);
  assert.equal(renderInfo({ ...packet, skin: undefined }).skin, undefined);
  assert.equal(renderInfo({ ...packet, spine: 'char_other' }).skin, undefined);
  assert.equal(renderInfo({ ...packet, kind: 'token' }).skin, undefined);
  assert.equal(renderInfo({ ...packet, side: 'enemy', kind: 'enemy' }).skin, undefined);
});

export const skin = SKIN_CATALOGUE[0];
const dir = `/assets/skins/${skin.stem}/front/model`;
export const model = { skel: `${dir}.skel`, atlas: `${dir}.atlas`, textures: [`${dir}.png`],
  anims: { idle: 'Idle', deploy: 'Idle', attack: { loop: 'Attack' } },
  animations: { Idle: 1, Attack: 1 }, hits: {}, bounds: { x: 0, y: 0, width: 100, height: 100 } };
export const overlay = { version: 1, chars: { [skin.charId]: { skins: { [skin.id]: {
  avatar: `/assets/skins/${skin.stem}/avatar.png`, spine: { front: model } } } } } };
export const base = { chars: { [skin.charId]: { avatar: '/assets/default.png', avatarE2: '/assets/elite.png',
  spine: { front: { ...model, skel: '/assets/default.skel', atlas: '/assets/default.atlas' } } } } };

test('skin overlay binds exact IDs to actual operators and validates local resources', () => {
  assert.equal(typeof art.skinAssetEntry, 'function', 'missing validated skin asset resolver');
  assert.equal(art.skinAssetEntry(overlay, skin.charId, skin.id).spine.front, model);
  assert.equal(art.skinAssetEntry(overlay, 'char_other', skin.id), null);
  assert.equal(art.skinAssetEntry(overlay, skin.charId, 'https://evil/skin'), null);
  const bad = structuredClone(overlay);
  bad.chars[skin.charId].skins[skin.id].spine.front.textures = ['https://evil/model.png'];
  assert.equal(art.skinAssetEntry(bad, skin.charId, skin.id).spine, undefined);
  bad.chars[skin.charId].skins[skin.id].avatar = `/assets/skins/${skin.stem}/../bad.png`;
  assert.equal(art.skinAssetEntry(bad, skin.charId, skin.id), null);
});

test('URL helpers choose bound skin art for both normal and elite and fall back safely', () => {
  const m = { ...base, skinsAssets: overlay };
  assert.equal(art.avatarUrl(m, `${skin.charId}_2`, { skin: skin.id }), overlay.chars[skin.charId].skins[skin.id].avatar);
  assert.equal(art.spineEntry(m, skin.charId, { skin: skin.id, back: true }).skel, model.skel);
  assert.equal(art.spineEntry(m, skin.charId, { skin: skin.id }).fallback, base.chars[skin.charId].spine.front);
  assert.equal(art.avatarUrl(m, skin.charId, { skin: 'bad' }), '/assets/default.png');
  assert.equal(art.spineEntry(base, skin.charId, { skin: skin.id }).skel, '/assets/default.skel');
  assert.equal(art.unitPictureUrl(m, skin.charId, { skin: skin.id }), overlay.chars[skin.charId].skins[skin.id].avatar);
});
