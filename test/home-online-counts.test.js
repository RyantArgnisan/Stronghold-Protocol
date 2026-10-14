import { test } from 'node:test';
import assert from 'node:assert/strict';
import { startServer } from '../server/index.js';
import { TestClient } from './helpers/wsClient.js';
test('existing latency response carries aggregate connected-human and room counts, excluding anonymous sockets, disconnected sessions and bots', async () => {
 const srv = await startServer({ port: 0, host: '127.0.0.1', quiet: true });
 const clients = [];
 try {
  const a = await TestClient.connect(srv.url.replace(/^http/, 'ws') + '/ws'); clients.push(a); await a.hello('counts-a');
  const b = await TestClient.connect(srv.url.replace(/^http/, 'ws') + '/ws'); clients.push(b); await b.hello('counts-b');
  const anonymous = await TestClient.connect(srv.url.replace(/^http/, 'ws') + '/ws'); clients.push(anonymous);
  const pong = await a.request({ t: 'ping', c: 1 });
  assert.deepEqual(pong.online, { players: 2, rooms: 0 });
  const room = await a.request({ t: 'room.create', mode: 'coop', difficulty: 'FUNNY', capacity: 8 });
  assert.ok(room);
  assert.deepEqual((await a.request({ t: 'ping', c: 2 })).online, { players: 2, rooms: 1 });
  await b.close(); await new Promise(r => setTimeout(r, 30));
  assert.deepEqual((await a.request({ t: 'ping', c: 3 })).online, { players: 1, rooms: 1 });
  await a.request({ t: 'room.leave' });
 } finally { await Promise.all(clients.map(c => c.close())); await srv.close(); }
});
