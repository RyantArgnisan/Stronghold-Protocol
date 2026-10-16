// Explicit opt-in HTTP/Socket probe, no browser and no battle simulation.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { TestClient } from '../helpers/wsClient.js';
if (process.env.SP_DAMAGE_SMOKE !== '1') process.exit(0);
const base = process.env.SP_URL; if (!base) throw new Error('SP_URL required');
const clients = [], checks = []; const mark = (x) => { checks.push(x); console.log('PASS', x); };
const connect = async (name, token) => { const c = await TestClient.connect(base.replace(/^http/, 'ws') + '/ws'); clients.push(c); const welcome = await c.hello(name, token); return { c, welcome }; };
try {
  const health = await (await fetch(base + '/healthz')).json(); assert.equal(health.app, '0.2.3-local.2'); mark(`health local.2 build ${health.build}`);
  for (const path of ['public/index.html','public/js/ui/damageBoard.js','public/css/screens/damage-board.css','public/js/screens/game.js','public/js/main.js','public/js/battle/runner.js','shared/protocol.js','shared/constants.js','server/sim/damage.js','server/sim/damageBoard.js','server/sim/spec.js']) {
    const url = path.replace(/^public\//, '/').replace(/^shared\//, '/shared/').replace(/^server\/sim\//, '/sim/');
    const res = await fetch(base + url); assert.equal(res.status, 200, url);
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), fs.readFileSync(path), url);
  } mark('11 exact served UI/protocol/sim resources match candidate bytes');
  for (const path of ['/data/chess.json','/data/skins-assets.json','/css/chat.css','/js/ui/skins.js']) { const r = await fetch(base + path); assert.equal(r.status, 200); assert.ok((await r.arrayBuffer()).byteLength); } mark('existing chat/skins/data HTTP resources remain');
  const people = []; for (let i = 0; i < 8; i++) people.push(await connect('伤害探测' + i));
  const host = people[0].c;
  assert.equal((await host.request({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity: 8 })).t, 'ok');
  const room = await host.waitFor('room.state');
  for (const { c } of people.slice(1)) assert.equal((await c.request({ t: 'room.join', code: room.code })).t, 'ok');
  await host.waitFor('room.state', (r) => r.seats.filter(Boolean).length === 8); mark('eight real socket seats');
  assert.equal((await host.request({ t: 'chat.send', clientId: 'damage-smoke', text: '伤害表保留中文交流' })).t, 'ok');
  await people[7].c.waitFor('chat.message', (m) => m.text === '伤害表保留中文交流'); mark('Chinese chat reaches eighth seat');
  for (const { c } of people.slice(1)) assert.equal((await c.request({ t: 'room.ready', ready: true })).t, 'ok');
  assert.equal((await host.request({ t: 'room.start' })).t, 'ok');
  const damage = await host.waitFor('m.damage'); assert.equal(damage.ownerId, people[0].welcome.playerId); assert.deepEqual(damage.total, []); mark('real match sends own-seat damage frame, new match zero');
  const packet = { rows: [], truncated: false };
  assert.equal((await host.request({ t: 'b.progress', battleId: 'stale.probe', gt: 0, killed: 0, total: 0, damage: packet })).t, 'ok');
  assert.equal((await host.request({ t: 'b.progress', battleId: 'stale.probe', gt: 0, killed: 0, total: 0, damage: { rows: Array(129).fill({}), truncated: false } })).t, 'error'); mark('new optional telemetry wire accepted and oversized rejected without mutating scores');
  const p = people[7]; await p.c.close();
  const resumed = await connect('伤害探测7', p.welcome.token); assert.equal(resumed.welcome.playerId, p.welcome.playerId);
  const restored = await resumed.c.waitFor('m.damage'); assert.equal(restored.ownerId, p.welcome.playerId); assert.deepEqual(restored.total, []); mark('socket reconnect restores same-seat match ledger');
} finally {
  for (const c of clients) if (c.isOpen) await c.request({ t: 'room.leave' }).catch(() => {});
  for (const c of clients) if (c.isOpen) await c.close();
}
const after = await (await fetch(base + '/healthz')).json();
for (const k of ['sockets','rooms','matches','humans']) assert.equal(after[k], 0, k);
mark('probe clients/room/match cleaned');
console.log(JSON.stringify({ base, checks, total: checks.length, after }, null, 2));
