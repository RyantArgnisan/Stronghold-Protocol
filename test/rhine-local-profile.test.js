import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as data from '../server/data.js';

test('Rhine is an immutable additive current-023 profile; default vanilla remains untouched', () => {
  assert.equal(typeof data.getDataProfile, 'function', 'profile loader is missing');
  const base = data.getDataProfile(false), rhine = data.getDataProfile(true);
  assert.strictEqual(base, data.getData());
  assert.ok(!base.chess.chess_rhine_mayer_a);
  assert.ok(rhine.chess.chess_rhine_mayer_a);
  assert.ok(rhine.chess.chess_rhine_aphris_a);
  assert.ok(Object.isFrozen(rhine.chess.chess_rhine_mayer_a));
  for (const [id, c] of Object.entries(base.chess)) assert.ok(rhine.chess[id], `lost current operator ${id}`);
  for (const id of Object.keys(rhine.chess)) assert.ok(!/kazdel|makoto|narant|recruit/.test(id), id);
  assert.deepEqual(rhine.config.modes.mode_single_normal.maxRound, base.config.modes.mode_single_normal.maxRound);
  assert.deepEqual(rhine.config.bans, base.config.bans);
  assert.deepEqual(rhine.waves, base.waves);
  assert.deepEqual(rhine.backups, base.backups);
});
