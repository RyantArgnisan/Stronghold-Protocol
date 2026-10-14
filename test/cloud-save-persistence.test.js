import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { startServer } from '../server/index.js';
const identity = { name: 'persistent-disposable', password: 'fixture-password-93' };
const rec = (id, t) => ({ id, t, selfId: 'p', players: [{ playerId: 'p' }] });
async function fixture(fn) {
 const dir = await mkdtemp(path.join(tmpdir(), 'persistent-'));
 let srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, cloudSaveDir: dir });
 const post = async (action, fields, headers = {}) => {
  const r = await fetch(`${srv.url}/api/cloud-save/${action}`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(fields) });
  return { status: r.status, data: await r.json().catch(() => null) };
 };
 try { await fn(post, async () => { await srv.close(); srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true, cloudSaveDir: dir }); }); }
 finally { await srv.close(); await rm(dir, { recursive: true, force: true }); }
}
test('authenticated setting and activation time survive restart and new-browser reauthentication, not nickname claims', () => fixture(async (post, restart) => {
 await post('upload', { ...identity, payload: { v: 1, stats: { v: 1, records: [rec('history', 1)] } } });
 const enabled = await post('authorize', { ...identity, enabled: true });
 assert.equal(enabled.status, 200, 'password-authenticated durable authorization endpoint');
 assert.equal(enabled.data.auto.enabled, true);
 assert.ok(enabled.data.auto.enabledAt >= Date.now() - 10000);
 assert.match(enabled.data.token, /^[a-f0-9]{64}$/);
 const credential = { name: identity.name, token: enabled.data.token };
 assert.equal((await post('state', { name: identity.name })).status, 403);
 await restart();
 assert.deepEqual((await post('state', credential)).data.auto, enabled.data.auto);
 const other = await post('authorize', identity);
 assert.deepEqual(other.data.auto, enabled.data.auto, 'another browser validates password, never resets activation');
 assert.notEqual(other.data.token, enabled.data.token);
}));
test('scoped append filters activation boundary, dedupes, preserves operators and obeys cross-browser disable/re-enable/revoke', () => fixture(async (post, restart) => {
 const operators = { loadout: { v: 1, entries: {}, ops: {} }, skins: { v: 1, skins: {} } };
 await post('upload', { ...identity, payload: { v: 1, operators, stats: { v: 1, records: [rec('history', 1)] } } });
 const a = (await post('authorize', { ...identity, enabled: true })).data;
 const c = { name: identity.name, token: a.token };
 assert.equal((await post('append', { ...c, records: [rec('too-old', a.auto.enabledAt - 1)] })).status, 403);
 assert.equal((await post('append', { ...c, records: [rec('missing-time')] })).status, 403);
 assert.equal((await post('append', { ...c, records: [rec('new', a.auto.enabledAt + 1)] })).status, 200);
 assert.equal((await post('append', { ...c, records: [rec('new', a.auto.enabledAt + 2)] })).status, 200);
 assert.equal((await post('upload', { ...c, payload: { v: 1, stats: { v: 1, records: [] } } })).status, 400, 'token cannot replace groups');
 assert.equal((await post('append', { ...c, name: 'other-disposable', records: [rec('bad', Date.now())] })).status, 403);
 const b = (await post('authorize', identity)).data;
 await post('settings', { name: identity.name, token: b.token, enabled: false });
 assert.equal((await post('append', { ...c, records: [rec('disabled', Date.now())] })).status, 403);
 await new Promise(r => setTimeout(r, 5));
 const again = (await post('settings', { ...c, enabled: true })).data;
 assert.ok(again.auto.enabledAt > a.auto.enabledAt);
 assert.equal((await post('append', { ...c, records: [rec('old-period', a.auto.enabledAt)] })).status, 403);
 await post('revoke', c); await restart();
 assert.equal((await post('state', c)).status, 403);
 const read = await post('read', { name: identity.name, token: b.token });
 assert.deepEqual(read.data.stats.records.map(r => r.id), ['new', 'history']);
 assert.equal(read.data.operators, undefined);
 assert.deepEqual((await post('restore', identity)).data.payload.operators, operators);
}));
