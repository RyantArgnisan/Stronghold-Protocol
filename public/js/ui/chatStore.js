import { CHAT_HISTORY_LIMIT, EMOTE_BUBBLE_MS } from '../../../shared/constants.js';

// Room-scoped chat state. Transport subscriptions outlive route changes; never persisted to disk.
export const emptyChat = (code = null) => ({ code, messages: [], lastId: 0, unread: 0, open: false, tab: 'text', draft: '', error: null, sending: false });

export function chatMember(room, playerId) {
  return playerId != null && [...(Array.isArray(room?.seats) ? room.seats : []), ...(Array.isArray(room?.spectators) ? room.spectators : [])]
    .some((p) => p?.playerId === playerId);
}

export function mergeChat(chat, event, history = false) {
  if (!chat?.code || event?.code !== chat.code) return chat;
  const byId = new Map(chat.messages.map((m) => [m.id, m]));
  let unread = chat.unread;
  const incoming = history ? (Array.isArray(event.messages) ? event.messages : []) : [event];
  for (const m of incoming) {
    if (!m || !Number.isSafeInteger(m.id) || m.id <= 0 || typeof m.text !== 'string' || (m.code && m.code !== chat.code)) continue;
    if (byId.has(m.id)) continue;
    if (!history && (!chat.open || chat.tab === 'emotes') && m.id > chat.lastId) unread++;
    byId.set(m.id, { code: chat.code, id: m.id, playerId: m.playerId, name: typeof m.name === 'string' ? m.name : '',
      seat: m.seat, role: 'player', text: m.text, at: m.at, receivedAt: history ? null : Date.now() });
  }
  const messages = [...byId.values()].sort((a, b) => a.id - b.id).slice(-CHAT_HISTORY_LIMIT);
  const lastId = Math.max(chat.lastId, messages.at(-1)?.id || 0, history && Number.isSafeInteger(event.lastId) ? event.lastId : 0);
  return { ...chat, messages, lastId, unread };
}

/** Net emits real pushes; store.subscribe clears the slice even for local leave/kick/session reset. */
export function activeChatBubbles(messages, now, ttl = EMOTE_BUBBLE_MS) {
  const bubbles = new Map();
  for (const m of messages || []) {
    if (m.playerId && Number.isFinite(m.receivedAt) && now - m.receivedAt >= 0 && now - m.receivedAt < ttl) bubbles.set(m.playerId, m);
  }
  return bubbles;
}

export function installChatSync({ net, store }) {
  const syncRoom = () => {
    const s = store.get();
    const code = chatMember(s.room, s.me?.playerId) ? s.room.code : null;
    if (s.chat?.code !== code || !s.chat) store.set({ chat: emptyChat(code) });
  };
  syncRoom();
  const stops = [store.subscribe(syncRoom),
    net.on('chat.message', (event) => store.set((s) => ({ chat: mergeChat(s.chat, event) }))),
    net.on('chat.history', (event) => store.set((s) => ({ chat: mergeChat(s.chat, event, true) })))];
  return () => stops.forEach((stop) => stop());
}
