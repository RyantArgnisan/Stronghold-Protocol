import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the actual panel action without entering credentials in a browser.
async function harness(confirmed) {
  const source = await readFile(new URL('../../public/js/ui/cloudSavePanel.js', import.meta.url), 'utf8');
  const body = source.split('const action = async (which) => {')[1].split('\n  };')[0];
  const events = [], statuses = [], running = { current: false };
  const passwordRef = { current: { value: 'fixture-only' } };
  const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
  const action = new AsyncFunction('which', 'running', 'setBusy', 'setStatus', 't', 'store', 'selection', 'cloudSavePlayerName', 'passwordRef', 'snapshotCloudSave', 'requestCloudSave', 'confirmDialog', 'errors', body);
  await action('upload', running, () => {}, s => statuses.push(s), s => s,
    { get: () => ({ session: { entered: true }, me: { name: 'test-fixture' } }) },
    { stats: true, operators: false }, s => s.me.name, passwordRef,
    () => { events.push('snapshot'); return { v: 1 }; },
    async () => { events.push('request'); return { updatedAt: 'fixture-time' }; },
    async options => { events.push('confirm'); assert.equal(options.danger, true); assert.match(options.text, /替换.*服务器/); assert.match(options.text, /不.*合并/); return confirmed; }, {});
  return { events, statuses, running, passwordRef };
}

test('upload warning gates both snapshot and request; cancelling does not upload', async () => {
  const cancelled = await harness(false);
  assert.deepEqual(cancelled.events, ['confirm']);
  assert.match(cancelled.statuses.at(-1), /取消上传/);
  assert.equal(cancelled.running.current, false);
  assert.equal(cancelled.passwordRef.current.value, '');
  const accepted = await harness(true);
  assert.deepEqual(accepted.events, ['confirm', 'snapshot', 'request']);
  assert.match(accepted.statuses.at(-1), /已上传/);
});
