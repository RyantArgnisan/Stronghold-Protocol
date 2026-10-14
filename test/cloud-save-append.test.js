import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';

const identity = { name: 'auto-sync-disposable', password: 'synthetic-fixture-93' };
const record = (id, t = 1) => ({ id, t, selfId: 'p', players: [{ playerId: 'p', name: 'fixture' }] });
async function fixture(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'append-test-'));
  let srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, cloudSaveDir: dir });
  const post = async (action, fields = {}, headers = {}) => {
    const r = await fetch(`${srv.url}/api/cloud-save/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify({ ...identity, ...fields }) });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  try { await fn(post, async () => { await srv.close(); srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, cloudSaveDir: dir }); }, dir); }
  finally { await srv.close(); await rm(dir, { recursive: true, force: true }); }
}

test('append authenticates an existing save, preserves history/operators, dedupes and survives restart', () => fixture(async (post, restart, dir) => {
  const records = [record('new', 2)];
  assert.equal((await post('append', { records })).status, 403, 'append must not initialize a missing save');
  assert.deepEqual(await readdir(dir), []);
  const operators = { loadout: { v: 1, entries: {}, ops: {} }, skins: { v: 1, skins: {} } };
  assert.equal((await post('upload', { payload: { v: 1, operators, stats: { v: 1, records: [record('old')] } } })).status, 200);
  assert.equal((await post('append', { records, password: 'wrong-fixture-password' })).status, 403);
  assert.equal((await post('append', { records })).status, 200);
  assert.equal((await post('append', { records: [record('new', 9)] })).status, 200);
  await restart();
  const restored = (await post('restore')).data.payload;
  assert.deepEqual(restored.operators, operators);
  assert.deepEqual(restored.stats.records.map(r => r.id), ['new', 'old']);
  assert.equal(restored.stats.records[0].t, 2, 'existing id wins retry collisions');
}));


test('append rejects foreign origins, empty/oversized groups and operator payloads, with serialized dedupe', () => fixture(async post => {
  assert.equal((await post('upload', { payload: { v: 1, stats: { v: 1, records: [] } } })).status, 200);
  assert.equal((await post('append', { records: [record('foreign')] }, { Origin: 'http://foreign.invalid' })).status, 403);
  for (const fields of [{ records: [] }, { records: Array.from({ length: 33 }, (_, i) => record('big'+i)) }, { records: [record('invalid')], payload: { v: 1, stats: { v: 1, records: [] } } }, { records: [{ id: 'broken' }] }]) assert.equal((await post('append', fields)).status, 400);
  const results = await Promise.all([post('append', { records: [record('one')] }), post('append', { records: [record('two')] }), post('append', { records: [record('one')] })]);
  assert.deepEqual(results.map(r => r.status), [200, 200, 200]);
  assert.deepEqual(new Set((await post('restore')).data.payload.stats.records.map(r => r.id)), new Set(['one', 'two']));
}));

test('append shares normalization and the 1000-record/full-history budget without dropping operators', () => fixture(async post => {
  const records = Array.from({ length: 1000 }, (_, i) => record('old'+i, i));
  assert.equal((await post('upload', { payload: { v: 1, stats: { v: 1, records } } })).status, 200);
  assert.equal((await post('append', { records: [{ ...record('latest', 2000), unknown: 1 }] })).status, 400);
  assert.equal((await post('append', { records: [record('latest', 2000)] })).status, 200);
  const saved = (await post('restore')).data.payload.stats.records;
  assert.equal(saved.length, 1000); assert.equal(saved[0].id, 'latest'); assert.equal(saved[30].compact, true);
  assert.ok(!saved.find(r => r.id === 'old0'));
}));

// Real recorder -> controller -> HTTP -> durable server path; no browser/password-field automation.
test('authorized recorder uploads only newly persisted matches, never local history, imports or operators', () => fixture(async post => {
  const { createAutoCloudUpload, requestCloudSave } = await import('../public/js/ui/cloudSave.js');
  const { recordResult, subscribeNewRecords, saveStats, normalizeRecord } = await import('../public/js/ui/stats.js');
  const operators = { loadout: { v: 1, entries: {}, ops: {} }, skins: { v: 1, skins: {} } };
  await post('upload', { payload: { v: 1, operators, stats: { v: 1, records: [record('server-old')] } } });
  const data = new Map(); globalThis.localStorage = { getItem: k => data.get(k) ?? null, setItem: (k,v) => data.set(k,v) };
  saveStats({ v: 1, records: [normalizeRecord(record('local-history'))] });
  const auto = createAutoCloudUpload({ getIdentity: () => ({ name: identity.name, key: 'p' }), request: async (action, fields) => {
    const result = await post(action, fields); if (result.status !== 200) throw new Error(result.data.error); return result.data;
  } });
  const off = subscribeNewRecords(r => auto.enqueue(r));
  try {
    await auto.enable(identity.password, async () => true);
    const recorded = recordResult({ seed: 73, players: [{ playerId: 'p' }] }, { myId: 'p', now: Date.now() });
    const until = Date.now() + 10000;
    while (auto.get().pending && Date.now() < until) await new Promise(r => setTimeout(r, 20));
    assert.equal(auto.get().pending, 0); assert.equal(auto.get().status, 'ready');
    const saved = (await post('restore')).data.payload;
    assert.deepEqual(new Set(saved.stats.records.map(r => r.id)), new Set([recorded.id, 'server-old']));
    assert.deepEqual(saved.operators, operators);
    assert.ok(data.get('sp.pref.stats').includes('local-history'));
  } finally { off(); auto.disable(); delete globalThis.localStorage; }
}));
