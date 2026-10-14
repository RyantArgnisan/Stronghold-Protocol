// Targeted real Preact/DOM regression; no Chrome, no live server.
// SP_DOM_MODULE optionally points to an isolated linkedom install; otherwise use the dev dependency.
import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { parseHTML } = require(process.env.SP_DOM_MODULE || 'linkedom');
const { window, document } = parseHTML('<html><head></head><body></body></html>');
const globals = new Map(['window', 'document', 'Element', 'fetch'].map((key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
Object.assign(globalThis, { window, document, Element: window.Element });
globalThis.fetch = async (url) => ({ ok: true, json: async () => JSON.parse(readFileSync(new URL(`../../${String(url).replace(/^\//, '')}`, import.meta.url), 'utf8')) });
const { html } = await import('../../public/js/ui/components.js');
const { render } = await import('../../public/vendor/preact.module.js');
const { store, createStore } = await import('../../public/js/store.js');
const { ChatPanel } = await import('../../public/js/ui/chat.js');
const { TeamPanel } = await import('../../public/js/ui/teamPanel.js');
const { EMOTE_BUBBLE_MS } = await import('../../shared/constants.js');
const { emptyChat, installChatSync } = await import('../../public/js/ui/chatStore.js');
const { Net } = await import('../../public/js/net.js');
const { data } = await import('../../public/js/data.js');
const { GAME_FILES } = await import('../../public/js/ui/gameComponents.js');
// The profile-aware loader accepts one name per load(); await the whole fixture
// rather than relying on later hook effects to lazily populate art manifests.
await data.loadMany([...GAME_FILES, 'assets', 'local']);
const settle = () => new Promise((resolve) => setTimeout(resolve, 30));
const root = document.createElement('div'); document.body.appendChild(root);
after(() => {
  render(null, root); root.remove();
  for (const [key, descriptor] of globals) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  }
});
const seats = Array.from({ length: 8 }, (_, seat) => ({ playerId: `p${seat}`, seat, name: `博士${seat + 1}`, alive: true, status: 'acting' }));
const initial = (phase = 'PREP') => ({ session: { entered: true }, room: { code: 'ROOM', inMatch: true, seats, spectators: [] }, me: { playerId: 'p0' }, connection: { status: 'online' }, match: { public: { phase, players: seats }, result: null }, chat: emptyChat('ROOM'), emotes: [] });

test('real ChatPanel appears only on original battlefield screen phases, not room/briefing/draft/result', async (t) => {
  t.after(() => render(null, root));
  store.set(initial()); render(html`<${ChatPanel} />`, root); await settle();
  for (const phase of [null, 'INFO_CHECK', 'BAND_DRAFT', 'RESULT']) {
    store.set({ match: { public: phase ? { phase, players: seats } : null, result: null } }); await settle();
    assert.ok(!root.querySelector('.chat'), `must hide in ${phase || 'room'}`);
  }
  for (const phase of ['BATTLE_CHECK', 'ROUND_START', 'SP_DRAFT', 'PREP', 'COMBAT', 'UNITE', 'FINAL_ASSAULT', 'HIDDEN_CORE', 'SETTLE']) {
    store.set({ match: { public: { phase, players: seats }, result: null } }); await settle();
    assert.equal(root.querySelectorAll('.chat__toggle').length, 1, phase);
  }
  store.patch('chat', { open: true, draft: '保留中文草稿', tab: 'emotes' }); await settle();
  assert.equal(root.querySelectorAll('.chat__toggle').length, 1, 'unified popover keeps one communication entry');
  assert.equal(root.querySelectorAll('.ewheel--embedded').length, 1, 'reuse the original picker inside the emote tab');
  assert.ok(!root.querySelector('.chat__input'), 'text and emote tabs never duplicate content');
  store.patch('chat', { tab: 'text' }); await settle();
  assert.ok(root.querySelector('.chat__input'), 'switching back retains text access');
  assert.equal(store.get().chat.draft, '保留中文草稿', 'tab switches preserve draft');
  store.patch('match', { result: {} }); await settle();
  assert.ok(!root.querySelector('.chat'), 'result hides the battlefield entry');
  assert.equal(store.get().chat.draft, '保留中文草稿');
  render(null, root);
});

test('live Chinese text pops beside its sender avatar, stays plain text, expires and history never replays', async (t) => {
  t.after(() => render(null, root));
  store.set(initial());
  const net = new Net({ url: 'ws://localhost/ws' });
  const stop = installChatSync({ net, store });
  t.after(stop);
  render(html`<${TeamPanel} pub=${store.get().match.public} myId="p0" bubbles=${new Map()} onWatch=${() => {}} />`, root);
  await settle();
  const message = { code: 'ROOM', id: 1, playerId: 'p1', seat: 1, name: '博士2', text: '<img src=x> 我守左边', at: Date.now() - 60000 };
  net._emit('chat.message', message); await settle();
  const bubble = root.querySelector('.team__bubble--text');
  assert.ok(bubble, 'live chat must reach the avatar popover even with the chat panel closed');
  assert.equal(bubble.textContent, message.text);
  assert.ok(!bubble.querySelector('img'), 'never interpret chat as HTML');
  assert.equal(bubble.parentElement.querySelector('.team__seat').textContent, 'P2');
  const arrived = store.get().chat.messages[0].receivedAt;
  assert.ok(Number.isFinite(arrived), 'use local arrival time, not stale server timestamps');
  net._emit('chat.message', message); await settle();
  assert.equal(store.get().chat.messages[0].receivedAt, arrived, 'duplicate delivery never restarts the bubble');
  store.patch('chat', { messages: store.get().chat.messages.map((m) => ({ ...m, receivedAt: Date.now() - EMOTE_BUBBLE_MS - 1 })) }); await settle();
  assert.ok(!root.querySelector('.team__bubble--text'), 'expired text disappears');
  net._emit('chat.history', { code: 'ROOM', messages: [{ ...message, id: 2, at: Date.now() }], lastId: 2 }); await settle();
  assert.ok(!root.querySelector('.team__bubble--text'), 'reconnect history does not pop');
  stop(); render(null, root);
});

test('emote popup retains real art and arrival timeline; scrollable team reserves an unclipped communication lane', async (t) => {
  t.after(() => render(null, root));
  store.set(initial());
  const at = Date.now() - 1200;
  render(html`<${TeamPanel} pub=${store.get().match.public} myId="p0" bubbles=${new Map([['p7', { id: 'autochess_battle_happy', seq: 7, at }]])} onWatch=${() => {}} />`, root);
  await settle();
  const bubble = root.querySelector('.team__bubble[data-emote="autochess_battle_happy"]');
  assert.ok(bubble, 'eighth player receives the original picture popup');
  assert.ok(bubble.querySelector('img')?.getAttribute('src'), 'real manifest resolves emote art');
  assert.match(bubble.getAttribute('style'), /--ebubble-age:1\d{3}ms/, 'avatar rerenders resume rather than restart the popup');
  const css = readFileSync(new URL('../../public/css/screens/game.css', import.meta.url), 'utf8');
  assert.match(css, /padding-right:\s*min\(3\.5rem,\s*43vw\)/, 'reserve room for bubbles INSIDE the scrolling clip, not beyond its right edge');
  assert.match(css, /\.team__row\s*\{[^}]*width:\s*2\.5rem/, 'rows cannot stretch into the reserved bubble lane');
  render(null, root);
});
