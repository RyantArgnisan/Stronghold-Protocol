import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildRecord, aggregateStats } from '../../public/js/ui/stats.js';
const storage = () => {
  const map = new Map();
  return { map, getItem: (k) => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: (k) => map.delete(k) };
};
async function module() {
  const m = await import('../../public/js/ui/cloudSave.js').catch(() => ({}));
  assert.equal(typeof m.snapshotCloudSave, 'function', 'manual cloud snapshot must be implemented');
  return m;
}

test('manual snapshot carries actual statistics and operator stores, never credentials or unrelated preferences', async () => {
  const m = await module(), ls = storage();
  const record = buildRecord({ victory: true, roundsPassed: 14, players: [{ playerId: 'p1', name: '博士', stats: { dmgDealt: 15 }, bandId: 'band_a' }] }, { myId: 'p1', now: 5 });
  const stats = { v: 1, records: [record] };
  ls.setItem('sp.pref.stats', JSON.stringify(stats));
  ls.setItem('sp.pref.loadout', JSON.stringify({ v: 1, entries: { chess_x: { skill: 1 } }, ops: {} }));
  ls.setItem('sp.pref.skins', JSON.stringify({ v: 1, skins: {} }));
  ls.setItem('sp.token', 'not-a-cloud-credential');
  const p = m.snapshotCloudSave({ stats: true, operators: true }, ls);
  assert.deepEqual(p.stats, stats);
  assert.deepEqual(aggregateStats(p.stats.records), aggregateStats(stats.records));
  assert.deepEqual(p.operators.loadout.entries, { chess_x: { skill: 1 } });
  assert.ok(!JSON.stringify(p).includes('not-a-cloud-credential'));
  assert.equal(m.snapshotCloudSave({ stats: true, operators: false }, ls).operators, undefined);
  assert.throws(() => m.snapshotCloudSave({ stats: false, operators: false }, ls));
});

test('restore requires confirmation, durable local backup and exact selective replacement; quota failure aborts', async () => {
  const m = await module(), ls = storage();
  assert.equal(typeof m.restoreCloudSave, 'function', 'confirmed restore helper must exist');
  const old = '{"v":1,"records":[]}', oldLoadout = '{"v":1,"entries":{},"ops":{}}';
  ls.setItem('sp.pref.stats', old); ls.setItem('sp.pref.loadout', oldLoadout);
  const payload = { v: 1, stats: { v: 1, records: [{ id: 'cloud', players: [{}] }] } };
  const select = { stats: true, operators: false };
  const calls = [];
  assert.equal(await m.restoreCloudSave(payload, select, async () => { calls.push('cancel'); return false; }, ls), false);
  assert.equal(ls.map.size, 2);
  const originalWrite = ls.setItem;
  ls.setItem = (k, v) => { calls.push(k); originalWrite(k, v); };
  assert.equal(await m.restoreCloudSave(payload, select, async () => { calls.push('confirm'); return true; }, ls), true);
  assert.equal(calls[1], 'confirm');
  assert.equal(calls[2], 'sp.cloud.backup.latest');
  assert.equal(JSON.parse(ls.getItem('sp.cloud.backup.latest')).values['sp.pref.stats'], old);
  assert.deepEqual(JSON.parse(ls.getItem('sp.pref.stats')), payload.stats);
  assert.equal(ls.getItem('sp.pref.loadout'), oldLoadout);
  const before = ls.getItem('sp.pref.stats');
  ls.setItem = () => { throw new Error('quota'); };
  await assert.rejects(m.restoreCloudSave(payload, select, async () => true, ls), /LOCAL_BACKUP/);
  assert.equal(ls.getItem('sp.pref.stats'), before);
  ls.setItem = (k, v) => { if (k === 'sp.pref.skins') throw new Error('quota'); originalWrite(k, v); };
  const both = { ...payload, operators: { loadout: { v: 1, entries: { chess_x: { skill: 1 } }, ops: {} }, skins: { v: 1, skins: {} } } };
  await assert.rejects(m.restoreCloudSave(both, { stats: true, operators: true }, async () => true, ls), /LOCAL_WRITE/);
  assert.equal(ls.getItem('sp.pref.loadout'), oldLoadout);
  assert.equal(ls.getItem('sp.pref.stats'), before);
  await assert.rejects(m.restoreCloudSave(payload, { operators: true }, async () => true, ls), /MISSING_GROUP/);
});

test('cloud requests are explicit POSTs and failures are surfaced without leaking passwords', async () => {
  const m = await module();
  assert.equal(typeof m.requestCloudSave, 'function');
  let called = 0;
  const fetcher = async (url, options) => {
    called++;
    assert.equal(url, '/api/cloud-save/upload');
    assert.equal(options.method, 'POST');
    assert.equal(options.credentials, 'same-origin');
    assert.equal(JSON.parse(options.body).name, '博士');
    return { ok: false, json: async () => ({ error: 'AUTH' }) };
  };
  assert.equal(called, 0, 'module/snapshot performs no auto upload');
  await assert.rejects(m.requestCloudSave('upload', { name: '博士', password: 'disposable-only-fixture', payload: { v: 1, stats: { v: 1, records: [] } } }, fetcher), /^Error: AUTH$/);
  assert.equal(called, 1);
  await assert.rejects(m.requestCloudSave('restore', { name: '博士', password: 'disposable-only-fixture' }, async () => { throw new Error('network detail'); }), /^Error: NETWORK$/);
});

test('statistics cloud panel exposes manual selected upload/restore with HTTP warning, masked password and visible status', async () => {
  const m = await import('../../public/js/ui/cloudSavePanel.js').catch(() => ({}));
  assert.equal(typeof m.CloudSaveView, 'function', 'statistics cloud panel must exist');
  const calls = [];
  const view = m.CloudSaveView({ name: '博士', selection: { stats: true, operators: false }, status: '错误状态', busy: false, locked: false, onAction: (action) => calls.push(action) });
  const nodes = [];
  function walk(n) { if (!n || typeof n !== 'object') return; nodes.push(n); for (const c of [n.props?.children].flat(Infinity)) walk(c); }
  walk(view);
  assert.equal(nodes.filter((n) => n.type === 'input' && n.props.type === 'password').length, 1);
  const password = nodes.find((n) => n.props?.type === 'password');
  assert.equal(password.props.autocomplete, 'off');
  assert.equal(password.props.value, undefined, 'password not held in reactive/persisted state');
  assert.equal(nodes.filter((n) => n.props?.type === 'checkbox').length, 3);
  assert.ok(nodes.find((n) => n.props?.role === 'status'));
  assert.deepEqual(calls, []);
  nodes.find((n) => n.props?.['data-cloud-action'] === 'upload').props.onClick();
  nodes.find((n) => n.props?.['data-cloud-action'] === 'restore').props.onClick();
  assert.deepEqual(calls, ['upload', 'restore']);
  const texts = nodes.flatMap((n) => [n.props?.children].flat(Infinity)).filter((n) => typeof n === 'string').join(' ');
  assert.match(texts, /HTTP.*不加密/);
  assert.match(texts, /不.*自动上传/);
});

test('statistics viewer offers cloud tab even without local records and does not claim no manual upload', async () => {
  const { readFile } = await import('node:fs/promises');
  const source = await readFile(new URL('../../public/js/screens/stats.js', import.meta.url), 'utf8');
  assert.match(source, /id: 'cloud'/);
  assert.match(source, /tab === 'cloud'[\s\S]*CloudSavePanel/);
  assert.ok(!source.includes("t('本机数据：只保存在这个浏览器里，不会上传到服务器；同盟对局里队友的代号也会存在本机（导出文件里也有）。')"));
});

test('legacy v1 operator storage without optional cultivation map snapshots defaults without dropping skills', async () => {
  const m = await module(), ls = storage();
  ls.setItem('sp.pref.loadout', JSON.stringify({ v: 1, entries: { chess_x: { skill: 1 } } }));
  const p = m.snapshotCloudSave({ operators: true }, ls);
  assert.deepEqual(p.operators.loadout, { v: 1, entries: { chess_x: { skill: 1 } }, ops: {} });
});
