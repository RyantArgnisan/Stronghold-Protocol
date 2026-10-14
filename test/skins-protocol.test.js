import test from 'node:test';
import assert from 'node:assert/strict';
import { validateC2S } from '../shared/protocol.js';
import { SKIN_CATALOGUE } from '../shared/skin-catalogue.js';

import * as skins from '../shared/skins.js';

const skin = SKIN_CATALOGUE[0];
test('room.skins admits exact catalogue IDs including @ and #', () => {
  assert.equal(validateC2S({ t: 'room.skins', rid: 7, skins: { [skin.charId]: skin.id } }), null);
});

test('skin choices reject anything other than an exact own-key plain map', () => {
  const hidden = Object.defineProperty({}, skin.charId, { value: skin.id });
  const accessor = Object.defineProperty({}, skin.charId, { get() { throw new Error('must not invoke accessors'); }, enumerable: true });
  const tooMany = Object.fromEntries(Array.from({ length: 257 }, (_, i) => ['unknown_' + i, skin.id]));
  for (const value of [[], Object.create({ [skin.charId]: skin.id }), hidden, accessor, { [Symbol('skin')]: skin.id },
    { [skin.charId]: 'https://example.test/model' }, { char_other: skin.id }, tooMany,
    JSON.parse('{"__proto__":"' + skin.id + '"}'), null, 'skin']) {
    assert.equal(skins.isSkinChoices(value), false);
    assert.equal(validateC2S({ t: 'room.skins', skins: value }), 'bad field skins');
  }
  assert.equal(skins.isSkinChoices({}), true);
  assert.equal(skins.isSkinChoices(Object.assign(Object.create(null), { [skin.charId]: skin.id })), true);
});

test('catalogue helpers resolve only the actual character and sanitize stored own choices', () => {
  assert.equal(typeof skins.skinsFor, 'function');
  assert.equal(skins.OPERATOR_SKINS, SKIN_CATALOGUE);
  assert.deepEqual(skins.SKIN_LIMITS, { entries: 256, idLen: 80 });
  for (const s of SKIN_CATALOGUE) {
    assert.equal(skins.skinFor(s.charId, s.id), s);
    assert.ok(skins.skinsFor(s.charId).includes(s));
    assert.equal(skins.skinIdFor({ [s.charId]: s.id }, s.charId), s.id);
  }
  assert.equal(skins.skinFor('other', skin.id), null);
  assert.equal(skins.skinFor(skin.charId, skin.stem), null);
  assert.deepEqual(skins.skinsFor('other'), []);
  assert.equal(skins.skinIdFor(Object.create({ [skin.charId]: skin.id }), skin.charId), null);
  assert.equal(skins.skinIdFor(null, skin.charId), null);
  const dirty = { [skin.charId]: skin.id, char_other: skin.id, __proto__: { inherited: skin.id } };
  assert.deepEqual(skins.cleanSkinChoices(dirty), {});
  const plain = { [skin.charId]: skin.id, char_other: skin.id };
  Object.defineProperty(plain, 'accessor', { get() { throw new Error('no getters'); }, enumerable: true });
  assert.deepEqual(skins.cleanSkinChoices(plain), { [skin.charId]: skin.id });
  assert.deepEqual(skins.cleanSkinChoices(null), {});
});
