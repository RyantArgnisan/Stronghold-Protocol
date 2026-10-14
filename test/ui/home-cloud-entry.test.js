import { test } from 'node:test';
import assert from 'node:assert/strict';
import { options } from '../../public/vendor/preact.module.js';
import { LobbyScreen } from '../../public/js/screens/lobby.js';
import { PingPill } from '../../public/js/ui/components.js';
import { openStats } from '../../public/js/screens/stats.js';
import { store } from '../../public/js/store.js';
import { readFile } from 'node:fs/promises';
const nodes = view => { const found = []; const walk = n => { if (!n || typeof n !== 'object') return; found.push(n); for (const c of [n.props?.children].flat(Infinity)) walk(c); }; walk(view); return found; };
test('home exposes clearly labeled statistics action and aggregate counts immediately after latency', () => {
 store.set({ me: { playerId: 'p', name: 'fixture' }, session: { entered: true }, connection: { status: 'online', ping: 5 }, online: { players: 3, rooms: 2 } });
 const component = { props: {}, __h: [], setState() {} }; options.__r({ __c: component });
 const view = LobbyScreen({});
 const all = nodes(view);
 const entry = all.find(n => n.props?.['data-testid'] === 'home-stats');
 assert.ok(entry, 'visible labeled statistics button, not just unnamed avatar');
 assert.equal(entry.props.onClick, openStats); entry.props.onClick();
 const left = all.find(n => n.props?.class === 'topbar__left');
 const children = [left.props.children].flat(Infinity).filter(Boolean);
 const ping = children.findIndex(n => n.type === PingPill);
 assert.equal(children[ping+1].props['data-testid'], 'home-online-counts');
 assert.match(JSON.stringify(children[ping+1].props.children), /3/); assert.match(JSON.stringify(children[ping+1].props.children), /2/);
});
test('room/game do not mount home counts and statistics tabs request cloud refresh without timers', async () => {
 for (const file of ['room.js', 'game.js']) assert.ok(!(await readFile(new URL('../../public/js/screens/'+file, import.meta.url), 'utf8')).includes('home-online-counts'));
 const source = await readFile(new URL('../../public/js/screens/stats.js', import.meta.url), 'utf8');
 assert.match(source, /autoCloudUpload\.refreshStats\(/);
 assert.match(source, /\[tab,\s*cloudAuthorized\]/);
});
