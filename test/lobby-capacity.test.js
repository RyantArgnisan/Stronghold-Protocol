import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import * as constants from '../shared/constants.js';
import { validateC2S } from '../shared/protocol.js';

async function fixture(t) {
  const errors = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', MatchClass: StubMatch,
    log: { info() {}, warn() {}, error: (...a) => errors.push(a), debug() {} } });
  const clients = [];
  t.after(async () => {
    await Promise.all(clients.map((c) => c.terminate()));
    await srv.close();
    assert.deepEqual(errors, []);
  });
  const player = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId; c.token = w.token;
    return c;
  };
  return { srv, player };
}
test('capacity must be an optional integer 4–8; rejected creates keep the existing room', async (t) => {
  const { player, srv } = await fixture(t);
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const initial = await host.waitFor('room.state');
  assert.equal(initial.capacity, 4);
  for (const capacity of [3, 9, 4.5, '8', null, true]) {
    const msg = { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity };
    assert.notEqual(validateC2S(msg), null, `reject ${capacity}`);
    assert.equal((await host.request(msg)).code, 'BAD_MSG');
    assert.ok(srv.lobby.getRoom(initial.code));
  }
});

test('extended draft wire indexes stop at the shared ten-card limit; reward indexes stay unchanged', () => {
  assert.equal(constants.SP_DRAFT_MAX_CARDS, 10);
  for (let idx = 0; idx < 10; idx++) assert.equal(validateC2S({ t: 'g.choice', idx }), null);
  for (const idx of [-1, 10, 0.5, '7']) assert.notEqual(validateC2S({ t: 'g.choice', idx }), null);
  assert.notEqual(validateC2S({ t: 'g.reward', idx: 6 }), null);
  assert.notEqual(validateC2S({ t: 'g.choice', idx: 9, choiceId: '' }), null);
});

test('explicit room capacity is mode-aware and preserves membership after invalid requests', async (t) => {
  const { player, srv } = await fixture(t);
  const host = await player('ModeCapacity');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity: 8 });
  const initial = await host.waitFor('room.state');
  for (const [mode, capacity] of [['coop', 1], ['solo', 4], ['solo', 8]]) {
    const msg = { t: 'room.create', mode, difficulty: 'FUNNY', capacity };
    assert.notEqual(validateC2S(msg), null, `${mode}/${capacity}`);
    assert.equal((await host.request(msg)).code, 'BAD_MSG');
    assert.ok(srv.lobby.getRoom(initial.code));
  }
  assert.equal(validateC2S({ t: 'room.create', mode: 'solo', difficulty: 'FUNNY', capacity: 1 }), null);
});

const ok = async (c, msg) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'ok', JSON.stringify(r));
};

for (const capacity of [4, 5, 6, 7, 8]) {
  test(`capacity=${capacity} counts AI seats and bounds bot removal/kick to this room`, async (t) => {
    const { player, srv } = await fixture(t);
    const host = await player('Host');
    await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity });
    const state = await host.waitFor('room.state');
    assert.equal(state.capacity, capacity);
    assert.equal(state.seats.length, capacity);
    for (let i = 1; i < capacity; i++) await ok(host, { t: 'room.addBot' });
    const room = srv.lobby.getRoom(state.code);
    assert.equal(room.seats.filter((s) => s?.isBot).length, capacity - 1);
    assert.equal((await host.request({ t: 'room.addBot' })).code, 'ROOM_FULL');
    const guest = await player('Guest');
    assert.equal((await guest.request({ t: 'room.join', code: state.code })).code, 'ROOM_FULL');
    const invalid = capacity === 8 ? 'BAD_MSG' : 'BAD_TARGET';
    assert.equal((await host.request({ t: 'room.removeBot', seat: capacity })).code, invalid);
    assert.equal((await host.request({ t: 'room.kick', seat: capacity, playerId: guest.id })).code, invalid);
    assert.equal(room.seats.length, capacity);
    await ok(host, { t: 'room.removeBot', seat: capacity - 1 });
    await ok(guest, { t: 'room.join', code: state.code });
    const joined = await guest.waitFor('room.state');
    assert.equal(joined.seats[capacity - 1].playerId, guest.id);
    await ok(host, { t: 'room.kick', seat: capacity - 1, playerId: guest.id });
    assert.equal(room.seats[capacity - 1], null);
    await ok(host, { t: 'room.addBot' });
    const spectator = await player('Watcher');
    await ok(spectator, { t: 'room.spectate', code: state.code });
    assert.equal(room.spectators.length, 1);
    assert.equal(room.seats.filter(Boolean).length, capacity);
    await ok(host, { t: 'room.start' });
    assert.equal(room.match.players.size, capacity, 'all occupied seats reach the match');
  });
}

test('legacy cooperative requests default to four seats and solo always has one', async (t) => {
  const { player, srv } = await fixture(t);
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const legacy = await host.waitFor('room.state');
  assert.equal(legacy.capacity, 4);
  assert.equal(legacy.seats.length, 4);
  for (let i = 0; i < 3; i++) await ok(host, { t: 'room.addBot' });
  assert.equal((await host.request({ t: 'room.addBot' })).code, 'ROOM_FULL');
  await ok(host, { t: 'room.create', mode: 'solo', difficulty: 'FUNNY', capacity: 1 });
  const solo = await host.waitFor('room.state', (s) => s.mode === 'solo');
  assert.equal(solo.capacity, 1);
  assert.equal(solo.seats.length, 1);
  assert.equal(srv.lobby.getRoom(legacy.code), null);
  const guest = await player('Guest');
  assert.equal((await guest.request({ t: 'room.join', code: solo.code })).code, 'ROOM_FULL');
  assert.equal((await guest.request({ t: 'room.spectate', code: solo.code })).code, 'ROOM_FULL');
  assert.equal((await host.request({ t: 'room.addBot' })).code, 'ROOM_FULL');
  await ok(host, { t: 'room.start' });
  assert.equal(srv.lobby.getRoom(solo.code).match.players.size, 1);
});

test('eight-player readiness, reconnect and host migration retain the last seat', async (t) => {
  const { player, srv } = await fixture(t);
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 });
  const state = await host.waitFor('room.state');
  const guests = [];
  for (let i = 1; i < 8; i++) {
    const c = await player(`P${i + 1}`);
    await ok(c, { t: 'room.join', code: state.code });
    guests.push(c);
    if (i !== 7) await ok(c, { t: 'room.ready', ready: true });
  }
  assert.equal((await host.request({ t: 'room.start' })).code, 'NOT_READY');
  const last = guests.at(-1);
  await ok(last, { t: 'room.ready', ready: true });
  await ok(host, { t: 'room.start' });
  const room = srv.lobby.getRoom(state.code);
  assert.equal(room.match.players.size, 8);
  await last.terminate();
  await host.waitFor('room.state', (s) => s.inMatch && s.seats[7]?.connected === false);
  const resumed = await player('P8', last.token);
  const back = await resumed.waitFor('room.state');
  assert.equal(back.seats[7].playerId, last.id);
  assert.equal(back.seats[7].connected, true);
  assert.equal(back.capacity, 8);
  const late = await player('Late');
  assert.equal((await late.request({ t: 'room.join', code: state.code })).code, 'ROOM_STARTED');
  await ok(host, { t: 'room.leave' });
  const migrated = await resumed.waitFor('room.state', (s) => s.hostId === guests[0].id);
  assert.equal(migrated.seats[7].playerId, last.id);
  assert.equal(migrated.capacity, 8);
});

test('capacity=8 seats eight real WebSocket players and rejects the ninth', async (t) => {
  const { player } = await fixture(t);
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 });
  const state = await host.waitFor('room.state');
  assert.equal(state.capacity, 8);
  assert.equal(state.seats.length, 8);
  assert.equal(constants.MAX_SEATS, 8);
  for (let i = 1; i < 8; i++) {
    const c = await player(`P${i}`);
    await ok(c, { t: 'room.join', code: state.code });
    const joined = await c.waitFor('room.state');
    assert.equal(joined.seats[i].playerId, c.id);
  }
  const ninth = await player('Ninth');
  assert.equal((await ninth.request({ t: 'room.join', code: state.code })).code, 'ROOM_FULL');
});
