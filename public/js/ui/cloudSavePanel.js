import { useRef, useState } from '../../vendor/hooks.module.js';
import { html, Button, confirmDialog } from './components.js';
import { store, useStore } from '../store.js';
import { loadoutStore } from './loadoutSync.js';
import { parseStored, parseStoredOps } from './loadoutModel.js';
import { parseStoredSkins } from './skins.js';
import { autoCloudUpload } from './autoCloudSave.js';
import { snapshotCloudSave, requestCloudSave, restoreCloudSave } from './cloudSave.js';
import { t, N_ } from '../../../shared/i18n.js';

const autoStatuses = {
  off: N_('自动上传已关闭。'),
  ready: N_('自动上传已授权，等待新对局记录。'),
  uploading: N_('正在自动上传新对局记录…'),
  retry: N_('自动上传暂未成功，将有限次数重试；本机记录不变。'),
  error: N_('自动上传已暂停，请核对后重新授权；本机记录不变。'),
};
const errors = {
  QUEUE: N_('自动上传等待队列已满，请手动上传或重新授权；本机记录不变。'),
  AUTH: N_('玩家名或恢复密码错误；同名存档不能覆盖，请核对进入游戏时的玩家名及原恢复密码。'),
  IDENTITY: N_('请先使用玩家名进入游戏，再上传或恢复服务器存档。'),
  PASSWORD: N_('恢复密码须为8–128字，请检查长度。'),
  RATE: N_('操作过于频繁，请一分钟后重试。'),
  INVALID: N_('数据格式或输入无效：玩家名1–24字，恢复密码8–128字，至少选择一项。'),
  STORAGE: N_('服务器写入或读取失败，存档未确认成功，请稍后重试。'),
  TOO_LARGE: N_('存档超过服务器容量限制，未上传。'),
  MISSING_GROUP: N_('服务器存档没有所选数据，请调整勾选项。'),
  LOCAL_BACKUP: N_('无法保存恢复前的本机备份，可能存储已满；未替换本机数据。'),
  LOCAL_WRITE: N_('本机写入失败，已还原原数据；请清理存储后重试。'),
  LOCAL_ROLLBACK: N_('本机写入及回退失败；恢复前数据保留在sp.cloud.backup.latest，请勿清除浏览器存储。'),
  NETWORK: N_('连接服务器失败或超时；请核对网络，上传结果不确定时可重新恢复检查。'),
};

export function CloudSaveView({ name, passwordRef, selection, onSelection, status, busy, locked, onAction, auto = { enabled: false, status: 'off' }, onAutoChange }) {
  return html`<section class="st-sec" data-testid="cloud-save-panel">
    <h3>${t('服务器存档')}</h3>
    <p>${t('默认不自动上传。手动上传与恢复可选择统计及干员调配；自动上传仅追加启用后新记录的对局，不含历史记录或干员设置。')}</p>
    <p>${t('存档玩家名固定使用进入游戏时的玩家名，不能在此修改。恢复密码为8–128字；首次上传设置密码，同名更新必须使用原密码，忘记密码无法恢复。')}</p>
    <p class="is-warn">${t('当前HTTP连接不加密；请使用专用恢复密码，切勿复用其他网站密码。')}</p>
    <div style="display:flex;flex-wrap:wrap;gap:16px;margin:16px 0">
      <label>${t('存档玩家名')} <input type="text" maxlength="24" value=${name} readOnly=${true} /></label>
      <label>${t('恢复密码')} <input ref=${passwordRef} type="password" minlength="8" maxlength="128" autocomplete="off" disabled=${busy} /></label>
    </div>
    <div style="display:flex;flex-wrap:wrap;gap:16px;margin:16px 0">
      <label><input type="checkbox" checked=${selection.stats} disabled=${busy} onChange=${(e) => onSelection?.({ ...selection, stats: e.currentTarget.checked })} /> ${t('统计（总览、策略、战斗累计、对局记录）')}</label>
      <label><input type="checkbox" checked=${selection.operators} disabled=${busy} onChange=${(e) => onSelection?.({ ...selection, operators: e.currentTarget.checked })} /> ${t('干员调配（技能与皮肤等）')}</label>
    </div>
    <label><input type="checkbox" data-cloud-auto="true" checked=${auto.enabled} disabled=${busy && !auto.enabled} onChange=${e => onAutoChange?.(e.currentTarget.checked)} /> ${t('自动上传新对局记录')}</label>
    <p>${t('需已有服务器存档并验证原恢复密码。刷新可用本机授权令牌恢复，换浏览器须验证原密码；仅凭同名不能读取。密码不保存，退出或换身份会撤销本机授权。查看四个统计页会合并云记录，未上传记录仍在本机。')}</p>
    ${auto.enabledAt ? html`<p data-cloud-enabled-at="true">${t('自动上传启用时间：{time}', { time: new Date(auto.enabledAt).toLocaleString() })}</p>` : null}
    <p role="status" aria-live="polite" data-cloud-auto-status="true">${t(autoStatuses[auto.status] || autoStatuses.off)} ${auto.updatedAt ? t('最近自动上传：{time}', { time: auto.updatedAt }) : ''} ${auto.error ? t(errors[auto.error] || errors.INVALID) : ''}</p>
    <div style="display:flex;gap:12px">
      <${Button} data-cloud-action="authorize" disabled=${busy} onClick=${() => onAction('authorize')}>${t('验证身份并恢复云设置')}<//>
      <${Button} data-cloud-action="upload" disabled=${busy} onClick=${() => onAction('upload')}>${t('上传所选数据')}<//>
      <${Button} data-cloud-action="restore" disabled=${busy || locked} onClick=${() => onAction('restore')}>${t('恢复所选数据')}<//>
    </div>
    ${locked ? html`<p>${t('请先离开房间再恢复，避免覆盖正在使用的调配。')}</p>` : null}
    <p>${t('恢复会替换所选本机数据（不合并）。确认后先保存本机备份；未选数据不变。统计是浏览器记录，不是认证竞技成绩；队友代号也可能随统计上传。')}</p>
    <p role="status" aria-live="polite">${status}</p>
  </section>`;
}

// Only the actual entered game identity is eligible, never a title draft/remembered nickname.
export function cloudSavePlayerName(state) {
  return state?.session?.entered && typeof state?.me?.name === 'string' ? state.me.name : '';
}

export function CloudSavePanel({ onRestored }) {
  const auto = useStore(s => s, Object.is, autoCloudUpload);
  const name = useStore(cloudSavePlayerName);
  const locked = useStore((s) => !!s.room);
  const [selection, setSelection] = useState({ stats: true, operators: true });
  const [busy, setBusy] = useState(false), [status, setStatus] = useState('');
  const passwordRef = useRef(null), running = useRef(false);
  const autoAction = async (enabled) => {
    if (running.current) return;
    running.current = true; setBusy(true); setStatus(t('正在处理…'));
    try {
      if (!enabled) { await autoCloudUpload.disable(); setStatus(t('自动上传已关闭。')); return; }
      const activated = await autoCloudUpload.enable(passwordRef.current?.value || '', () => confirmDialog({
        title: t('启用自动上传'), danger: true, okText: t('确认启用'),
        text: t('仅将启用时间之后新记录的对局追加到服务器，按编号去重；不上传历史或干员设置。设置保存在服务器，本机保存授权令牌而不保存密码；其他浏览器须验证原密码。是否启用？'),
      }));
      setStatus(activated ? t('自动上传已授权，等待新对局记录。') : t('自动上传已关闭。'));
    } catch (e) { setStatus(e.message === 'AUTH' ? t('自动上传授权失败：请先手动创建服务器存档，并使用其原恢复密码。') : t(errors[e.message] || errors.INVALID)); }
    finally { if (passwordRef.current) passwordRef.current.value = ''; running.current = false; setBusy(false); }
  };
  const action = async (which) => {
    if (running.current) return;
    running.current = true; setBusy(true); setStatus(t('正在处理…'));
    try {
      if (which === 'authorize') {
        await autoCloudUpload.authorize(passwordRef.current?.value || '');
        setStatus(t('身份已验证，服务器自动上传设置已恢复；查看统计页可合并云记录。'));
        return;
      }
      if (which === 'restore' && store.get().room) throw new Error('INVALID');
      if (!selection.stats && !selection.operators) throw new Error('INVALID');
      const fields = { name: cloudSavePlayerName(store.get()), password: passwordRef.current?.value || '' };
      if (!fields.name) throw new Error('IDENTITY');
      if (fields.password.length < 8 || fields.password.length > 128) throw new Error('PASSWORD');
      if (which === 'upload') {
        const ok = await confirmDialog({ title: t('上传服务器存档'), danger: true, okText: t('确认上传'), text: t('将上传勾选的本机数据；若已有同名服务器存档，将替换服务器存档中的所选数据，不会合并这些记录。请确认玩家名及数据范围；本机数据不变。') });
        if (!ok) { setStatus(t('已取消上传，服务器存档未变。')); return; }
        if (cloudSavePlayerName(store.get()) !== fields.name) throw new Error('IDENTITY');
        fields.payload = snapshotCloudSave(selection);
      }
      const result = await requestCloudSave(which, fields);
      if (which === 'upload') setStatus(t('已上传到本服务器：{time}', { time: result.updatedAt }));
      else {
        const applied = await restoreCloudSave(result.payload, selection, async () => {
          const ok = await confirmDialog({ title: t('恢复服务器存档'), danger: true, okText: t('替换本机数据'), text: t('将替换勾选的本机数据，不会合并。恢复前将保存本机备份；请确认玩家名及数据范围。') });
          if (store.get().room) throw new Error('INVALID');
          return ok;
        });
        if (applied) {
          if (selection.operators) loadoutStore.set({ entries: parseStored(result.payload.operators.loadout), ops: parseStoredOps(result.payload.operators.loadout), skins: parseStoredSkins(result.payload.operators.skins) });
          onRestored?.();
          setStatus(t('已恢复；恢复前本机数据保存在sp.cloud.backup.latest。'));
        } else setStatus(t('已取消恢复，本机数据未变。'));
      }
    } catch (e) { setStatus(t(errors[e.message] || errors.INVALID)); }
    finally { if (passwordRef.current) passwordRef.current.value = ''; running.current = false; setBusy(false); }
  };
  return html`<${CloudSaveView} name=${name} passwordRef=${passwordRef} selection=${selection} onSelection=${setSelection} status=${status} busy=${busy} locked=${locked} onAction=${action} auto=${auto} onAutoChange=${autoAction} />`;
}
