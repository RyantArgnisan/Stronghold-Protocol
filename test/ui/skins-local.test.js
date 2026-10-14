import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SKIN_CATALOGUE } from '../../shared/skin-catalogue.js';
const skin = SKIN_CATALOGUE[0];

test('portable loadout presets include skins, accept skin-only and preserve legacy absence', async () => {
  const { serializeExport, parseImport } = await import('../../public/js/ui/loadoutModel.js');
  const { applyLoadoutEntries, loadoutStore, setSkins } = await import('../../public/js/ui/loadoutSync.js');
  const chosen = { [skin.charId]: skin.id };
  assert.deepEqual(JSON.parse(serializeExport({}, { skins: chosen })).skins, chosen);
  const r = parseImport(serializeExport({}, { skins: chosen }));
  assert.equal(r.ok, true); assert.deepEqual(r.skins, chosen);
  const old = parseImport({ v: 1, entries: {}, ops: { char_test: { potential: 1 } } });
  assert.equal(Object.hasOwn(old, 'skins'), false);
  applyLoadoutEntries({}, () => null, { skins: chosen });
  assert.deepEqual(loadoutStore.get().skins, chosen);
  applyLoadoutEntries({}, () => null, { skins: {} });
  assert.deepEqual(loadoutStore.get().skins, {}); setSkins({});
});

test('skin picker exposes available versus disabled options and never treats catalogue as installed', async () => {
  const mod = await import('../../public/js/ui/skinPicker.js').catch(() => null);
  assert.ok(mod, 'missing skin picker UI');
  const model = { skel: `/assets/skins/${skin.stem}/front/m.skel`, atlas: `/assets/skins/${skin.stem}/front/m.atlas`,
    textures: [`/assets/skins/${skin.stem}/front/m.png`], anims: {}, animations: {}, hits: {}, bounds: null };
  const overlay = { version: 1, chars: { [skin.charId]: { skins: { [skin.id]: { spine: { front: model } } } } } };
  const options = mod.skinOptions(skin.charId, overlay);
  assert.equal(options.find((o) => o.id === skin.id).available, true);
  assert.equal(mod.skinOptions(skin.charId, null).find((o) => o.id === skin.id).available, false);
  const buttons = [];
  function visit(v) { if (Array.isArray(v)) return v.forEach(visit); if (!v || typeof v !== 'object') return;
    if (v.type === 'button') buttons.push(v.props); visit(v.props?.children); }
  visit(mod.SkinPicker({ charId: skin.charId, overlay: null, choices: {}, onPick() {} }));
  assert.equal(buttons.find((b) => b['data-skin'] === skin.id).disabled, true);
  assert.equal(buttons.find((b) => b['data-skin'] === '').disabled, false, 'default is always usable');
  const lockedButtons = [];
  const v = mod.SkinPicker({ charId: skin.charId, overlay, choices: {}, readonly: true, onPick() {} });
  function lockVisit(n) { if (Array.isArray(n)) return n.forEach(lockVisit); if (!n || typeof n !== 'object') return;
    if (n.type === 'button') lockedButtons.push(n.props); lockVisit(n.props?.children); }
  lockVisit(v);
  assert.ok(lockedButtons.every((b) => b.disabled), 'spectators may not edit');
});

test('optional overlay is loaded at its hyphenated filename and merged into the renderer singleton', async () => {
  const { createDataStore } = await import('../../public/js/data.js');
  const { createAssets } = await import('../../public/js/assets.js');
  const urls = [];
  const overlay = { version: 1, chars: { [skin.charId]: { skins: { [skin.id]: { avatar: `/assets/skins/${skin.stem}/avatar.png` } } } } };
  const d = createDataStore({ fetch: async (url) => { urls.push(url); return { ok: true, json: async () => overlay }; } });
  await d.load('skinsAssets');
  assert.deepEqual(urls, ['/data/skins-assets.json']);
  const a = createAssets({ manifest: { chars: { [skin.charId]: { avatar: '/assets/default.png' } } } });
  assert.equal(typeof a.seedSkins, 'function');
  a.seedSkins(d.get('skinsAssets'));
  assert.equal(a.avatar(skin.charId, { skin: skin.id }), `/assets/skins/${skin.stem}/avatar.png`);
});

test('skin sync persists local choices and keeps match refusal locked until the next lobby', async () => {
  const sync = await import('../../public/js/ui/loadoutSync.js');
  const { createStore } = await import('../../public/js/store.js');
  assert.equal(typeof sync.installSkinSync, 'function', 'missing skin sync');
  const handlers = new Map(), sent = [];
  let locked = true;
  const net = { status: 'online', on(t, fn) { handlers.set(t, fn); return () => handlers.delete(t); },
    async request(t, body) { sent.push({ t, ...body }); if (locked) throw { code: 'ROOM_STARTED' }; } };
  const target = createStore({ skins: { [skin.charId]: skin.id }, skinSync: 'idle', open: true });
  const s = sync.installSkinSync({ net, target, notify() {}, timers: { setTimeout() { return 1; }, clearTimeout() {} } });
  await s.flush();
  assert.equal(target.get().skinSync, 'locked');
  assert.deepEqual(target.get().skins, { [skin.charId]: skin.id }, 'next-match preference survives');
  assert.deepEqual(sent[0], { t: 'room.skins', skins: { [skin.charId]: skin.id } });
  locked = false;
  handlers.get('room.state')({ inMatch: false });
  await s.flush();
  assert.equal(target.get().skinSync, 'synced');
  const previousStorage = globalThis.localStorage;
  const stored = new Map();
  globalThis.localStorage = { getItem: (k) => stored.get(k), setItem: (k, v) => stored.set(k, v) };
  try {
    sync.setSkins({ [skin.charId]: skin.id });
    assert.equal(JSON.parse(stored.get('sp.pref.skins')).skins[skin.charId], skin.id);
    assert.equal(sync.loadoutStore.get().skins[skin.charId], skin.id);
  } finally { globalThis.localStorage = previousStorage; sync.setSkins({}); s.dispose(); }
});

test('local skin preferences round-trip exact IDs, clear defaults and reject foreign/prototype payloads', async () => {
  const mod = await import('../../public/js/ui/skins.js').catch(() => null);
  assert.ok(mod, 'missing local skin preference model');
  const chosen = mod.setSkinChoice({}, skin.charId, skin.id);
  assert.deepEqual(chosen, { [skin.charId]: skin.id });
  assert.deepEqual(mod.parseStoredSkins(mod.toStoredSkins(chosen)), chosen);
  assert.deepEqual(mod.parseSkinImport(mod.serializeSkins(chosen)), { ok: true, skins: chosen });
  assert.deepEqual(mod.setSkinChoice(chosen, skin.charId, null), {});
  assert.deepEqual(mod.parseStoredSkins({ v: 1, skins: { char_other: skin.id } }), {});
  assert.deepEqual(mod.parseStoredSkins({ v: 1, skins: Object.create(chosen) }), {});
  assert.equal(mod.parseSkinImport('{"kind":"stronghold.diy","v":1,"skins":{}}').ok, false);
  assert.equal(mod.parseSkinImport('{"kind":"stronghold.skins","v":9,"skins":{}}').ok, false);
  assert.deepEqual(mod.parseSkinImport('{"kind":"stronghold.skins","v":1,"skins":{}}'), { ok: true, skins: {} });
});
