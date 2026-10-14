import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeMatch } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { attachAudit } from '../../server/match/audit.js';

test('eight living players each receive one card from an expanded SP draft', () => {
  const h = makeMatch({ humans: 8, seed: 814, fake: true }).start();
  const m = h.m;
  try {
    assert.ok(h.drive(() => m.phase === PHASE.ROUND_START && m.round === 3));
    h.runToPhase(PHASE.SP_DRAFT, 3);
    assert.equal(m.sp.cards.length, 10);
    assert.equal(new Set(m.sp.cards.map((c) => c.idx)).size, 10);
    for (let i = 0; i < 8; i++) {
      const pid = m.spTurn();
      const idx = m.sp.cards.find((c) => m.sp.taken[c.idx] == null).idx;
      assert.deepEqual(m.handle(pid, { t: 'g.choice', idx }), { ok: true });
    }
    assert.equal(Object.keys(m.sp.picks).length, 8);
    h.runToPhase(PHASE.PREP, 3);
    h.invariants();
    assert.deepEqual(h.logs.error, []);
  } finally { m.dispose(); }
});

test('eight-player draft satisfies the match audit for every picker', () => {
  const h = makeMatch({ humans: 8, seed: 814, fake: true });
  const audit = attachAudit(h.m);
  try {
    h.start();
    h.toPrep(3);
    assert.deepEqual(audit.violations, []);
  } finally { h.m.dispose(); }
});
