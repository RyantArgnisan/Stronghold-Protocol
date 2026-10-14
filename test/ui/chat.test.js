import { test } from 'node:test';
import assert from 'node:assert/strict';
import { shortcutFor } from '../../public/js/ui/gameLogic/shortcuts.js';

function nodes(view, predicate = () => true) {
  const found = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (predicate(n)) found.push(n);
    for (const child of [n.props?.children].flat(Infinity)) walk(child);
  }
  walk(view);
  return found;
}

test('chat retains only the newest 100 messages across interleaved history and live delivery', async () => {
  const { emptyChat, mergeChat } = await import('../../public/js/ui/chatStore.js');
  let chat = emptyChat('ROOM');
  const message = (id) => ({ code: 'ROOM', id, text: String(id) });
  chat = mergeChat(chat, { code: 'ROOM', messages: Array.from({ length: 130 }, (_, i) => message(i + 1)), lastId: 130 }, true);
  assert.equal(chat.messages.length, 100);
  assert.equal(chat.messages[0].id, 31);
  chat = mergeChat(chat, message(131));
  chat = mergeChat(chat, message(1));
  assert.equal(chat.messages.length, 100);
  assert.equal(chat.messages[0].id, 32);
  assert.equal(chat.messages.at(-1).id, 131);
});

test('chat view sends plain Chinese text through the room store with a unique clientId', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(new URL('../../public/js/ui/chat.js', import.meta.url)), 'usable chat component exists');
  const { ChatView, sendChat } = await import('../../public/js/ui/chat.js');
  const { emptyChat } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const state = createStore({ room: { code: 'AAAA', seats: [{ playerId: 'me', seat: 7, name: '博士' }] }, me: { playerId: 'me' }, connection: { status: 'online' }, chat: { ...emptyChat('AAAA'), open: true, draft: '  我守左边  ' } });
  const sent = [];
  const net = { status: 'online', request: async (type, fields) => { sent.push({ type, fields }); } };
  const view = ChatView({ state: state.get(), onSend: () => sendChat({ store: state, net }) });
  const form = nodes(view, (n) => n.type === 'form')[0];
  assert.ok(form, 'chat has an actual submit form');
  const input = nodes(view, (n) => n.type === 'textarea')[0];
  assert.equal(input.props.disabled, false);
  assert.equal(input.props.value, '  我守左边  ');
  await form.props.onSubmit({ preventDefault() {} });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'chat.send');
  assert.equal(sent[0].fields.text, '我守左边');
  assert.ok(typeof sent[0].fields.clientId === 'string' && sent[0].fields.clientId.length > 0);
  assert.equal(state.get().chat.draft, '');
  state.patch('chat', { draft: '你好' });
  await sendChat({ store: state, net });
  assert.notEqual(sent[0].fields.clientId, sent[1].fields.clientId);
});

test('chat disables spectator, muted and disconnected sending and validates Unicode without truncating', async () => {
  const { ChatView, sendChat } = await import('../../public/js/ui/chat.js');
  const { emptyChat } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const initial = () => ({ room: { code: 'AAAA', seats: [{ playerId: 'me' }], spectators: [], mutedPlayerIds: [] }, me: { playerId: 'me' }, connection: { status: 'online' }, chat: { ...emptyChat('AAAA'), open: true, draft: '你好' } });
  let calls = 0;
  const net = { status: 'online', request: async () => { calls++; } };
  for (const patch of [
    { connection: { status: 'reconnecting' } },
    { room: { code: 'AAAA', seats: [], spectators: [{ playerId: 'me' }] } },
    { room: { code: 'AAAA', seats: [{ playerId: 'me' }], mutedPlayerIds: ['me'] } },
    { room: null },
  ]) {
    const state = createStore({ ...initial(), ...patch });
    const view = ChatView({ state: state.get() });
    if (view) assert.equal(nodes(view, (n) => n.type === 'textarea')[0].props.disabled, true);
    assert.equal(await sendChat({ store: state, net }), false);
  }
  const state = createStore(initial());
  net.status = 'reconnecting';
  assert.equal(await sendChat({ store: state, net }), false, 'never queue offline chat');
  net.status = 'online';
  for (const draft of ['   ', '😀'.repeat(201)]) {
    state.patch('chat', { draft });
    assert.equal(await sendChat({ store: state, net }), false);
    assert.equal(state.get().chat.draft, draft);
  }
  assert.equal(calls, 0);
  state.patch('chat', { draft: '😀'.repeat(200) });
  assert.equal(await sendChat({ store: state, net }), true, '200 Unicode code points, not 200 UTF-16 units');
  assert.equal(calls, 1);
  const original = '请帮忙';
  state.patch('chat', { draft: original });
  net.request = async () => { throw { code: 'CHAT_MUTED' }; };
  assert.equal(await sendChat({ store: state, net }), false);
  assert.equal(state.get().chat.draft, original);
  assert.equal(state.get().chat.error.code, 'CHAT_MUTED');
  assert.equal(state.get().chat.sending, false);
});

test('folded chat shows unread; opening clears it and messages are text nodes with P8/name labels', async () => {
  const { ChatView, toggleChat } = await import('../../public/js/ui/chat.js');
  const { emptyChat } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const hostile = '<img src=x onerror=alert(1)> https://example.test';
  const state = createStore({ room: { code: 'AAAA', seats: [{ playerId: 'me' }] }, me: { playerId: 'me' }, connection: { status: 'online' }, chat: { ...emptyChat('AAAA'), unread: 3, messages: [{ id: 1, name: '<博士>', seat: 7, text: hostile }] } });
  let view = ChatView({ state: state.get(), onToggle: () => toggleChat(state) });
  assert.equal(nodes(view, (n) => n.type === 'textarea').length, 0, 'folded panel does not obstruct play');
  const button = nodes(view, (n) => n.props?.class?.split(' ').includes('chat__toggle'))[0];
  assert.equal(button.props['aria-expanded'], false);
  assert.ok(nodes(view, (n) => n.props?.class === 'chat__unread').length);
  button.props.onClick();
  assert.equal(state.get().chat.open, true);
  assert.equal(state.get().chat.unread, 0);
  view = ChatView({ state: state.get() });
  const message = nodes(view, (n) => n.props?.class === 'chat__text')[0];
  assert.equal(message.props.children, hostile);
  assert.ok(nodes(view, (n) => n.props?.children === 'P8').length);
  assert.ok(nodes(view, (n) => n.props?.children === '<博士>').length);
  assert.equal(nodes(view, (n) => n.type === 'a' || n.props?.dangerouslySetInnerHTML).length, 0);
});

test('chat input IME Enter confirms candidates; regular Enter sends and Escape folds', async () => {
  const { ChatView } = await import('../../public/js/ui/chat.js');
  const { emptyChat } = await import('../../public/js/ui/chatStore.js');
  let sends = 0, closes = 0, prevented = 0;
  const state = { room: { code: 'AAAA', seats: [{ playerId: 'me' }] }, me: { playerId: 'me' }, connection: { status: 'online' }, chat: { ...emptyChat('AAAA'), open: true, draft: '中文' } };
  const composing = { current: false };
  const view = ChatView({ state, composing, onSend: () => sends++, onToggle: () => closes++ });
  const input = nodes(view, (n) => n.type === 'textarea')[0];
  const event = (fields = {}) => ({ key: 'Enter', preventDefault: () => prevented++, stopPropagation() {}, ...fields });
  input.props.onCompositionStart();
  input.props.onKeyDown(event());
  input.props.onCompositionEnd();
  input.props.onKeyDown(event({ isComposing: true }));
  input.props.onKeyDown(event({ keyCode: 229 }));
  assert.equal(sends, 0);
  assert.equal(prevented, 0);
  input.props.onKeyDown(event());
  assert.equal(sends, 1);
  input.props.onKeyDown(event({ key: 'Escape' }));
  assert.equal(closes, 1);
  input.props.onKeyDown(event({ key: 'Tab' }));
  assert.equal(prevented, 2, 'Tab retains ordinary focus navigation');
});

test('battlefield owns the single ChatPanel while transport remains installed before connecting', async () => {
  const { readFileSync, existsSync } = await import('node:fs');
  const { ChatPanel } = await import('../../public/js/ui/chat.js');
  const { initialState } = await import('../../public/js/store.js');
  assert.equal(typeof ChatPanel, 'function', 'hook-backed ChatPanel exists');
  assert.equal(initialState.chat.code, null, 'chat is part of initial app state');
  const main = readFileSync(new URL('../../public/js/main.js', import.meta.url), 'utf8');
  assert.equal((main.match(/<\$\{ChatPanel\}/g) || []).length, 0, 'no premature app-level entry');
  const game = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.equal((game.match(/<\$\{ChatPanel\}/g) || []).length, 1, 'one battlefield-only entry');
  assert.match(game, /else body = html`<\$\{MatchScreen\} \/><\$\{ChatPanel\} \/>`/);
  assert.ok(main.indexOf('installChatSync({ net, store })') < main.indexOf('net.attachBrowserHooks()'));
  for (const file of ['screens/room.js', 'screens/bandDraft.js', 'screens/result.js']) {
    assert.ok(!readFileSync(new URL(`../../public/js/${file}`, import.meta.url), 'utf8').includes('<${ChatPanel}'));
  }
  assert.ok(existsSync(new URL('../../public/css/chat.css', import.meta.url)), 'real chat CSS exists');
  const index = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
  assert.ok(index.includes('href="/css/chat.css"'), 'chat stylesheet is loaded by actual entry');
});

test('host moderation has explicit mute/unmute controls for every human seat and server-error feedback', async () => {
  const { ChatView, muteChat } = await import('../../public/js/ui/chat.js');
  const { emptyChat } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const room = { code: 'AAAA', hostId: 'me', seats: [{ playerId: 'me', seat: 0, name: 'Host' }, { playerId: 'p7', seat: 7, name: '八号' }, { playerId: 'bot', seat: 1, isBot: true }], mutedPlayerIds: ['p7'] };
  const state = createStore({ room, me: { playerId: 'me' }, connection: { status: 'online' }, chat: { ...emptyChat('AAAA'), open: true } });
  const sent = [];
  const net = { status: 'online', request: async (type, fields) => sent.push({ type, fields }) };
  let view = ChatView({ state: state.get(), onMute: (playerId, on) => muteChat({ store: state, net, playerId, on }) });
  const controls = nodes(view, (n) => n.props?.class === 'chat__mute');
  assert.equal(controls.length, 2, 'no bot or spectator moderation');
  await controls.find((n) => n.props['data-player-id'] === 'p7').props.onClick();
  assert.deepEqual(sent, [{ type: 'room.chatMute', fields: { playerId: 'p7', on: false } }]);
  assert.deepEqual(state.get().room.mutedPlayerIds, ['p7'], 'only authoritative room state changes mute status');
  state.set({ me: { playerId: 'p7' } });
  view = ChatView({ state: state.get() });
  assert.equal(nodes(view, (n) => n.props?.class === 'chat__mute').length, 0, 'non-host has no moderation');
  assert.equal(await muteChat({ store: state, net, playerId: 'me', on: true }), false);
  state.set({ me: { playerId: 'me' } });
  net.request = async () => { throw { code: 'NOT_HOST' }; };
  assert.equal(await muteChat({ store: state, net, playerId: 'p7', on: true }), false);
  assert.equal(state.get().chat.error.code, 'NOT_HOST');
});

test('chat and capacity UI strings have proper translations in every shipped language pack', async () => {
  const { readFileSync, readdirSync } = await import('node:fs');
  const source = readFileSync(new URL('../../public/js/ui/chat.js', import.meta.url), 'utf8');
  const keys = [...new Set([...source.matchAll(/\bt\('([^']+)'/g)].map((m) => m[1]))];
  keys.push('同盟容量', '{n} 名博士', '你已被房主禁言');
  for (const file of readdirSync(new URL('../../public/i18n/', import.meta.url)).filter((f) => f.endsWith('.json'))) {
    const pack = JSON.parse(readFileSync(new URL(`../../public/i18n/${file}`, import.meta.url), 'utf8'));
    for (const key of keys) assert.ok(typeof pack[key] === 'string' && pack[key].length > 0, `${file}: ${key}`);
  }
});

test('modal input Tab/Escape retain focus trapping and dismissal while chat controls own their keyboard', async () => {
  const keyboard = await import('../../public/js/ui/keyboard.js');
  const { readFileSync } = await import('node:fs');
  assert.equal(typeof keyboard.isDialogTypingEvent, 'function');
  for (const tagName of ['INPUT', 'TEXTAREA', 'BUTTON']) {
    assert.equal(keyboard.isDialogTypingEvent({ key: 'Tab', target: { tagName } }), false);
    assert.equal(keyboard.isDialogTypingEvent({ key: 'Escape', target: { tagName } }), false);
  }
  assert.equal(keyboard.isDialogTypingEvent({ key: 'Escape', isComposing: true }), true);
  assert.equal(keyboard.isDialogTypingEvent({ key: 'Escape', keyCode: 229 }), true);
  assert.equal(keyboard.isDialogTypingEvent({ key: 'r', target: { tagName: 'INPUT' } }), true);
  const chatButton = { tagName: 'BUTTON', closest: (sel) => sel === '.chat' ? {} : null };
  assert.equal(shortcutFor({ key: 'r', target: chatButton }), null);
  assert.equal(shortcutFor({ key: 'Escape', target: chatButton }), null);
  const source = readFileSync(new URL('../../public/js/ui/components.js', import.meta.url), 'utf8');
  assert.match(source, /const onKey = \(e\) => \{\s*if \(isDialogTypingEvent\(e\)\) return;/);
});

test('chat overlay stays below modal dialogs with scrollable moderation and responsive bounds', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../public/css/chat.css', import.meta.url), 'utf8');
  assert.match(css, /z-index: 65/);
  assert.match(css, /chat__moderation/);
  assert.match(css, /max-height: 120px; overflow-y: auto/);
  assert.match(css, /max-width: 700px/);
  assert.match(css, /overscroll-behavior: contain/);
});

test('late send acknowledgements cannot clear a newer draft or a rejoined room pending send', async () => {
  const { sendChat } = await import('../../public/js/ui/chat.js');
  const { emptyChat, installChatSync } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const { Net } = await import('../../public/js/net.js');
  const room = { code: 'AAAA', seats: [{ playerId: 'me' }] };
  const state = createStore({ room, me: { playerId: 'me' }, connection: { status: 'online' } });
  const syncNet = new Net();
  const stop = installChatSync({ store: state, net: syncNet });
  const resolve = [];
  const net = { status: 'online', request: () => new Promise((r) => resolve.push(r)) };
  state.patch('chat', { draft: '第一条' });
  const first = sendChat({ store: state, net });
  assert.equal(await sendChat({ store: state, net }), false, 'prevent double-send while pending');
  state.set({ room: null });
  state.set({ room });
  state.patch('chat', { draft: '重新加入后' });
  const second = sendChat({ store: state, net });
  assert.equal(state.get().chat.sending, true);
  resolve[0](); await first;
  assert.equal(state.get().chat.draft, '重新加入后');
  assert.equal(state.get().chat.sending, true, 'old room ack cannot finish current request');
  state.patch('chat', { draft: '继续输入' });
  resolve[1](); await second;
  assert.equal(state.get().chat.draft, '继续输入', 'typing during a send never loses new text');
  assert.equal(state.get().chat.sending, false);
  state.set({ chat: emptyChat(), room: null });
  stop();
});

test('chat transport fails fast offline instead of queuing text for a later reconnect', async () => {
  const { Net } = await import('../../public/js/net.js');
  const net = new Net();
  net.name = 'Doctor';
  net.status = 'reconnecting';
  const fields = { clientId: 'offline-chat', text: '不要延迟发送' };
  const error = await net.request('chat.send', fields, { queue: false, timeout: 1 }).catch((err) => err);
  assert.equal(error.code, 'OFFLINE');
  assert.equal(net._pending.size, 0);
  net.status = 'online';
  const broken = await net.request('chat.send', fields, { queue: false, timeout: 1 }).catch((err) => err);
  assert.equal(broken.code, 'OFFLINE', 'a dead send socket never leaves unsent chat in the reconnect queue');
  assert.equal(net._pending.size, 0);
});

test('late moderation acknowledgement cannot affect a rejoined room operation', async () => {
  const { muteChat } = await import('../../public/js/ui/chat.js');
  const { installChatSync } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const { Net } = await import('../../public/js/net.js');
  const room = { code: 'AAAA', hostId: 'me', seats: [{ playerId: 'me' }, { playerId: 'p7' }] };
  const state = createStore({ room, me: { playerId: 'me' }, connection: { status: 'online' } });
  const stop = installChatSync({ store: state, net: new Net() });
  const resolve = [];
  const net = { status: 'online', request: () => new Promise((r) => resolve.push(r)) };
  const first = muteChat({ store: state, net, playerId: 'p7', on: true });
  state.set({ room: null }); state.set({ room });
  const second = muteChat({ store: state, net, playerId: 'p7', on: false });
  resolve[0](); await first;
  assert.equal(state.get().chat.muteBusy, 'p7');
  assert.equal(state.get().chat.notice, null);
  resolve[1](); await second;
  assert.equal(state.get().chat.muteBusy, null);
  stop();
});

test('typing and IME events never trigger gameplay shortcuts, including nested editable content', () => {
  for (const key of ['r', 'f', 'd', 'q', 'x', ' ', 'Escape']) {
    for (const target of [{ tagName: 'INPUT' }, { tagName: 'TEXTAREA' }, { isContentEditable: true }, { tagName: 'SPAN', closest: () => ({ isContentEditable: true }) }]) {
      assert.equal(shortcutFor({ key, target }), null);
    }
    assert.equal(shortcutFor({ key, isComposing: true }), null);
    assert.equal(shortcutFor({ key, keyCode: 229 }), null);
  }
});

test('all app/game capture and bubble keyboard handlers guard text and IME before acting', async () => {
  const { readFileSync } = await import('node:fs');
  const files = ['screens/game.js', 'screens/loadout.js', 'screens/diy.js', 'screens/stats.js', 'ui/choiceOverlay.js', 'ui/facingWheel.js', 'ui/shopBar.js', 'ui/emotes.js', 'ui/guide.js', 'ui/settings.js'];
  for (const file of files) {
    const source = readFileSync(new URL(`../../public/js/${file}`, import.meta.url), 'utf8');
    assert.match(source, /const onKey = (?:async )?\(e\) => \{\s*if \(isTypingEvent\(e\)\) return;/, file);
  }
});

test('one chat store merges overlapping history/live pushes by room and id; room changes clear all local chat state', async () => {
  const { existsSync } = await import('node:fs');
  assert.ok(existsSync(new URL('../../public/js/ui/chatStore.js', import.meta.url)), 'reusable chat store exists');
  const { installChatSync } = await import('../../public/js/ui/chatStore.js');
  const { createStore } = await import('../../public/js/store.js');
  const { Net } = await import('../../public/js/net.js');
  const net = new Net();
  const room = { code: 'AAAA', seats: [{ playerId: 'me' }] };
  const state = createStore({ room, me: { playerId: 'me' } });
  const stop = installChatSync({ net, store: state });
  const message = (id, code = 'AAAA') => ({ code, id, playerId: 'them', name: '博士', seat: 7, role: 'player', text: `消息${id}`, at: id });
  net._emit('chat.message', message(3));
  net._emit('chat.history', { code: 'AAAA', messages: [message(1), message(2), message(3)], lastId: 3 });
  net._emit('chat.message', message(4));
  net._emit('chat.message', message(4));
  net._emit('chat.message', message(5, 'BBBB'));
  assert.deepEqual(state.get().chat.messages.map((m) => m.id), [1, 2, 3, 4]);
  assert.equal(state.get().chat.unread, 2, 'history and duplicate pushes do not add unread');
  state.patch('chat', { open: true, draft: 'old draft', error: 'old error' });
  state.set({ room: { ...room, code: 'BBBB' } });
  assert.equal(state.get().chat.code, 'BBBB');
  assert.deepEqual(state.get().chat.messages, []);
  assert.equal(state.get().chat.open, false);
  assert.equal(state.get().chat.draft, '');
  assert.equal(state.get().chat.error, null);
  state.set({ room: null });
  net._emit('chat.message', message(6, 'BBBB'));
  assert.equal(state.get().chat.code, null);
  assert.deepEqual(state.get().chat.messages, []);
  stop();
});
