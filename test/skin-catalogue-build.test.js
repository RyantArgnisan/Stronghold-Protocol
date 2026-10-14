import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';

test('skin catalogue generator preserves exact IDs and binds real charIds', async () => {
  assert.ok(existsSync('tools/build-skin-catalogue.mjs'), 'missing skin catalogue generator');
  const { catalogueFrom } = await import('../tools/build-skin-catalogue.mjs');
  const list = catalogueFrom({ skins: { char_102_texas: [{ skinId: 'char_102_texas@winter#1', name: '寒冬信使', group: '寒武纪/I', stem: 'char_102_texas_winter_1' }] } });
  assert.deepEqual(list, [{ id: 'char_102_texas@winter#1', charId: 'char_102_texas', name: '寒冬信使', group: '寒武纪/I', stem: 'char_102_texas_winter_1' }]);
  assert.throws(() => catalogueFrom({ skins: { char_102_texas: [{ skinId: 'char_102_texas@winter#1', stem: '../escape' }] } }), /unsafe/);
});
