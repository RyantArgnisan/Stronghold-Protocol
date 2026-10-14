import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { StubMatch } from '../server/match/StubMatch.js';
import { TestClient } from './helpers/wsClient.js';
import { Lobby } from '../server/lobby.js';
import { SessionRegistry } from '../server/net.js';
import * as constants from '../shared/constants.js';
import { validateC2S, S2C } from '../shared/protocol.js';

const ok = async (c, msg) => {
  const r = await c.request(msg);
  assert.equal(r.t, 'ok', JSON.stringify(r));
};
async function wire(t) {
  const logs = [];
  const srv = await startServer({ port: 0, host: '127.0.0.1', MatchClass: StubMatch,
    log: Object.fromEntries(['info', 'warn', 'error', 'debug'].map((key) => [key, (...args) => logs.push([key, ...args])])) });
  let time = 10_000;
  srv.lobby.now = () => time;
  const clients = [];
  t.after(async () => { await Promise.all(clients.map((c) => c.terminate())); await srv.close();
    assert.equal(logs.filter(([level]) => level === 'error').length, 0); });
  const player = async (name, token) => {
    const c = await TestClient.connect(`ws://127.0.0.1:${srv.port}/ws`);
    clients.push(c);
    const w = await c.hello(name, token);
    c.id = w.playerId; c.token = w.token;
    return c;
  };
  const host = await player('Host');
  await ok(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 });
  const state = await host.waitFor('room.state');
  return { srv, host, code: state.code, player, logs, tick: (ms = 1000) => { time += ms; } };
}
// Real Lobby + SessionRegistry; only sockets are capture sinks for fast bounded-history/time tests.
function unit(t) {
  let time = 10_000;
  const registry = new SessionRegistry({ now: () => time });
  const lobby = new Lobby({ registry, now: () => time, getData: () => ({}), MatchClass: StubMatch });
  t.after(() => lobby.shutdown());
  const player = (name) => {
    const s = registry.create(name);
    s.connected = true;
    s.frames = [];
    s.ws = { readyState: 1, bufferedAmount: 0, send: (raw) => s.frames.push(JSON.parse(raw)) };
    return s;
  };
  const host = player('Host');
  assert.deepEqual(lobby.onMessage(host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL', capacity: 8 }), { ok: true });
  const room = lobby.roomOf(host);
  const send = (s, clientId, text = '消息') => lobby.onMessage(s, { t: 'chat.send', clientId, text });
  return { lobby, registry, host, room, player, send, tick: (ms = 1000) => { time += ms; } };
}

test('chat cleans controls and trims text, rejecting empty or over-200-code-point content without broadcasting', (t) => {
  const f = unit(t);
  assert.deepEqual(f.send(f.host, 'clean', ' \u0000你\u001b好\u007f\u0085\t '), { ok: true });
  assert.equal(f.host.frames.findLast((m) => m.t === 'chat.message').text, '你好');
  assert.equal(constants.CHAT_MAX_CHARS, 200);
  for (const text of ['', '   ', '\t\n\r\u0000', '中'.repeat(201), '😀'.repeat(201), 'x'.repeat(1025)]) {
    f.tick();
    const count = f.host.frames.length;
    assert.equal(f.send(f.host, `bad-${count}`, text).error, 'BAD_MSG');
    assert.equal(f.host.frames.length, count);
  }
  f.tick();
  assert.deepEqual(f.send(f.host, 'emoji', '😀'.repeat(200)), { ok: true });
  assert.equal([...f.host.frames.findLast((m) => m.t === 'chat.message').text].length, 200);
  for (const clientId of ['', 'x'.repeat(65), null, 123]) {
    assert.notEqual(validateC2S({ t: 'chat.send', clientId, text: 'hello' }), null);
  }
  for (const text of [null, 123, {}, []]) {
    assert.notEqual(validateC2S({ t: 'chat.send', clientId: 'good', text }), null);
    assert.equal(f.send(f.host, 'good', text).error, 'BAD_MSG');
  }
});

test('history is delivered on create/join/spectate and hello resync, never on regular room state broadcasts', async (t) => {
  const f = await wire(t);
  assert.deepEqual(await f.host.waitFor('chat.history'), { t: 'chat.history', code: f.code, messages: [], lastId: 0 });
  await ok(f.host, { t: 'chat.send', clientId: 'one', text: '历史消息' });
  const message = await f.host.waitFor('chat.message');
  const guest = await f.player('Guest');
  await ok(guest, { t: 'room.join', code: f.code });
  const expected = { t: 'chat.history', code: f.code, messages: [message], lastId: 1 };
  assert.deepEqual(await guest.waitFor('chat.history'), expected);
  const spectator = await f.player('Watcher');
  await ok(spectator, { t: 'room.spectate', code: f.code });
  assert.deepEqual(await spectator.waitFor('chat.history'), expected);
  await ok(guest, { t: 'room.ready', ready: true });
  await guest.expectNone('chat.history');
  await guest.hello('Guest', guest.token);
  assert.deepEqual(await guest.waitFor('chat.history'), expected);
  f.tick();
  await guest.terminate();
  await f.host.waitFor('room.state', (s) => s.seats[1]?.connected === false);
  const resumed = await f.player('Guest', guest.token);
  assert.deepEqual(await resumed.waitFor('chat.history'), expected);
  assert.ok(S2C.includes('chat.history'));
});

test('session chat cooldown is exactly one second and survives reconnect and room changes', async (t) => {
  const f = await wire(t);
  await ok(f.host, { t: 'chat.send', clientId: 'first', text: '第一条' });
  assert.equal((await f.host.request({ t: 'chat.send', clientId: 'second', text: '第二条' })).code, 'RATE');
  await f.host.terminate();
  const resumed = await f.player('Host', f.host.token);
  assert.equal((await resumed.request({ t: 'chat.send', clientId: 'second', text: '第二条' })).code, 'RATE');
  f.tick(999);
  assert.equal((await resumed.request({ t: 'chat.send', clientId: 'second', text: '第二条' })).code, 'RATE');
  f.tick(1);
  await ok(resumed, { t: 'chat.send', clientId: 'second', text: '第二条' });
  await ok(resumed, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  assert.equal((await resumed.request({ t: 'chat.send', clientId: 'third', text: '新房间' })).code, 'RATE');
  f.tick();
  await ok(resumed, { t: 'chat.send', clientId: 'third', text: '新房间' });
});

test('successful clientId retries acknowledge without re-broadcasting or consuming cooldown, including reconnect', async (t) => {
  const f = await wire(t);
  await ok(f.host, { t: 'chat.send', clientId: 'same', text: '原消息' });
  await f.host.waitFor('chat.message');
  await ok(f.host, { t: 'chat.send', clientId: 'same', text: '不得替换原消息' });
  await f.host.expectNone('chat.message');
  await f.host.terminate();
  const resumed = await f.player('Host', f.host.token);
  await ok(resumed, { t: 'chat.send', clientId: 'same', text: '重试' });
  await resumed.expectNone('chat.message');
  const room = f.srv.lobby.getRoom(f.code);
  assert.equal(room.chat.messages.length, 1);
  assert.equal(room.chat.messages[0].text, '原消息');
  f.tick();
  await ok(resumed, { t: 'chat.send', clientId: 'same', text: '重试' });
  await ok(resumed, { t: 'chat.send', clientId: 'next', text: '新消息' });
  assert.equal((await resumed.waitFor('chat.message')).id, 2);
  const guest = await f.player('Guest');
  await ok(guest, { t: 'room.join', code: f.code });
  await ok(guest, { t: 'chat.send', clientId: 'same', text: '另一个人同ID' });
  assert.equal((await guest.waitFor('chat.message')).id, 3);
});

test('room history retains only the latest 100 messages with monotonic IDs', (t) => {
  const f = unit(t);
  for (let i = 1; i <= 101; i++) {
    assert.deepEqual(f.send(f.host, `id-${i}`, `第${i}条`), { ok: true });
    f.tick();
  }
  assert.equal(f.room.chat.messages.length, 100);
  assert.equal(constants.CHAT_HISTORY_LIMIT, 100);
  const newcomer = f.player('New');
  assert.deepEqual(f.lobby.onMessage(newcomer, { t: 'room.join', code: f.room.code }), { ok: true });
  const history = newcomer.frames.findLast((m) => m.t === 'chat.history');
  assert.equal(history.code, f.room.code);
  assert.equal(history.messages.length, 100);
  assert.equal(history.messages[0].id, 2);
  assert.equal(history.messages.at(-1).id, 101);
  assert.equal(history.lastId, 101);
});

test('clientId dedupe retains only 100 successful IDs per logical session and room', (t) => {
  const f = unit(t);
  for (let i = 1; i <= 101; i++) {
    assert.deepEqual(f.send(f.host, `id-${i}`), { ok: true });
    f.tick();
  }
  assert.deepEqual(f.send(f.host, 'id-2'), { ok: true });
  assert.equal(f.room.chat.lastId, 101, 'retained ID does not re-broadcast');
  assert.deepEqual(f.send(f.host, 'id-1'), { ok: true });
  assert.equal(f.room.chat.lastId, 102, 'oldest evicted ID can be sent again');
  const previous = f.room;
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  f.tick();
  assert.deepEqual(f.send(f.host, 'id-101'), { ok: true });
  assert.equal(f.lobby.roomOf(f.host).chat.lastId, 1, 'another room has its own retry IDs');
  assert.equal(previous.disposed, true);
});

test('room chat admits at most ten messages in a rolling second, including member churn', (t) => {
  const f = unit(t);
  assert.deepEqual(f.send(f.host, 'host'), { ok: true });
  for (let i = 1; i < 10; i++) {
    const s = f.player(`P${i}`);
    assert.deepEqual(f.lobby.onMessage(s, { t: 'room.join', code: f.room.code }), { ok: true });
    assert.deepEqual(f.send(s, 'one'), { ok: true });
    assert.deepEqual(f.lobby.onMessage(s, { t: 'room.leave' }), { ok: true });
  }
  const next = f.player('Next');
  assert.deepEqual(f.lobby.onMessage(next, { t: 'room.join', code: f.room.code }), { ok: true });
  assert.deepEqual(f.send(next, 'retry'), { error: 'RATE' });
  assert.equal(f.room.chat.lastId, 10);
  assert.deepEqual(f.send(f.host, 'host'), { ok: true }, 'dedupe precedes room throttle');
  f.tick(999);
  assert.deepEqual(f.send(next, 'retry'), { error: 'RATE' });
  f.tick(1);
  assert.deepEqual(f.send(next, 'retry'), { ok: true }, 'failed send consumed neither ID nor session cooldown');
  assert.equal(f.room.chat.lastId, 11);
  const other = f.player('OtherRoom');
  assert.deepEqual(f.lobby.onMessage(other, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  assert.deepEqual(f.send(other, 'independent'), { ok: true });
});

test('host can mute and unmute a current human member, broadcasting IDs and CHAT_MUTED', async (t) => {
  const f = await wire(t);
  const guest = await f.player('Guest');
  await ok(guest, { t: 'room.join', code: f.code });
  await ok(f.host, { t: 'room.chatMute', playerId: guest.id, on: true });
  const state = await guest.waitFor('room.state', (s) => s.mutedPlayerIds?.includes(guest.id));
  assert.deepEqual(state.mutedPlayerIds, [guest.id]);
  assert.equal(constants.ERR.CHAT_MUTED, 'CHAT_MUTED');
  assert.equal((await guest.request({ t: 'chat.send', clientId: 'blocked', text: '禁言消息' })).code, 'CHAT_MUTED');
  await guest.expectNone('chat.message');
  assert.equal(f.srv.lobby.getRoom(f.code).chat.lastId, 0);
  await ok(f.host, { t: 'room.chatMute', playerId: guest.id, on: false });
  await guest.waitFor('room.state', (s) => s.mutedPlayerIds?.length === 0);
  await ok(guest, { t: 'chat.send', clientId: 'blocked', text: '现在可以发言' });
  assert.equal((await f.host.waitFor('chat.message')).text, '现在可以发言');
  for (const msg of [
    { t: 'room.chatMute', playerId: guest.id, on: 'true' },
    { t: 'room.chatMute', playerId: '', on: true },
    { t: 'room.chatMute', playerId: guest.id },
  ]) assert.notEqual(validateC2S(msg), null);
});

test('chat send requires the connected registry session, not a copied identity or stale membership', (t) => {
  const f = unit(t);
  const impostor = { ...f.host, frames: [] };
  assert.deepEqual(f.send(impostor, 'spoof'), { error: 'NOT_IN_ROOM' });
  f.host.connected = false;
  assert.deepEqual(f.send(f.host, 'offline'), { error: 'NOT_IN_ROOM' });
  f.host.connected = true;
  const outsider = f.player('Outsider');
  outsider.roomCode = f.room.code;
  assert.deepEqual(f.send(outsider, 'stale'), { error: 'NOT_IN_ROOM' });
  assert.equal(outsider.roomCode, null);
  const guest = f.player('Guest');
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.join', code: f.room.code }), { ok: true });
  f.room.seatOf(guest.playerId).left = true;
  assert.deepEqual(f.send(guest, 'departed'), { error: 'NOT_IN_ROOM' });
  assert.equal(f.room.chat.lastId, 0);
});

test('mute administration requires the live host and targets only this room human members', (t) => {
  const f = unit(t);
  const guest = f.player('Guest');
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.join', code: f.room.code }), { ok: true });
  const mute = (s, playerId, on = true) => f.lobby.onMessage(s, { t: 'room.chatMute', playerId, on });
  assert.deepEqual(mute({ ...f.host }, guest.playerId), { error: 'NOT_IN_ROOM' });
  assert.equal(mute(guest, f.host.playerId).error, 'NOT_HOST');
  const spectator = f.player('Watch');
  assert.deepEqual(f.lobby.onMessage(spectator, { t: 'room.spectate', code: f.room.code }), { ok: true });
  assert.equal(mute(spectator, guest.playerId).error, 'NOT_HOST');
  const outsider = f.player('Other');
  assert.deepEqual(f.lobby.onMessage(outsider, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.addBot' }), { ok: true });
  for (const id of ['unknown', outsider.playerId, spectator.playerId, f.room.seats[2].playerId]) {
    assert.equal(mute(f.host, id).error, 'BAD_TARGET');
  }
  assert.equal(mute(f.host, guest.playerId, 'true').error, 'BAD_MSG');
  assert.deepEqual(f.room.toState().mutedPlayerIds, []);
  guest.connected = false;
  assert.deepEqual(mute(f.host, guest.playerId), { ok: true }, 'offline member can be muted');
  guest.connected = true;
  assert.deepEqual(mute(f.host, guest.playerId), { ok: true }, 'setting an existing mute is idempotent');
  assert.deepEqual(f.room.toState().mutedPlayerIds, [guest.playerId]);
});

test('mutes survive host migration but are removed when the target leaves, is kicked or expires', (t) => {
  const f = unit(t);
  const successor = f.player('NextHost');
  assert.deepEqual(f.lobby.onMessage(successor, { t: 'room.join', code: f.room.code }), { ok: true });
  const target = f.player('Muted');
  assert.deepEqual(f.lobby.onMessage(target, { t: 'room.join', code: f.room.code }), { ok: true });
  const mute = (s, playerId, on = true) => f.lobby.onMessage(s, { t: 'room.chatMute', playerId, on });
  assert.deepEqual(mute(f.host, target.playerId), { ok: true });
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.leave' }), { ok: true });
  assert.equal(f.room.hostId, successor.playerId);
  assert.deepEqual(f.room.toState().mutedPlayerIds, [target.playerId]);
  assert.deepEqual(f.send(target, 'blocked'), { error: 'CHAT_MUTED' });
  assert.deepEqual(mute(successor, target.playerId, false), { ok: true });
  for (const departure of ['room.leave', 'room.kick', 'expire']) {
    if (!f.lobby.roomOf(target)) assert.deepEqual(f.lobby.onMessage(target, { t: 'room.join', code: f.room.code }), { ok: true });
    assert.deepEqual(mute(successor, target.playerId), { ok: true });
    if (departure === 'room.kick') {
      assert.deepEqual(f.lobby.onMessage(successor, { t: departure, playerId: target.playerId, seat: f.room.seatOf(target.playerId).seat }), { ok: true });
    } else if (departure === 'expire') f.lobby.onExpire(target);
    else assert.deepEqual(f.lobby.onMessage(target, { t: departure }), { ok: true });
    assert.deepEqual(f.room.toState().mutedPlayerIds, [], 'departed IDs cannot accumulate in room state');
    assert.equal(mute(successor, target.playerId).error, 'BAD_TARGET');
  }
});

test('destroying a room clears chat history, dedupe, room throttle and mute state', (t) => {
  const f = unit(t);
  assert.deepEqual(f.send(f.host, 'one'), { ok: true });
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.chatMute', playerId: f.host.playerId, on: true }), { ok: true });
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.leave' }), { ok: true });
  assert.equal(f.room.disposed, true);
  assert.equal(f.lobby.getRoom(f.room.code), null);
  assert.deepEqual(f.room.chat.history(f.room.code).messages, []);
  assert.equal(f.room.chat.lastId, 0);
  assert.equal(f.room.chat.seen(f.host, 'one'), false);
  assert.deepEqual(f.room.chat.sendTimes, []);
  assert.deepEqual(f.room.toState().mutedPlayerIds, []);
});

test('eight WebSocket players and a read-only spectator receive chat; kicked, departed and switched members do not', async (t) => {
  const f = await wire(t);
  const members = [f.host];
  for (let i = 1; i < 8; i++) {
    const c = await f.player(`P${i + 1}`);
    await ok(c, { t: 'room.join', code: f.code });
    members.push(c);
  }
  const watcher = await f.player('Watcher');
  await ok(watcher, { t: 'room.spectate', code: f.code });
  assert.equal((await watcher.request({ t: 'chat.send', clientId: 'read-only', text: '不能发送' })).code, 'SPECTATOR');
  await ok(members[7], { t: 'chat.send', clientId: 'p8', text: '第八席发言' });
  const received = await Promise.all([...members, watcher].map((c) => c.waitFor('chat.message')));
  for (const msg of received) assert.deepEqual(msg, received[0]);
  assert.equal(received[0].seat, 7);
  await ok(f.host, { t: 'room.kick', seat: 7, playerId: members[7].id });
  await ok(members[6], { t: 'room.leave' });
  await ok(members[5], { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  await ok(f.host, { t: 'room.removeSpectator', playerId: watcher.id });
  for (const c of [members[7], members[6], watcher]) {
    assert.equal((await c.request({ t: 'chat.send', clientId: 'not-here', text: '已离开' })).code, 'NOT_IN_ROOM');
  }
  f.tick();
  await ok(f.host, { t: 'chat.send', clientId: 'remaining', text: '只发当前房间' });
  await f.host.waitFor('chat.message');
  for (const c of [members[7], members[6], members[5], watcher]) await c.expectNone('chat.message');
});

test('chat remains available across match phases, elimination, match completion and the next match', (t) => {
  const f = unit(t);
  const guest = f.player('Guest');
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.join', code: f.room.code }), { ok: true });
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.ready', ready: true }), { ok: true });
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.start' }), { ok: true });
  const match = f.room.match;
  // Chat is a Lobby concern; it must never consult a match phase/alive gate.
  match.players.get(guest.playerId).eliminated = true;
  for (const phase of ['INFO_CHECK', 'BAND_DRAFT', 'SP_DRAFT', 'PREP', 'COMBAT', 'UNITE', 'FINAL_ASSAULT', 'RESULT']) {
    match.phase = phase;
    assert.deepEqual(f.send(guest, phase, `淘汰后仍在房间：${phase}`), { ok: true });
    f.tick();
  }
  f.lobby.onMatchEnd(f.room, f.room.matchCtx, { victory: true });
  assert.deepEqual(f.send(guest, 'after'), { ok: true });
  f.tick();
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.ready', ready: true }), { ok: true });
  assert.deepEqual(f.lobby.onMessage(f.host, { t: 'room.start' }), { ok: true });
  assert.equal(f.room.chat.messages.length, 9, 'starting another match preserves chat');
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'g.leave' }), { ok: true });
  assert.equal(f.send(guest, 'left').error, 'NOT_IN_ROOM');
  assert.equal(f.lobby.onMessage(f.host, { t: 'room.chatMute', playerId: guest.playerId, on: true }).error, 'BAD_TARGET');
  guest.frames = [];
  assert.deepEqual(f.send(f.host, 'still-here'), { ok: true });
  assert.equal(guest.frames.some((m) => m.t === 'chat.message'), false);
});

test('expired logical sessions no longer send chat and cooldown/dedupe use weak session keys', (t) => {
  const f = unit(t);
  const guest = f.player('Guest');
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.join', code: f.room.code }), { ok: true });
  assert.deepEqual(f.send(guest, 'one'), { ok: true });
  assert.ok(f.lobby.chatSendTimes instanceof WeakMap);
  assert.ok(f.room.chat.sentIds instanceof WeakMap);
  guest.connected = false;
  guest.disconnectedAt = f.lobby.now();
  f.tick(f.registry.reconnectWindowMs + 1);
  const expired = f.registry.sweep();
  assert.deepEqual(expired, [guest]);
  for (const s of expired) f.lobby.onExpire(s);
  assert.equal(f.registry.byId(guest.playerId), null);
  guest.connected = true;
  assert.deepEqual(f.send(guest, 'old-token'), { error: 'NOT_IN_ROOM' });
  assert.equal(f.room.seatOf(guest.playerId), null);
});

test('history snapshots cannot be sent to outsiders, expired identities or members of another current room', (t) => {
  const f = unit(t);
  assert.deepEqual(f.send(f.host, 'secret', '仅当前房间'), { ok: true });
  const outsider = f.player('Outside');
  outsider.frames = [];
  f.lobby.sendChatHistory(f.room, outsider);
  assert.deepEqual(outsider.frames, []);
  const guest = f.player('Guest');
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.join', code: f.room.code }), { ok: true });
  assert.deepEqual(f.lobby.onMessage(guest, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' }), { ok: true });
  guest.frames = [];
  f.lobby.sendChatHistory(f.room, guest);
  assert.deepEqual(guest.frames, []);
  const copy = { ...f.host, frames: [] };
  const before = f.host.frames.length;
  f.lobby.sendChatHistory(f.room, copy);
  assert.equal(f.host.frames.length, before, 'copied identity must not invoke a history delivery');
  f.registry.remove(f.host);
  f.lobby.sendChatHistory(f.room, f.host);
  assert.equal(f.host.frames.length, before, 'removed registry identity must not receive history');
});

test('room chat broadcasts one server-authored message to two WebSocket members only', async (t) => {
  const f = await wire(t);
  const guest = await f.player('Guest');
  await ok(guest, { t: 'room.join', code: f.code });
  const outsider = await f.player('Outside');
  await ok(outsider, { t: 'room.create', mode: 'coop', difficulty: 'NORMAL' });
  const other = await outsider.waitFor('room.state');
  await ok(guest, { t: 'chat.send', clientId: 'msg1', text: '你好队友', code: other.code,
    playerId: outsider.id, name: 'Impostor', seat: 7, role: 'host', at: 1, id: 999 });
  const message = await guest.waitFor('chat.message');
  assert.deepEqual(message, { t: 'chat.message', code: f.code, id: 1, playerId: guest.id,
    name: 'Guest', seat: 1, role: 'player', text: '你好队友', at: 10_000 });
  assert.deepEqual(await f.host.waitFor('chat.message'), message);
  await outsider.expectNone('chat.message');
  assert.ok(S2C.includes('chat.message'));
  assert.equal(f.logs.some((line) => JSON.stringify(line).includes('你好队友')), false, 'chat content is not logged');
});
