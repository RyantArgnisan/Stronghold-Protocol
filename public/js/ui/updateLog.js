// Local deployment notice: update ID is independent of the upstream app version.
import { useEffect, useState } from '../../vendor/hooks.module.js';
import { html, Button, Modal } from './components.js';
import { useStore, store, selectRoute } from '../store.js';
import { net } from '../net.js';
import { t, N_ } from '../../../shared/i18n.js';

export const UPDATE_ID = 'local-2026-10-13-entry-log-1';
export const UPDATE_DATE = '2026-10-13';
const seen = new Set(); // storage denied: still show once per document
const NOTES = [
  N_('大厅新增更新日志入口；进入后自动展示，同一浏览器已看过本次更新后不再自动弹出。'),
  N_('主页新增统计数据入口，并显示在线真人与房间数量；房间和战斗中不显示此计数。'),
  N_('自动上传开关与启用时间保存在服务器；刷新可凭有效令牌恢复，换浏览器需验证原恢复密码。'),
  N_('自动上传默认关闭，仅追加启用后的新对局记录，不自动上传历史记录。'),
  N_('四个统计页可按需安全合并云端与本机记录，保留本机独有记录并去重。'),
];

function eligible(s) {
  return selectRoute(s) === 'lobby' && s.session.entered && s.connection.status === 'online'
    && s.me.playerId != null && !!s.me.token && !!s.me.name && net.helloName === s.me.name
    && !s.ui.restoring && !s.ui.pendingJoin;
}
function hasSeen(id) {
  if (seen.has(id)) return true;
  try { return globalThis.localStorage?.getItem(`sp.updateLog.seen.${id}`) === '1'; } catch { return false; }
}
function markSeen(id) {
  seen.add(id);
  try { globalThis.localStorage?.setItem(`sp.updateLog.seen.${id}`, '1'); } catch { /* optional browser storage */ }
}

/** Mounted only in LobbyScreen: never an app-wide overlay over a room or battle. */
export function UpdateLogEntry({ updateId = UPDATE_ID, delay = 1500 } = {}) {
  const ready = useStore(eligible);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!ready) { setOpen(false); return; }
    if (hasSeen(updateId)) return;
    // Let reconnect/deep-link room state settle before deciding this is the lobby.
    const timer = setTimeout(() => {
      if (!eligible(store.get()) || hasSeen(updateId)) return;
      markSeen(updateId);
      setOpen(true);
    }, delay);
    return () => clearTimeout(timer);
  }, [ready, updateId, delay]);
  return html`<${Button} data-testid="update-log-open" variant="secondary" size="sm" disabled=${!ready}
      onClick=${() => { if (eligible(store.get())) { markSeen(updateId); setOpen(true); } }}>${t('更新日志')}<//>
    <${Modal} open=${open && ready} title=${t('更新日志')} micro="LOCAL UPDATE" width="min(6.4rem, 94vw)"
      onClose=${() => setOpen(false)} actions=${html`<${Button} data-testid="update-log-close" variant="primary" onClick=${() => setOpen(false)}>${t('关闭')}<//>`}>
      <p class="t-lo">${UPDATE_DATE} · ${t('本地更新')} <span class="num">${updateId}</span></p>
      <p class="t-dim">${t('应用版本仍为 0.2.5-local.1；此编号仅标识本地更新，不是上游发行版本。')}</p>
      <ul style="padding-left:.22rem;line-height:1.8">${NOTES.map(note => html`<li key=${note}>${t(note)}</li>`)}</ul>
    <//>`;
}
