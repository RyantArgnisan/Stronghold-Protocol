import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validCloudIdentity } from '../shared/cloudSave.js';
import { requestCloudSave } from '../public/js/ui/cloudSave.js';
import * as panel from '../public/js/ui/cloudSavePanel.js';
import { store } from '../public/js/store.js';

// Disposable fixtures; never register a save under the user's literal name.
test('recovery password accepts 8–128 and rejects 7/129; literal name remains unchanged', () => {
  for (const [length, valid] of [[7,false],[8,true],[128,true],[129,false]])
    assert.equal(validCloudIdentity('114514', 'x'.repeat(length)), valid, `length ${length}`);
});
test('fixed cloud name follows live entry identity and refuses title/empty identity', async () => {
  assert.equal(typeof panel.cloudSavePlayerName, 'function');
  store.reset();
  store.patch('me', { name: 'remembered-only' });
  assert.equal(panel.cloudSavePlayerName(store.get()), '');
  store.patch('session', { entered: true });
  store.patch('me', { name: '114514' });
  assert.equal(panel.cloudSavePlayerName(store.get()), '114514');
  store.patch('me', { name: 'changed-login' });
  let submitted;
  await requestCloudSave('restore', { name: panel.cloudSavePlayerName(store.get()), password: 'x'.repeat(8) }, async (_, options) => {
    submitted = JSON.parse(options.body).name;
    return { ok: true, json: async () => ({ ok: true }) };
  });
  assert.equal(submitted, 'changed-login');
  let calls = 0;
  for (const state of [{session:{entered:false},me:{name:'remembered'}},{session:{entered:true},me:{name:''}}])
    await assert.rejects(requestCloudSave('restore', {name: panel.cloudSavePlayerName(state),password:'x'.repeat(8)}, async () => { calls++; }), /IDENTITY/);
  assert.equal(calls, 0);
  store.reset();
});
test('cloud name is read-only, password range visible, actions read current store instead of a cached override', async () => {
  const view = panel.CloudSaveView({name:'114514',selection:{stats:true},onAction:()=>{}});
  const nodes=[];
  function walk(n){if(!n || typeof n!=='object')return;nodes.push(n);for(const c of [n.props?.children].flat(Infinity))walk(c);}
  walk(view);
  const name=nodes.find(n=>n.type==='input' && n.props.type==='text');
  assert.equal(name.props.readOnly, true);
  assert.equal(name.props.value, '114514');
  assert.equal(name.props.onInput, undefined);
  const password=nodes.find(n=>n.props?.type==='password');
  assert.equal(password.props.minlength, '8');assert.equal(password.props.maxlength,'128');
  assert.match(nodes.flatMap(n=>[n.props?.children].flat(Infinity)).filter(n=>typeof n==='string').join(' '), /8–128/);
  const source=await readFile(new URL('../public/js/ui/cloudSavePanel.js',import.meta.url),'utf8');
  assert.match(source,/name: cloudSavePlayerName\(store.get\(\)\)/);
  assert.ok(!source.includes('setName') && !source.includes('onName'));
});
test('invalid password is reported separately before any request', async () => {
  for(const length of [7,129]) await assert.rejects(requestCloudSave('restore',{name:'fixture',password:'x'.repeat(length)},async()=>{throw new Error('must not fetch');}), /PASSWORD/);
});
