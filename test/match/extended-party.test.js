import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DATA, makeMatch } from './harness.js';
import { GameData } from '../../server/match/gamedata.js';
import { bossPoolHp, hiddenEligible, pairPlayers } from '../../server/match/finalAssault.js';
import { validateC2S } from '../../shared/protocol.js';
import { SimClient } from './simClient.js';
import { attachAudit } from '../../server/match/audit.js';

test('eight-player matches expand the shared chess pool using actual occupied seats', () => {
  const h = makeMatch({ humans: 8, seed: 718 });
  try {
    assert.equal(h.m.order.length, 8);
    for (const [id, entry] of h.m.pool.entries) {
      assert.equal(entry.cap, Math.ceil(h.m.gd.poolCopies(id) * 8 / 4), id);
      assert.equal(entry.left, entry.cap);
      assert.equal(h.m.pool.take(id, 3), 3);
      assert.equal(h.m.pool.left(id), entry.cap - 3);
      assert.equal(h.m.pool.give(id, 3), 3);
      assert.equal(h.m.pool.left(id), entry.cap);
    }
  } finally { h.m.dispose(); }
});

test('boss shared HP includes all eight living players rather than clamping at four', () => {
  const { tuning, ...raw } = DATA;
  void tuning;
  const gd = new GameData(raw, 'mode_multi_hard');
  assert.equal(bossPoolHp(gd, 'boss_1', 8), bossPoolHp(gd, 'boss_1', 4) * 2);
});

test('extended parties scale the hidden-core layer requirement without changing four-player eligibility', () => {
  const gd = new GameData(DATA, 'mode_multi_hard');
  assert.equal(hiddenEligible(gd, { layerSum: 1500, teamLp: 30, aliveCount: 8 }), false);
  assert.equal(hiddenEligible(gd, { layerSum: 2401, teamLp: 30, aliveCount: 8 }), true);
  assert.equal(hiddenEligible(gd, { layerSum: 1500, teamLp: 30, aliveCount: 4 }), true);
});

test('unite progress accepts six source leakers in an eight-player party', () => {
  const left = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p_${i + 2}`, 1]));
  assert.equal(validateC2S({ t: 'b.progress', battleId: 'unite_1', gt: 1, killed: 0, total: 6, done: false, left }), null);
});

test('scripted client progress serializer retains all six unite source players', () => {
  const messages = [];
  const battle = { kind: 'unite', time: 1, total: 6, killed: 0, finished: false, _perPlayer: {}, enemies: [],
    _pending: Array.from({ length: 6 }, (_, i) => ({ sourcePlayerId: `p_${i + 2}` })) };
  SimClient.prototype._progress.call({ send: (msg) => messages.push(msg) }, { battle, battleId: 'unite_1', spec: { kind: 'unite' } });
  assert.equal(Object.keys(messages[0].left).length, 6);
});

for (const humans of [4, 5, 6, 7, 8]) {
  test(`${humans}-player state machine reaches the final assault and delivers every result (scripted battles)`, () => {
    const h = makeMatch({ humans, difficulty: 'FUNNY', seed: 840 + humans, fake: true,
      clientCombat: true, script: (b) => b.kind === 'boss' ? { bossDps: 1e9 } : {} });
    const audit = attachAudit(h.m);
    try {
      h.start();
      assert.ok(h.drive(() => h.ended != null));
      assert.equal(h.ended.players.length, humans);
      assert.equal(h.ended.roundsPassed, 14);
      assert.equal(h.endedCount, 1);
      assert.equal(h.m.errorCount, 0);
      assert.deepEqual(audit.violations, []);
      assert.deepEqual(h.logs.error, []);
      for (const ps of h.m.order) assert.ok(h.lastTo(ps.playerId, 'm.result'), ps.playerId);
      const groups = pairPlayers(h.m.order);
      assert.equal(groups.length, Math.ceil(humans / 2));
      assert.equal(new Set(groups.flat().map((p) => p.playerId)).size, humans);
    } finally {
      for (const c of h.clients.values()) c.close();
      h.m.dispose();
    }
  });
}

test('eight scripted browser clients complete a match using the real simulation and valid battle reports', () => {
  const h = makeMatch({ humans: 8, difficulty: 'FUNNY', seed: 848, clientCombat: true, captureFrames: false });
  try {
    h.start();
    assert.ok(h.drive(() => h.ended != null, { maxSteps: 1000000 }));
    assert.equal(h.ended.players.length, 8);
    assert.equal(h.endedCount, 1);
    assert.equal(h.m.errorCount, 0);
    assert.equal(h.m.simErrors, 0);
    assert.deepEqual(h.logs.error, []);
    h.invariants();
    for (const [id, c] of h.clients) {
      assert.ok(c.starts.some((m) => m.authoritative), `${id} ran a real battle`);
      assert.ok(c.log.some((m) => m.t === 'b.result'), `${id} reported a real result`);
      assert.ok(h.lastTo(id, 'm.result'), `${id} received match settlement`);
    }
  } finally {
    for (const c of h.clients.values()) c.close();
    h.m.dispose();
  }
});
