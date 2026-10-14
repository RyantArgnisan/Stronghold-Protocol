// Room-scoped, in-memory text chat. Identity and timestamps are exclusively server-authored.
import { CHAT_MAX_CHARS, CHAT_HISTORY_LIMIT } from '../shared/constants.js';

/** Strip C0/C1 controls, trim, then enforce both character and UTF-8 byte limits. Never truncate. */
export function cleanChatText(value) {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  if (!text || [...text].length > CHAT_MAX_CHARS || Buffer.byteLength(text, 'utf8') > 1024) return null;
  return text;
}

export class RoomChat {
  constructor() { this.lastId = 0; this.messages = []; this.sentIds = new WeakMap(); this.sendTimes = []; }

  /** Rolling room-wide window; at most ten entries are retained, even under member churn. */
  admit(at) {
    this.sendTimes = this.sendTimes.filter((time) => at - time < 1000);
    if (this.sendTimes.length >= 10) return false;
    this.sendTimes.push(at);
    return true;
  }

  seen(session, clientId) { return this.sentIds.get(session)?.has(clientId) === true; }

  remember(session, clientId) {
    let ids = this.sentIds.get(session);
    if (!ids) { ids = new Set(); this.sentIds.set(session, ids); }
    ids.add(clientId);
    if (ids.size > CHAT_HISTORY_LIMIT) ids.delete(ids.values().next().value);
  }

  message(room, seat, text, at) {
    const message = { t: 'chat.message', code: room.code, id: ++this.lastId, playerId: seat.playerId,
      name: seat.name, seat: seat.seat, role: 'player', text, at };
    this.messages.push(message);
    if (this.messages.length > CHAT_HISTORY_LIMIT) this.messages.shift();
    return message;
  }

  history(code) { return { t: 'chat.history', code, messages: this.messages.slice(), lastId: this.lastId }; }

  clear() { this.lastId = 0; this.messages = []; this.sentIds = new WeakMap(); this.sendTimes = []; }
}
