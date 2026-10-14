import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { SKIN_CATALOGUE } from '../../shared/skin-catalogue.js';

test('eight-player unanimous setup reroll retains expanded stock and locked skins', (t) => {
  const skin = SKIN_CATALOGUE[0];
  const skins = { [skin.charId]: skin.id };
  const seats = Array.from({ length: 8 }, (_, i) => ({ seat: i, playerId: `p_${i}`, name: `P${i}`, isBot: false, connected: true, skins: i === 0 ? skins : {} }));
  const h = makeMatch({ seats, seed: 123 }).start();
  t.after(() => h.m.dispose());
  const m = h.m;
  assert.deepEqual(h.ps('p_0').skins, skins);
  assert.deepEqual(m.requestSetupReroll('p_0', 0), { ok: true });
  for (let i = 1; i < 8; i++) assert.deepEqual(m.handle(`p_${i}`, { t: 'g.rerollVote', voteId: m.setupVote.id, agree: true }), { ok: true });
  assert.equal(m.setupRevision, 1);
  for (const [id, entry] of m.pool.entries) assert.equal(entry.cap, 2 * m.gd.poolCopies(id), 'eight-player stock must remain doubled after reroll: ' + id);
  assert.deepEqual(h.ps('p_0').skins, skins);
  h.invariants();
});
