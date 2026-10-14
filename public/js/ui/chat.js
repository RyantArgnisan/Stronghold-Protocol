// One room-scoped plain-text chat view, independent of the current match phase.
import { html } from './components.js';
import { t } from '../../../shared/i18n.js';
import { CHAT_MAX_CHARS, CHAT_HISTORY_LIMIT, MAX_SEATS, PHASE, emoteInfo } from '../../../shared/constants.js';
import { describeError } from './toasts.js';
import { chatMember } from './chatStore.js';
import { seatHue } from './seatColors.js';
import { useLayoutEffect, useRef } from '../../vendor/hooks.module.js';
import { store, useStore, shallowEqual } from '../store.js';
import { net } from '../net.js';
import { EmoteWheel, emoteUiSprite } from './emotes.js';
import { GIcon } from './gameComponents.js';
import { useData } from '../data.js';
import { phaseMode } from './gameLogic/phases.js';

export function chatFacts(state) {
  const { room, chat, me, connection } = state;
  const member = chat?.code === room?.code && chatMember(room, me?.playerId);
  const seated = member && (room.seats || []).some((p) => p?.playerId === me?.playerId);
  const muted = (room?.mutedPlayerIds || []).includes(me?.playerId);
  const online = connection?.status === 'online';
  const reason = !online ? t('连接断开，聊天暂不可用') : !seated ? t('观战者只能阅读聊天') : muted ? t('你已被禁言') : null;
  return { member, seated, muted, online, reason, canSend: !!seated && online && !muted };
}

let messageSeq = 0;

export async function sendChat({ store, net }) {
  const s = store.get();
  const code = s.chat?.code;
  if (!code || s.chat.sending || !chatFacts(s).canSend || net.status !== 'online') return false;
  const draft = s.chat.draft;
  // Match the authoritative server's control cleanup; never silently truncate long drafts.
  const text = draft.replace(/[\u0000-\u001f\u007f-\u009f]/gu, '').trim();
  if (!text) return false;
  if ([...text].length > CHAT_MAX_CHARS) {
    store.patch('chat', { error: { message: t('消息最多 {n} 字', { n: CHAT_MAX_CHARS }) } });
    return false;
  }
  const clientId = `chat-${Date.now().toString(36)}-${++messageSeq}`;
  const current = () => store.get().chat?.code === code && store.get().chat?.sendToken === clientId;
  store.patch('chat', { sending: true, sendToken: clientId, error: null });
  try {
    await net.request('chat.send', { clientId, text }, { queue: false });
    if (current()) store.patch('chat', { draft: store.get().chat.draft === draft ? '' : store.get().chat.draft });
    return true;
  } catch (error) {
    if (current()) store.patch('chat', { error });
    return false;
  } finally {
    if (current()) store.patch('chat', { sending: false, sendToken: null });
  }
}

export async function muteChat({ store, net, playerId, on }) {
  const s = store.get();
  const code = s.chat?.code;
  if (!chatFacts(s).member || s.room.hostId !== s.me.playerId || !chatFacts(s).online || net.status !== 'online' || s.chat.muteBusy) return false;
  if (!(s.room.seats || []).some((p) => p?.playerId === playerId && !p.isBot) || typeof on !== 'boolean') return false;
  const muteToken = ++messageSeq;
  const current = () => store.get().chat?.code === code && store.get().chat?.muteToken === muteToken;
  store.patch('chat', { muteBusy: playerId, muteToken, error: null, notice: null });
  try {
    await net.request('room.chatMute', { playerId, on }, { queue: false });
    if (current()) store.patch('chat', { notice: on ? t('已禁言该玩家') : t('已解除该玩家禁言') });
    return true;
  } catch (error) {
    if (current()) store.patch('chat', { error });
    return false;
  } finally {
    if (current()) store.patch('chat', { muteBusy: null, muteToken: null });
  }
}

export function toggleChat(store, open = !store.get().chat?.open) {
  if (store.get().chat?.code) store.patch('chat', { open, ...(open ? { tab: 'text', unread: 0 } : {}) });
}

export function selectCommunicationTab(store, tab) {
  if (store.get().chat?.code && (tab === 'text' || tab === 'emotes')) {
    store.patch('chat', { tab, ...(tab === 'text' ? { unread: 0 } : {}) });
  }
}

export const communicationInMatch = (state) => !!state.match?.public && state.match.public.phase !== PHASE.RESULT && !state.match.result;
export const communicationOnBattlefield = (state) => communicationInMatch(state) && !['loading', 'briefing', 'draft', 'result'].includes(phaseMode(state.match.public.phase));

export async function sendCommunicationEmote({ store, net, id }) {
  const state = store.get();
  if (!communicationInMatch(state) || !chatFacts(state).canSend || net.status !== 'online' || !emoteInfo(id)) return false;
  const code = state.chat?.code;
  try {
    await net.request('g.emote', { id }, { queue: false });
    return true;
  } catch (error) {
    if (store.get().chat?.code === code) store.patch('chat', { error });
    return false;
  }
}

/** Presentational view is shared by the real app and pure UI tests. */
export function ChatView({ state, onSend, onDraft, onToggle, onMute, onTab, onEmote, buttonSprite, composing = { current: false }, inputRef, logRef, toggleRef, panelRef }) {
  const chat = state.chat;
  const facts = chatFacts(state);
  if (!chat?.code || !facts.member) return null;
  const tab = chat.tab === 'emotes' ? 'emotes' : 'text';
  const count = [...chat.draft].length;
  const inputKey = (e) => {
    if (composing.current || e.isComposing || e.keyCode === 229) return;
    if (e.key === 'Escape') {
      e.preventDefault(); e.stopPropagation(); onToggle?.(false);
    } else if (e.key === 'Enter' && !e.shiftKey && !e.ctrlKey && !e.altKey && !e.metaKey) {
      e.preventDefault(); e.stopPropagation(); onSend?.();
    }
  };
  return html`<aside ref=${panelRef} class=${`chat${chat.open ? ' is-open' : ''}`} aria-label=${t('交流')}
      onKeyDown=${(e) => { if (e.key === 'Escape' && !composing.current && !e.isComposing && e.keyCode !== 229) { e.preventDefault(); e.stopPropagation(); onToggle?.(false); } }}>
    <button type="button" ref=${toggleRef} class=${`chat__toggle ewheel__btn${buttonSprite ? ' has-sprite' : ''}${chat.open ? ' is-on' : ''}`}
      style=${buttonSprite ? `--ewheel-btn:url("${buttonSprite}")` : ''} aria-expanded=${chat.open} aria-haspopup="dialog" aria-controls="room-chat-body" onClick=${() => onToggle?.(!chat.open)}>
      ${buttonSprite ? null : html`<${GIcon} name="emote" />`}<span class="ewheel__label">${t('交流')}</span>
      ${chat.unread > 0 ? html`<span class="chat__unread">${t('{n} 条未读', { n: chat.unread })}</span>` : null}
    </button>
    ${chat.open ? html`<div id="room-chat-body" class="chat__body" role="dialog" aria-label=${t('交流')}>
      <header class="chat__head"><span>${t('交流')}</span>
        <button type="button" class="chat__close" aria-label=${t('收起聊天')} onClick=${() => onToggle?.(false)}>${t('收起聊天')}</button>
      </header>
      <div class="chat__tabs" role="tablist" aria-label=${t('交流')}>
        <button id="communication-text-tab" type="button" role="tab" aria-selected=${tab === 'text'} aria-controls="communication-text" onClick=${() => onTab?.('text')}>${t('同盟聊天')}${chat.unread > 0 ? ` (${chat.unread})` : ''}</button>
        <button id="communication-emotes-tab" type="button" role="tab" aria-selected=${tab === 'emotes'} aria-controls="communication-emotes" onClick=${() => onTab?.('emotes')}>${t('表情')}</button>
      </div>
      ${tab === 'emotes' ? html`<div id="communication-emotes" class="chat__emotes" role="tabpanel" aria-labelledby="communication-emotes-tab">
        ${!communicationInMatch(state) ? html`<p class="chat__notice" role="status">${t('表情仅对局中可用')}</p>` : html`
          ${facts.reason ? html`<p class="chat__notice" role="status">${facts.reason}</p>` : null}
          <${EmoteWheel} embedded=${true} open=${true} onToggle=${onToggle} onSend=${onEmote} disabled=${!facts.canSend} />`}
        ${chat.error ? html`<p class="chat__error" role="alert">${describeError(chat.error)}</p>` : null}
      </div>` : html`<div id="communication-text" class="chat__text-panel" role="tabpanel" aria-labelledby="communication-text-tab">
      <p class="chat__notice">${t('最近 {n} 条消息', { n: CHAT_HISTORY_LIMIT })}</p>
      <ol class="chat__log" ref=${logRef} role="log" aria-live="polite" aria-relevant="additions" aria-label=${t('聊天记录')}>
        ${chat.messages.map((m) => html`<li key=${m.id} class="chat__message" style=${`--seat-hue:${seatHue(m.seat)}`}>
          <span class="chat__seat">${Number.isInteger(m.seat) && m.seat >= 0 && m.seat < MAX_SEATS ? `P${m.seat + 1}` : ''}</span>
          <span class="chat__name" title=${m.name}>${m.name}</span><span class="chat__text">${m.text}</span>
        </li>`)}
        ${chat.messages.length ? null : html`<li class="chat__empty">${t('暂无消息')}</li>`}
      </ol>
      ${facts.reason ? html`<p class="chat__notice" role="status">${facts.reason}</p>` : null}
      ${chat.error ? html`<p class="chat__error" role="alert">${describeError(chat.error)}</p>` : null}
      ${chat.notice ? html`<p class="chat__notice" role="status">${chat.notice}</p>` : null}
      ${state.room.hostId === state.me.playerId ? html`<details class="chat__moderation"><summary>${t('聊天管理')}</summary>
        <ul>${state.room.seats.filter((p) => p && !p.isBot).map((p) => {
          const muted = (state.room.mutedPlayerIds || []).includes(p.playerId);
          return html`<li key=${p.playerId}><span class="chat__name" title=${p.name}>${`P${p.seat + 1}`} ${p.name}</span>
            <button type="button" class="chat__mute" data-player-id=${p.playerId} disabled=${!facts.online || !!chat.muteBusy}
              aria-label=${muted ? t('解除 {name} 的禁言', { name: p.name }) : t('禁言 {name}', { name: p.name })}
              onClick=${() => onMute?.(p.playerId, !muted)}>${muted ? t('解除禁言') : t('禁言')}</button></li>`;
        })}</ul>
      </details>` : null}
      <form class="chat__form" onSubmit=${(e) => { e.preventDefault(); if (!composing.current) return onSend?.(); }}>
        <textarea ref=${inputRef} class="chat__input" aria-label=${t('聊天消息')} aria-describedby="room-chat-hint" value=${chat.draft} disabled=${!facts.canSend}
          rows="2" placeholder=${t('输入消息，Enter 发送')} onInput=${(e) => onDraft?.(e.currentTarget.value)} onKeyDown=${inputKey}
          onCompositionStart=${() => { composing.current = true; }} onCompositionEnd=${() => { composing.current = false; }} />
        <button type="submit" disabled=${!facts.canSend || chat.sending || !chat.draft.trim() || count > CHAT_MAX_CHARS}>${t('发送')}</button>
        <span id="room-chat-hint" class=${`chat__hint${count > CHAT_MAX_CHARS ? ' is-invalid' : ''}`}>${t('{n}/{max} 字 · Esc 收起', { n: count, max: CHAT_MAX_CHARS })}</span>
      </form>
      </div>`}
    </div>` : null}
  </aside>`;
}

/** One owner for the entire non-modal popover, including embedded emote controls. */
export function installCommunicationDismissal({ root, win = globalThis.window, composing, onClose, hasModal = () => !!globalThis.document?.querySelector('.modal') }) {
  const onDown = (e) => { if (!root?.contains(e.target)) onClose(false); };
  const onKey = (e) => {
    if (e.key !== 'Escape' || composing?.current || e.isComposing || e.keyCode === 229 || hasModal()) return;
    e.preventDefault(); e.stopImmediatePropagation(); onClose(true);
  };
  win.addEventListener('pointerdown', onDown, true);
  win.addEventListener('keydown', onKey, true);
  return () => { win.removeEventListener('pointerdown', onDown, true); win.removeEventListener('keydown', onKey, true); };
}

/** Mounted once by App; route changes never tear down its room history or draft. */
export function ChatPanel() {
  const state = useStore((s) => ({ chat: s.chat, room: s.room, me: s.me, connection: s.connection, match: s.match }), shallowEqual);
  useData('local');
  const composing = useRef(false);
  const inputRef = useRef(null), logRef = useRef(null), toggleRef = useRef(null), panelRef = useRef(null);
  const code = state.chat?.code, open = state.chat?.open, tab = state.chat?.tab;
  useLayoutEffect(() => { composing.current = false; }, [code]);
  useLayoutEffect(() => {
    if (!open) return;
    if (tab !== 'emotes' && inputRef.current && !inputRef.current.disabled) inputRef.current.focus();
    else panelRef.current?.querySelector(tab === 'emotes' ? '.chat__emotes button:not(:disabled), #communication-emotes-tab' : '#communication-text-tab')?.focus();
  }, [code, open, tab]);
  useLayoutEffect(() => {
    const log = logRef.current;
    if (open && log) log.scrollTop = log.scrollHeight;
  }, [code, open, tab, state.chat?.lastId]);
  useLayoutEffect(() => {
    if (!open || !code) return undefined;
    return installCommunicationDismissal({ root: panelRef.current, composing, onClose: (restore) => {
      toggleChat(store, false);
      if (restore) toggleRef.current?.focus();
    } });
  }, [code, open]);
  const toggle = (value) => {
    toggleChat(store, value);
    if (!value) toggleRef.current?.focus();
  };
  if (!communicationOnBattlefield(state)) return null;
  return html`<${ChatView} state=${state} composing=${composing} inputRef=${inputRef} logRef=${logRef} toggleRef=${toggleRef} panelRef=${panelRef} buttonSprite=${emoteUiSprite('emoji_btn')}
    onTab=${(tab) => selectCommunicationTab(store, tab)} onEmote=${(id) => sendCommunicationEmote({ store, net, id })}
    onToggle=${toggle} onDraft=${(draft) => store.patch('chat', { draft, error: null })}
    onSend=${() => sendChat({ store, net })} onMute=${(playerId, on) => muteChat({ store, net, playerId, on })} />`;
}

