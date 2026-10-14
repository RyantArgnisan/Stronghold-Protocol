import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as cloud from '../../public/js/ui/cloudSave.js';
import * as stats from '../../public/js/ui/stats.js';
const { recordResult, recordQuit, subscribeNewRecords, saveStats, importStats, emptyStats, createLiveMatch } = stats;
const tick = () => new Promise(resolve => setTimeout(resolve, 0));
const rec = id => ({ id, players: [{ playerId: 'p' }] });

test('automatic upload is default off, explicitly authorized, uploads only new records and erases on identity change', async () => {
  assert.equal(typeof cloud.createAutoCloudUpload, 'function', 'new-record controller must exist');
  let identity = { name: 'doctor', key: 'doctor/p' }; const calls = [];
  const auto = cloud.createAutoCloudUpload({ getIdentity: () => identity, request: async (action, fields) => { calls.push({ action, fields }); return { ok: true, updatedAt: 'now' }; } });
  assert.equal(auto.get().enabled, false); auto.enqueue(rec('before')); await tick(); assert.equal(calls.length, 0);
  assert.equal(await auto.enable('fixture-password', async () => false), false); assert.equal(calls.length, 0);
  assert.equal(await auto.enable('fixture-password', async () => true), true);
  assert.equal(calls[0].action, 'restore', 'authorization never uploads history or initializes a save');
  auto.enqueue(rec('new')); auto.enqueue(rec('new')); await tick();
  assert.deepEqual(calls.slice(1).map(c => c.fields.records.map(r => r.id)), [['new']]);
  assert.equal(calls[1].fields.payload, undefined);
  identity = { name: 'other', key: 'other/q' }; auto.identityChanged();
  assert.equal(auto.get().enabled, false); auto.enqueue(rec('after')); await tick(); assert.equal(calls.length, 2);
});

test('new-record notification occurs only after actual persistence, not imports/replays/spectators; quits use the same path', () => {
  assert.equal(typeof subscribeNewRecords, 'function');
  const data = new Map(); globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v), removeItem: k => data.delete(k) };
  const got = []; const off = subscribeNewRecords(r => got.push(r));
  try {
    const result = { seed: 1, players: [{ playerId: 'p' }] };
    recordResult(result, { myId: 'p', now: 1 }); recordResult(result, { myId: 'p', now: 2 }); recordResult(result, { myId: 'spectator' });
    saveStats(importStats({ v: 1, records: [rec('imported')] }, emptyStats()).stats);
    const live = { ...createLiveMatch(), active: true, startedAt: 1, sawStart: true };
    recordQuit({ me: { playerId: 'p' }, match: { public: { phase: 'PREP', round: 2, players: [{ playerId: 'p' }] } } }, { live, now: 3 });
    assert.deepEqual(got.map(r => r.end), ['settled', 'quit']);
    globalThis.localStorage.setItem = () => { throw new Error('quota'); };
    assert.equal(recordResult({ ...result, seed: 2 }, { myId: 'p' }), null);
    assert.equal(got.length, 2);
  } finally { off(); delete globalThis.localStorage; }
});


test('transient failures retry sequentially with a bound; disabling cancels timers and AUTH pauses', async () => {
  const timers = []; let attempts = 0;
  const auto = cloud.createAutoCloudUpload({ getIdentity: () => ({ name: 'doctor', key: 'p' }),
    schedule: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, cancel: timer => { timer.cancelled = true; },
    request: async action => { if (action === 'append' && ++attempts <= 2) throw new Error('RATE'); return { updatedAt: 'confirmed' }; } });
  await auto.enable('fixture-password', async () => true); auto.enqueue(rec('one')); await tick();
  assert.equal(auto.get().enabled, true); assert.equal(auto.get().status, 'retry'); assert.equal(attempts, 1);
  assert.equal(timers[0].delay, 60000); timers[0].fn(); await tick(); assert.equal(attempts, 2);
  timers[1].fn(); await tick(); assert.equal(attempts, 3); assert.equal(auto.get().pending, 0);
  const fail = cloud.createAutoCloudUpload({ getIdentity: () => ({ name: 'doctor', key: 'p' }), schedule: (fn, delay) => { const timer = { fn, delay }; timers.push(timer); return timer; }, cancel: timer => { timer.cancelled = true; }, request: async action => { if (action === 'append') throw new Error('NETWORK'); return {}; } });
  await fail.enable('fixture-password', async () => true); fail.enqueue(rec('failure')); await tick();
  fail.disable(); assert.equal(timers.at(-1).cancelled, true); timers.at(-1).fn(); await tick(); assert.equal(fail.get().enabled, false);
  const auth = cloud.createAutoCloudUpload({ getIdentity: () => ({ name: 'doctor', key: 'p' }), request: async action => { if (action === 'append') throw new Error('AUTH'); return {}; } });
  await auth.enable('fixture-password', async () => true); auth.enqueue(rec('unauthorized')); await tick();
  assert.equal(auth.get().enabled, false); assert.equal(auth.get().error, 'AUTH');
});

test('authorization races and missing saves cannot enable or initialize; silent restored results do not notify', async () => {
  let identity = { name: 'doctor', key: 'p' }, done;
  const auto = cloud.createAutoCloudUpload({ getIdentity: () => identity, request: async () => new Promise(resolve => { done = resolve; }) });
  const pending = auto.enable('fixture-password', async () => true); await tick(); identity = { name: 'other', key: 'q' }; done({});
  await assert.rejects(pending, /IDENTITY/); assert.equal(auto.get().enabled, false);
  const missing = cloud.createAutoCloudUpload({ getIdentity: () => identity, request: async () => { throw new Error('AUTH'); } });
  await assert.rejects(missing.enable('fixture-password', async () => true), /AUTH/); assert.equal(missing.get().enabled, false);
  const data = new Map(); globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
  const notifications = []; const off = subscribeNewRecords(r => notifications.push(r));
  try { assert.ok(recordResult({ seed: 99, players: [{ playerId: 'p' }] }, { myId: 'p', notifyNew: false })); assert.equal(notifications.length, 0); }
  finally { off(); delete globalThis.localStorage; }
});

test('cloud view offers a default-off automatic checkbox independent of selected upload groups', async () => {
  const { CloudSaveView } = await import('../../public/js/ui/cloudSavePanel.js'); const calls = [];
  const view = CloudSaveView({ name: 'doctor', selection: { stats: false, operators: true }, busy: false, locked: false, onAutoChange: enabled => calls.push(enabled) });
  const nodes = []; const walk = n => { if (!n || typeof n !== 'object') return; nodes.push(n); for (const child of [n.props?.children].flat(Infinity)) walk(child); }; walk(view);
  const checkbox = nodes.find(n => n.props?.['data-cloud-auto'] !== undefined);
  assert.ok(checkbox, 'optional checkbox exists'); assert.equal(checkbox.props.checked, false);
  checkbox.props.onChange({ currentTarget: { checked: true } }); assert.deepEqual(calls, [true]);
});


test('queue and retry budgets are bounded, requests sequential, cancellation never invents success', async () => {
  let resolve, active = 0, peak = 0; const sent = [];
  const auto = cloud.createAutoCloudUpload({ getIdentity: () => ({ name: 'doctor', key: 'p' }), request: async (action, fields) => {
    if (action === 'restore') return {};
    active++; peak = Math.max(peak, active); sent.push(fields.records[0].id);
    await new Promise(r => { resolve = r; }); active--; return { updatedAt: 'real-response' };
  } });
  await auto.enable('fixture-password', async () => true);
  auto.enqueue(rec('a')); auto.enqueue(rec('b')); assert.equal(peak, 1); resolve(); await tick();
  assert.deepEqual(sent, ['a', 'b']); assert.equal(peak, 1);
  auto.disable(); resolve(); await tick(); assert.equal(auto.get().updatedAt, null, 'off/new identity must not display stale success');
  await auto.enable('fixture-password', async () => true);
  for (let i = 0; i < 33; i++) auto.enqueue(rec('bound'+i));
  assert.equal(auto.get().enabled, false); assert.equal(auto.get().error, 'QUEUE'); assert.equal(auto.get().pending, 0); resolve(); await tick();
  const timers = []; let attempts = 0;
  const exhausted = cloud.createAutoCloudUpload({ getIdentity: () => ({ name: 'doctor', key: 'p' }), schedule: fn => { timers.push(fn); return timers.length; }, cancel: () => {}, request: async action => { if (action === 'append') { attempts++; throw new Error('NETWORK'); } return {}; } });
  await exhausted.enable('fixture-password', async () => true); exhausted.enqueue(rec('retry')); await tick(); timers[0](); await tick(); timers[1](); await tick();
  assert.equal(attempts, 3); assert.equal(exhausted.get().enabled, false); assert.equal(exhausted.get().updatedAt, null);
});

test('stats notification requires read-back persistence, not a silent discarded write', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} }; const got = []; const off = subscribeNewRecords(r => got.push(r));
  try { assert.equal(recordResult({ seed: 5, players: [{ playerId: 'p' }] }, { myId: 'p' }), null); assert.equal(got.length, 0); }
  finally { off(); delete globalThis.localStorage; }
});
