import test from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
import { SKIN_CATALOGUE } from '../shared/skin-catalogue.js';
import { ERR } from '../shared/constants.js';
import { HEAVY_TYPES } from '../server/net.js';
import { DATA, makeMatch } from './match/harness.js';
import { buildBattleSpec, createBattleFromSpec } from '../server/sim/spec.js';
import { getDefaultSource } from '../server/sim/simdata.js';
import { unitInfo } from '../server/sim/snapshot.js';

const skin = SKIN_CATALOGUE[0];
const choices = { [skin.charId]: skin.id };
async function network(t) {
  const errors = [];
  const log = { info() {}, warn() {}, debug() {}, error(...args) { errors.push(args.map(String).join(' ')); } };
  const srv = await startServer({ port: 0, host: '127.0.0.1', log, seedFn: () => 4242, heavyBurst: 50 });
  const clients = [];
  t.after(async () => { for (const c of clients) await c.terminate(); await srv.close(); assert.deepEqual(errors, []); });
  return { srv, async player(name, token) {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId; c.token = w.token;
    return c;
  } };
}
async function ok(c, msg) { const r = await c.request(msg); assert.equal(r.t, 'ok', JSON.stringify(r)); return r; }
async function create(c) {
  await ok(c, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 });
  return c.waitFor('room.state');
}

test('outside-room skin preferences survive room changes and token reconnect', async (t) => {
  const n = await network(t);
  const a = await n.player('Owner');
  await ok(a, { t: 'room.skins', skins: choices });
  let state = await create(a);
  assert.deepEqual(state.seats[0].skins, choices);
  await ok(a, { t: 'room.leave' });
  state = await create(a);
  assert.deepEqual(state.seats[0].skins, choices);
  await a.terminate();
  const back = await n.player('Owner', a.token);
  assert.equal(back.id, a.id);
  const resumed = await back.waitFor('room.state');
  assert.deepEqual(resumed.seats[0].skins, choices);
  await ok(back, { t: 'room.skins', skins: {} });
  const cleared = await back.waitFor('room.state', (s) => !Object.hasOwn(s.seats[0], 'skins'));
  assert.equal(Object.hasOwn(cleared.seats[0], 'skins'), false);
});

test('spectators cannot edit cosmetic preferences', async (t) => {
  const n = await network(t);
  const a = await n.player('Owner');
  const state = await create(a);
  const s = await n.player('Watcher');
  await ok(s, { t: 'room.spectate', code: state.code });
  const reply = await s.request({ t: 'room.skins', skins: choices });
  assert.equal(reply.t, 'error');
  assert.equal(reply.code, ERR.SPECTATOR);
  await ok(s, { t: 'room.leave' });
  const own = await create(s);
  assert.equal(Object.hasOwn(own.seats[0], 'skins'), false, 'refusal must not store session choices');
});

test('match start snapshots owner choices into public and private views with bots default', async (t) => {
  const n = await network(t);
  const a = await n.player('Owner');
  await ok(a, { t: 'room.skins', skins: choices });
  await create(a);
  await ok(a, { t: 'room.addBot' });
  await ok(a, { t: 'room.start' });
  const priv = await a.waitFor('m.private');
  assert.deepEqual(priv.skins, choices);
  const pub = await a.waitFor('m.public');
  assert.deepEqual(pub.players.find((p) => p.playerId === a.id).skins, choices);
  assert.equal(Object.hasOwn(pub.players.find((p) => p.isBot), 'skins'), false);
  await a.terminate();
  const back = await n.player('Owner', a.token);
  assert.deepEqual((await back.waitFor('m.private')).skins, choices);
  const watcher = await n.player('Watcher');
  const state = await back.waitFor('room.state');
  await ok(watcher, { t: 'room.spectate', code: state.code });
  const seen = await watcher.waitFor('m.public');
  assert.deepEqual(seen.players.find((p) => p.playerId === a.id).skins, choices);
  assert.equal(watcher.log.some((m) => m.t === 'm.private'), false);
});

test('ROOM_STARTED locks skins even in briefing without mutating room or session choices', async (t) => {
  const n = await network(t);
  const a = await n.player('Owner');
  await ok(a, { t: 'room.skins', skins: choices });
  await create(a);
  await ok(a, { t: 'room.start' });
  await a.waitFor('m.private');
  const reply = await a.request({ t: 'room.skins', skins: {} });
  assert.equal(reply.t, 'error');
  assert.equal(reply.code, ERR.ROOM_STARTED);
  await a.terminate();
  const back = await n.player('Owner', a.token);
  assert.deepEqual((await back.waitFor('m.private')).skins, choices);
  assert.deepEqual((await back.waitFor('room.state')).seats[0].skins, choices);
  await ok(back, { t: 'room.leave' });
  assert.deepEqual((await create(back)).seats[0].skins, choices);
});

test('room.skins uses the heavy request bucket', () => {
  assert.equal(HEAVY_TYPES.has('room.skins'), true);
});

const normal = Object.values(DATA.chess).find((c) => !c.isGolden && c.goldenId && SKIN_CATALOGUE.some((s) => s.charId === c.charId));
const normalSkin = SKIN_CATALOGUE.find((s) => s.charId === normal.charId);
const siegeSkin = SKIN_CATALOGUE.find((s) => s.charId === 'char_112_siege');
const diySlot = 'chess_char_5_diy1_a';
function skinMatch(t) {
  const selected = { [normal.charId]: normalSkin.id, [siegeSkin.charId]: siegeSkin.id };
  const seat = (id, skins = {}) => ({ seat: Number(id.slice(-1)), playerId: id, name: id, isBot: false, connected: true, skins,
    diy: { [diySlot]: { charId: siegeSkin.charId, skillIndex: 0 } } });
  const h = makeMatch({ seats: [seat('p_0', selected), seat('p_1')], seed: 11 }).start();
  t.after(() => h.m.dispose());
  return h;
}
function piece(id, uid = 1) { return { kind: 'chess', id, uid, items: [] }; }

test('chess piece views resolve skins by composed actual charId including elite DIY slots', (t) => {
  const h = skinMatch(t);
  const ps = h.ps('p_0');
  for (const id of [normal.chessId, normal.goldenId, diySlot, DATA.chess[diySlot].goldenId]) {
    const p = piece(id);
    assert.equal(ps.pieceView(p).skin, id.includes('diy') ? siegeSkin.id : normalSkin.id);
    assert.equal(Object.hasOwn(h.ps('p_1').pieceView(p), 'skin'), false, 'another owner retains defaults');
  }
  assert.equal(Object.hasOwn(ps.pieceView({ kind: 'token', id: 'token_probe', uid: 8 }), 'skin'), false);
  assert.equal(Object.hasOwn(ps.pieceView({ kind: 'item', id: 'item_probe', uid: 9 }), 'skin'), false);
});
