// Real isolated Preact lifecycle; no browser/game server.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
const { parseHTML } = createRequire(import.meta.url)(process.env.SP_DOM_MODULE || 'linkedom');
const { window, document } = parseHTML('<html><body></body></html>');
Object.assign(globalThis, { window, document, Element: window.Element, getComputedStyle: () => ({ visibility: 'visible' }) });
window.Element.prototype.getClientRects = () => [{}];
const memory = new Map();
globalThis.localStorage = { getItem: k => memory.get(k) ?? null, setItem: (k,v) => memory.set(k,v) };
const { html } = await import('../../public/js/ui/components.js');
const { render } = await import('../../public/vendor/preact.module.js');
const { store, emptyMatch } = await import('../../public/js/store.js');
const { net } = await import('../../public/js/net.js');
const root = document.createElement('div'); document.body.appendChild(root);
const settle = () => new Promise(r => setTimeout(r, 65));
const lobby = () => { net.helloName = 'fixture'; store.set({ session: { entered: true }, me: { playerId: 'p', name: 'fixture', token: 'fixture-token' }, connection: { status: 'online' }, room: null, match: emptyMatch(), ui: { restoring: false, pendingJoin: null } }); };
test('post-entry update log opens after welcome, closes, reopens manually and stays seen across remount', async () => {
 const url = new URL('../../public/js/ui/updateLog.js', import.meta.url);
 assert.ok(existsSync(url), 'post-entry update-log component must exist');
 const { UpdateLogEntry, UPDATE_ID } = await import(url);
 lobby(); store.patch('session', { entered: false });
 render(html`<${UpdateLogEntry} delay=${0} />`, root); await settle();
 assert.ok(!root.querySelector('[role=dialog]'), 'no title popup');
 store.patch('session', { entered: true }); store.patch('connection', { status: 'handshaking' }); await settle();
 assert.ok(!root.querySelector('[role=dialog]'), 'failed/pending hello must not open');
 store.patch('connection', { status: 'online' }); await settle(); await settle();
 assert.ok(root.querySelector('[role=dialog]'), 'successful entered lobby opens');
 assert.ok(root.textContent.includes(UPDATE_ID));
 root.querySelector('[data-testid=update-log-close]').click(); await settle();
 assert.ok(!root.querySelector('[role=dialog]'));
 root.querySelector('[data-testid=update-log-open]').click(); await settle();
 assert.ok(root.querySelector('[role=dialog]'), 'manual reopening');
 render(null, root); render(html`<${UpdateLogEntry} delay=${0} />`, root); await settle(); await settle();
 assert.ok(!root.querySelector('[role=dialog]'), 'current update already seen');
 render(null, root);
});
test('a new ID opens once; storage failures are harmless and do not repeat within the document', async () => {
 const { UpdateLogEntry } = await import('../../public/js/ui/updateLog.js');
 globalThis.localStorage = { getItem() { throw Error('denied'); }, setItem() { throw Error('quota'); } };
 lobby(); render(html`<${UpdateLogEntry} updateId="fixture-new-id" delay=${0} />`, root); await settle(); await settle();
 assert.ok(root.querySelector('[role=dialog]'), 'new update is independent of current seen ID');
 root.querySelector('[data-testid=update-log-close]').click(); await settle();
 render(null, root); render(html`<${UpdateLogEntry} updateId="fixture-new-id" delay=${0} />`, root); await settle(); await settle();
 assert.ok(!root.querySelector('[role=dialog]'), 'memory fallback suppresses repeated popup');
 root.querySelector('[data-testid=update-log-open]').click(); await settle();
 assert.ok(root.querySelector('[role=dialog]'), 'manual reopening even when storage fails');
 render(null, root);
});
test('restoring/deep links/room/game/unwelcomed identity never open or mark seen, timer cancels on route change', async () => {
 const { UpdateLogEntry } = await import('../../public/js/ui/updateLog.js');
 let id = 0;
 for (const patch of [
  { ui: { restoring: true } }, { ui: { pendingJoin: 'ROOM' } },
  { room: { code: 'ROOM', inMatch: false } }, { room: { inMatch: true } },
  { match: { public: { phase: 'COMBAT' } } },
  { me: { playerId: null, name: 'fixture', token: null } },
  { me: { playerId: 'p', name: 'different', token: 'old-token' } },
 ]) {
  lobby(); store.set(patch); const updateId = `blocked-${++id}`;
  render(html`<${UpdateLogEntry} updateId=${updateId} delay=${0} />`, root); await settle(); await settle();
  assert.ok(!root.querySelector('[role=dialog]'));
  lobby(); await settle(); await settle();
  assert.ok(root.querySelector('[role=dialog]'), 'blocked route must not mark the ID seen');
  render(null, root);
 }
 lobby(); render(html`<${UpdateLogEntry} updateId="cancel-timer" delay=${180} />`, root); await settle();
 store.set({ room: { code: 'ROOM' } }); await new Promise(r => setTimeout(r, 250));
 assert.ok(!root.querySelector('[role=dialog]'), 'room reconnect during grace cancels popup');
 render(null, root);
});
test('persisted seen flag survives a fresh module/document memory and only lobby mounts the entry', async () => {
 const { readFileSync } = await import('node:fs');
 const { UpdateLogEntry } = await import('../../public/js/ui/updateLog.js?fresh-fixture');
 globalThis.localStorage = { getItem: () => '1', setItem() {} };
 lobby(); render(html`<${UpdateLogEntry} updateId="persisted-id" delay=${0} />`, root); await settle(); await settle();
 assert.ok(!root.querySelector('[role=dialog]'));
 root.querySelector('[data-testid=update-log-open]').click(); await settle();
 assert.ok(root.querySelector('[role=dialog]'));
 // Escape is the existing Modal dismissal path.
 const e = new window.Event('keydown'); e.key = 'Escape'; window.dispatchEvent(e); await settle();
 assert.ok(!root.querySelector('[role=dialog]'));
 render(null, root);
 assert.match(readFileSync(new URL('../../public/js/screens/lobby.js', import.meta.url), 'utf8'), /<\$\{UpdateLogEntry\}/);
 for (const file of ['main.js', 'screens/title.js', 'screens/room.js', 'screens/game.js']) assert.ok(!readFileSync(new URL('../../public/js/'+file, import.meta.url), 'utf8').includes('UpdateLogEntry'));
});
