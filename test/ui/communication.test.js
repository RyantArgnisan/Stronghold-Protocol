import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ChatView } from '../../public/js/ui/chat.js';
import { emptyChat } from '../../public/js/ui/chatStore.js';
import { EmoteWheel } from '../../public/js/ui/emotes.js';
import { options } from '../../public/vendor/preact.module.js';

export function nodes(view, predicate = () => true) {
  const found = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (predicate(n)) found.push(n);
    for (const child of [n.props?.children].flat(Infinity)) walk(child);
  }
  walk(view); return found;
}
const state = (open = true, extra = {}) => ({ room: { code: 'ROOM', seats: [{ playerId: 'me', seat: 0 }], spectators: [] }, me: { playerId: 'me' }, connection: { status: 'online' }, match: { public: { phase: 'prep' } }, chat: { ...emptyChat('ROOM'), open, draft: '中文草稿' }, ...extra });

test('one communication entry opens one shared popover with text and embedded emote tabs', () => {
  const s = state();
  let next;
  const view = ChatView({ state: s, onTab: (tab) => { next = tab; } });
  const entries = nodes(view, (n) => n.type === 'button' && n.props['aria-expanded'] !== undefined);
  assert.equal(entries.length, 1);
  assert.match(entries[0].props.class, /ewheel__btn/);
  assert.equal(entries[0].props.disabled, undefined, 'emote cooldown cannot disable text entry');
  assert.equal(nodes(view, (n) => n.props?.role === 'dialog').length, 1);
  const tabs = nodes(view, (n) => n.props?.role === 'tab');
  assert.equal(tabs.length, 2);
  tabs[1].props.onClick(); assert.equal(next, 'emotes');
  const emoteView = ChatView({ state: { ...s, chat: { ...s.chat, tab: 'emotes' } } });
  assert.equal(nodes(emoteView, (n) => n.type === 'textarea').length, 0);
  const picker = nodes(emoteView, (n) => n.type === EmoteWheel)[0];
  assert.ok(picker, 'reuse the original pager');
  assert.equal(picker.props.embedded, true);
  assert.equal(nodes(ChatView({ state: state(false) }), (n) => n.props?.role === 'dialog').length, 0);
});

// Exercise the real hook component in Node, without a browser or DOM.
function hookView(fn, props) {
  const component = { props, __h: [], setState() {} };
  options.__r({ __c: component });
  return fn(props);
}

test('embedded picker has no second trigger/dialog, owns only local paging keys and closes on send', () => {
  const sent = [], toggles = [];
  const view = hookView(EmoteWheel, { embedded: true, open: true, onSend: (id) => sent.push(id), onToggle: (v) => toggles.push(v) });
  assert.equal(nodes(view, (n) => /ewheel__btn/.test(n.props?.class)).length, 0);
  assert.equal(nodes(view, (n) => n.props?.role === 'dialog').length, 0);
  assert.equal(typeof view.props.onKeyDown, 'function', 'embedded keys stay inside the picker');
  const items = nodes(view, (n) => n.props?.['data-emote']);
  assert.equal(items.length, 6);
  items[0].props.onClick();
  assert.equal(sent.length, 1);
  assert.deepEqual(toggles, [false]);
  items[1].props.onClick();
  assert.equal(sent.length, 1, 'one second cooldown is authoritative even before a rerender');
  const cooling = hookView(EmoteWheel, { embedded: true, open: true, onSend() {}, onToggle() {} });
  assert.ok(nodes(cooling, (n) => n.props?.['data-emote']).every((n) => n.props.disabled));
  assert.equal(nodes(ChatView({ state: state() }), (n) => n.props?.['aria-expanded'] !== undefined)[0].props.disabled, undefined);
});

test('switching tabs preserves drafts and unread until text is visible; lobby/spectator emotes never send', async () => {
  const chat = await import('../../public/js/ui/chat.js');
  const { createStore } = await import('../../public/js/store.js');
  const { mergeChat } = await import('../../public/js/ui/chatStore.js');
  assert.equal(typeof chat.selectCommunicationTab, 'function');
  assert.equal(typeof chat.sendCommunicationEmote, 'function');
  const s = createStore(state());
  chat.selectCommunicationTab(s, 'emotes');
  const incoming = { code: 'ROOM', id: 1, text: '看左边' };
  s.set({ chat: mergeChat(s.get().chat, incoming) });
  assert.equal(s.get().chat.unread, 1, 'hidden text is unread');
  chat.toggleChat(s, false); chat.toggleChat(s, true);
  assert.equal(s.get().chat.tab, 'text', 'reopening always offers readable history and text');
  assert.equal(s.get().chat.unread, 0);
  assert.equal(s.get().chat.draft, '中文草稿');
  const calls = [];
  const net = { status: 'online', request: async (...args) => calls.push(args) };
  assert.equal(await chat.sendCommunicationEmote({ store: s, net, id: 'autochess_battle_happy' }), true);
  assert.deepEqual(calls[0], ['g.emote', { id: 'autochess_battle_happy' }, { queue: false }]);
  for (const extra of [
    { match: { public: null } }, { match: { public: { phase: 'RESULT' } } },
    { connection: { status: 'offline' } },
    { room: { code: 'ROOM', seats: [], spectators: [{ playerId: 'me' }] } },
    { room: { code: 'ROOM', seats: [{ playerId: 'me' }], mutedPlayerIds: ['me'] } },
  ]) {
    const blocked = createStore(state(true, extra));
    assert.equal(await chat.sendCommunicationEmote({ store: blocked, net, id: 'autochess_battle_happy' }), false);
  }
  assert.equal(calls.length, 1);
  const lobby = state(true, { match: { public: null } });
  lobby.chat.tab = 'emotes';
  const view = ChatView({ state: lobby });
  assert.equal(nodes(view, (n) => n.type === EmoteWheel).length, 0);
  assert.ok(nodes(view, (n) => n.props?.role === 'status').some((n) => String(n.props.children).includes('仅对局')));
});

test('shared dismissal ignores internal pointer presses/IME, closes on outside or Escape and removes both listeners', async () => {
  const { installCommunicationDismissal } = await import('../../public/js/ui/chat.js');
  assert.equal(typeof installCommunicationDismissal, 'function');
  const listeners = new Map(), closes = [];
  const win = { addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: (name, fn) => { assert.equal(listeners.get(name), fn); listeners.delete(name); } };
  const inside = {}, outside = {};
  const composing = { current: false };
  let modal = false;
  const stop = installCommunicationDismissal({ root: { contains: (target) => target === inside }, win, composing, hasModal: () => modal, onClose: (restore) => closes.push(restore) });
  listeners.get('pointerdown')({ target: inside }); assert.deepEqual(closes, []);
  listeners.get('pointerdown')({ target: outside }); assert.deepEqual(closes, [false]);
  const esc = (extra = {}) => ({ key: 'Escape', preventDefault() {}, stopImmediatePropagation() {}, ...extra });
  for (const extra of [{ isComposing: true }, { keyCode: 229 }]) listeners.get('keydown')(esc(extra));
  composing.current = true; listeners.get('keydown')(esc()); composing.current = false;
  modal = true; listeners.get('keydown')(esc()); modal = false;
  assert.deepEqual(closes, [false]);
  listeners.get('keydown')(esc()); assert.deepEqual(closes, [false, true]);
  stop(); assert.equal(listeners.size, 0);
  const { readFileSync } = await import('node:fs');
  const source = readFileSync(new URL('../../public/js/ui/chat.js', import.meta.url), 'utf8');
  assert.match(source, /onEmote=\$\{.*sendCommunicationEmote/);
  assert.match(source, /onTab=\$\{.*selectCommunicationTab/);
  assert.match(source, /emoteUiSprite\('emoji_btn'\)/);
  const game = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.doesNotMatch(game, /EmoteWheel|emoteOpen|setEmoteOpen/);
  const css = readFileSync(new URL('../../public/css/chat.css', import.meta.url), 'utf8');
  assert.match(css, /\.chat \{[^}]*left:/);
  assert.match(css, /\.chat__body \{[^}]*position: absolute;[^}]*bottom: calc\(100%/);
  assert.match(css, /animation: emo-panel-in/);
  assert.match(css, /\.ewheel--embedded \.ewheel__panel/);
});
