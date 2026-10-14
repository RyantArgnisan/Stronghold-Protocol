import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createBattleRunner } from '../../public/js/battle/runner.js';
import { createStore, initialState } from '../../public/js/store.js';
import * as spec from '../../server/sim/spec.js';
import { DataSource } from '../../server/sim/simdata.js';
import { makeMatch, DATA, give, legalTileFor } from './harness.js';
import { PHASE } from '../../shared/constants.js';
import { validateC2S } from '../../shared/protocol.js';

test('real browser runner transmits HP telemetry in progress and final result without changing battle result', async () => {
  const h = makeMatch({ mode: 'solo', humans: 1, bots: 0, fake: true, clientCombat: true, clients: false }).start();
  h.toPrep(1);
  const ps = h.m.players.get('p_0'), id = 'chess_char_1_02_a';
  give(h.m, ps, id, 'board', legalTileFor(h.m, ps, id));
  h.m.handle('p_0', { t: 'g.ready', ready: true }); h.run(() => h.m.phase === PHASE.COMBAT);
  const start = h.lastTo('p_0', 'b.start'); h.m.dispose();
  let now = 1000; const frames = [], handlers = new Map(), sent = [];
  const net = { on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); }, send(t, fields) { sent.push({ t, ...fields }); }, request(t, fields) { sent.push({ t, ...fields }); return Promise.resolve({ t: 'ok' }); } };
  const r = createBattleRunner({ net, store: createStore(initialState), doc: { hidden: false, addEventListener() {} }, now: () => now,
    raf(fn) { frames.push(fn); return frames.length; }, caf() {}, setInterval() { return 1; }, clearInterval() {},
    loadSim: async () => ({ spec, ds: new DataSource(DATA, null) }) });
  handlers.get('b.start')(start);
  for (let n = 0; n < 12; n++) await new Promise(setImmediate);
  const e = r._entries.get(start.battleId);
  assert.ok(e);
  for (let n = 0; n < 100; n++) { now += 16.667; const q = frames.splice(0); for (const fn of q) fn(now); }
  const u = e.battle.players[0].units.find((u) => u.kind === 'op');
  const enemy = e.battle.units.find((u) => u.side === 'enemy' && u.alive);
  assert.ok(u && enemy);
  const dealt = e.battle.dealDamage(u, enemy, { amount: 123, type: 'true' });
  for (let n = 0; n < 65; n++) { now += 16.667; const q = frames.splice(0); for (const fn of q) fn(now); }
  const msg = sent.filter((x) => x.t === 'b.progress').at(-1);
  assert.ok(msg.damage?.rows.some((r) => r.damage >= dealt), 'client primary path reports damage');
  assert.equal(validateC2S(msg), null);
  handlers.get('b.end')({ battleId: start.battleId, fieldId: start.fieldId, reason: 'forced' });
  now += 50; for (const fn of frames.splice(0)) fn(now);
  for (let n = 0; n < 5; n++) await new Promise(setImmediate);
  const final = sent.find((x) => x.t === 'b.result');
  assert.ok(final?.damage?.rows.length, 'final payload survives result fitting/delivery');
  assert.equal(validateC2S(final), null);
  assert.equal(spec.resultDigest(final.result).hash, spec.resultDigest(spec.compactResult(e.battle.result())).hash);
  r.dispose();
});
