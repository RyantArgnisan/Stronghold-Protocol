import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';

test('Windows persistence skips unsupported directory descriptors but POSIX sync errors remain fatal', async () => {
  const { syncCloudSaveDirectory } = await import('../server/cloudSave.js');
  assert.equal(typeof syncCloudSaveDirectory, 'function');
  let opened = 0, synced = 0, closed = 0;
  const openDirectory = async () => { opened++; return { sync: async () => { synced++; }, close: async () => { closed++; } }; };
  await syncCloudSaveDirectory('fixture', { platform: 'win32', openDirectory });
  assert.equal(opened, 0, 'Windows must not open a directory as a regular file');
  await syncCloudSaveDirectory('fixture', { platform: 'linux', openDirectory });
  assert.deepEqual([opened, synced, closed], [1, 1, 1]);
  await assert.rejects(syncCloudSaveDirectory('fixture', { platform: 'linux', openDirectory: async () => ({
    sync: async () => { throw new Error('fixture sync failure'); }, close: async () => { closed++; },
  }) }), /fixture sync failure/);
  assert.equal(closed, 2, 'close even when directory fsync fails');
  await assert.rejects(syncCloudSaveDirectory('fixture', { platform: 'linux', openDirectory: async () => { throw new Error('fixture open failure'); } }), /fixture open failure/);
});

const payload = () => ({ v: 1, stats: { v: 1, records: [] }, operators: { loadout: { v: 1, entries: {}, ops: {} }, skins: { v: 1, skins: {} } } });
// Disposable fixture only. Never use player credentials in tests or evidence.
const credentials = () => ({ name: '云存档测试/../博士', password: 'synthetic-fixture-only-!93' });
async function post(srv, action, fields = {}) {
  const r = await fetch(`${srv.url}/api/cloud-save/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials(), ...fields }) });
  return { status: r.status, data: await r.json().catch(() => null) };
}
async function fixture(fn, options = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'cloud-test-'));
  let srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, cloudSaveDir: dir, ...options });
  try { await fn({ dir, get srv() { return srv; }, async restart() { await srv.close(); srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, cloudSaveDir: dir, ...options }); } }); }
  finally { await srv.close(); await rm(dir, { recursive: true, force: true }); }
}

test('manual upload survives server restart and restores only with its identity', () => fixture(async (f) => {
  const uploaded = await post(f.srv, 'upload', { payload: payload() });
  assert.equal(uploaded.status, 200, 'manual upload endpoint must exist');
  await f.restart();
  const restored = await post(f.srv, 'restore');
  assert.equal(restored.status, 200);
  assert.deepEqual(restored.data.payload, payload());
  const files = await readdir(f.dir);
  assert.equal(files.length, 1);
  assert.match(files[0], /^[a-f0-9]{64}\.json$/);
  const disk = await readFile(path.join(f.dir, files[0]), 'utf8');
  assert.ok(!disk.includes(credentials().password), 'never persist plaintext password');
  const record = JSON.parse(disk);
  assert.equal(record.auth.kdf, 'scrypt');
  assert.match(record.auth.salt, /^[a-f0-9]{32}$/);
}));

test('name collision and incorrect password never replace or reveal a save; selected groups merge', () => fixture(async (f) => {
  assert.equal((await post(f.srv, 'upload', { payload: payload() })).status, 200);
  const wrong = { password: 'different-synthetic-fixture-only' };
  assert.equal((await post(f.srv, 'restore', wrong)).status, 403);
  assert.equal((await post(f.srv, 'upload', { ...wrong, payload: { v: 1, stats: { v: 1, records: [{ id: 'other', players: [{}] }] } } })).status, 403);
  assert.deepEqual((await post(f.srv, 'restore')).data.payload, payload());
  const ops = { loadout: { v: 1, entries: { chess_x: { skill: 1 } }, ops: {} }, skins: { v: 1, skins: {} } };
  assert.equal((await post(f.srv, 'upload', { payload: { v: 1, operators: ops } })).status, 200);
  assert.deepEqual((await post(f.srv, 'restore')).data.payload, { ...payload(), operators: ops });
  assert.equal((await post(f.srv, 'restore', { name: 'missing-doctor' })).status, 403);
}));

test('bounded POST JSON schema rejects unsupported versions, bad preferences and unsafe keys before writing', () => fixture(async (f) => {
  const get = await fetch(`${f.srv.url}/api/cloud-save/restore`);
  assert.equal(get.status, 405);
  for (const fields of [
    { name: '', payload: payload() }, { password: 'short', payload: payload() },
    { payload: { v: 2, stats: { v: 1, records: [] } } }, { payload: { v: 1 } },
    { payload: { v: 1, stats: { v: 1, records: [{ id: 'broken' }] } } },
    { payload: { v: 1, operators: { loadout: { v: 1, entries: { chess_x: { skill: 999 } }, ops: {} }, skins: { v: 1, skins: {} } } } },
    { payload: JSON.parse('{"v":1,"stats":{"v":1,"records":[]},"__proto__":{}}') },
  ]) assert.equal((await post(f.srv, 'upload', fields)).status, 400);
  const malformed = await fetch(`${f.srv.url}/api/cloud-save/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const crossOrigin = await fetch(`${f.srv.url}/api/cloud-save/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'http://evil.invalid' }, body: JSON.stringify({ ...credentials(), payload: payload() }) });
  assert.equal(crossOrigin.status, 403);
  const oversized = await fetch(`${f.srv.url}/api/cloud-save/upload`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...credentials(), junk: 'x'.repeat(2_100_000) }) });
  assert.equal(oversized.status, 413);
  assert.deepEqual(await readdir(f.dir), []);
}));

test('all clients including loopback are rate limited before password KDF', () => fixture(async (f) => {
  for (let i = 0; i < 3; i++) assert.equal((await post(f.srv, 'restore')).status, 403);
  assert.equal((await post(f.srv, 'restore')).status, 429);
}, { cloudSaveRate: 3 }));

test('storage failure is surfaced and a concurrent name registration has one owner', () => fixture(async (f) => {
  const results = await Promise.all([
    post(f.srv, 'upload', { payload: payload() }),
    post(f.srv, 'upload', { password: 'other-synthetic-fixture-94', payload: payload() }),
  ]);
  assert.deepEqual(results.map((r) => r.status).sort(), [200, 403]);
  const files = await readdir(f.dir);
  assert.equal(files.length, 1);
  await rm(f.dir, { recursive: true });
  const { writeFile } = await import('node:fs/promises');
  await writeFile(f.dir, 'blocked');
  assert.equal((await post(f.srv, 'upload', { payload: payload() })).status, 500);
}));

test('backup schema matches actual loadout limits (skill index9, 160 entries, 256 operator settings)', () => fixture(async (f) => {
  const p = payload(); p.operators.loadout.entries = { chess_x: { skill: 9 } };
  assert.equal((await post(f.srv, 'upload', { payload: p })).status, 200);
  p.operators.loadout.entries = Object.fromEntries(Array.from({ length: 161 }, (_, i) => [`chess_${i}`, { skill: 1 }]));
  assert.equal((await post(f.srv, 'upload', { payload: p })).status, 400);
}));

test('unknown skins cannot enter a cloud save and disappear silently on restore', () => fixture(async (f) => {
  const p = payload(); p.operators.skins.skins = { char_fake: 'char_fake@nonexistent#1' };
  assert.equal((await post(f.srv, 'upload', { payload: p })).status, 400);
}));

