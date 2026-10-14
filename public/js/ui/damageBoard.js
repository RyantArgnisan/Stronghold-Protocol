import { useState } from '../../vendor/hooks.module.js';
import { html } from './components.js';
import { useStore } from '../store.js';

export function DamageView({ packet, ownerId, ownerName = '', open = true, scope = 'total', onOpen = () => {}, onScope = () => {} }) {
  const selected = [packet, ...(packet?.peers || [])].find((p) => p?.ownerId === ownerId);
  const rows = selected?.[scope] || [];
  const number = (n) => Math.round(n || 0).toLocaleString('zh-CN');
  return html`<section class="damage-board" aria-label="当局伤害记录" onKeyDown=${(e) => {
    if (e.key === 'Escape' && open) { onOpen(false); e.stopPropagation(); }
    else if (e.key === ' ') e.stopPropagation();
  }}>
    <button type="button" class="damage-board__toggle" aria-expanded=${open} aria-controls="damage-board-body" onClick=${() => onOpen(!open)}>伤害记录 ${open ? '▾' : '▸'}</button>
    ${open ? html`<div id="damage-board-body" class="damage-board__body">
      <div class="damage-board__head">${ownerName || '当前席位'} · 第 ${packet?.round || 0} 轮</div>
      <div class="damage-board__tabs">${[['total', '整局'], ['current', '本轮']].map(([value, label]) => html`<button type="button" data-scope=${value} aria-pressed=${scope === value} onClick=${() => onScope(value)}>${label}</button>`)}</div>
      <div class="damage-board__scroll"><table><thead><tr><th>干员 / 来源</th><th>实际伤害</th></tr></thead><tbody>
        ${rows.map((r) => html`<tr key=${JSON.stringify([r.defId, r.charId, r.kind])}><td title=${r.defId}>${r.name || r.defId}${r.kind !== 'op' ? '（独立来源）' : ''}${r.summonDamage > 0 ? html`<small>含召唤物 ${number(r.summonDamage)}</small>` : null}</td><td>${number(r.damage)}</td></tr>`)}
      </tbody>${selected ? html`<tfoot><tr data-total=${rows.reduce((sum, r) => sum + r.damage, 0)}><th>本席合计</th><td>${number(rows.reduce((sum, r) => sum + r.damage, 0))}</td></tr></tfoot>` : null}</table>${rows.length ? null : html`<p>暂无本席伤害记录</p>`}</div>
      <small class="damage-board__note">本席同干员合并（普通/精锐）；护盾吸收不计。无明确归属的召唤物单列。客户端遥测，非竞技成绩。</small>
      ${selected?.truncated ? html`<small class="damage-board__note">记录达到传输上限，显示可能不完整。</small>` : null}
    </div>` : null}
  </section>`;
}

export function DamageBoard({ ownerId, ownerName, fieldId }) {
  const packet = useStore((s) => s.match.damage);
  const chatting = useStore((s) => !!s.chat?.open);
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState('total');
  // A camera/watch change must not briefly expose a previously viewed, now hidden battlefield.
  const visible = packet && (!fieldId || !packet.fieldId || packet.fieldId === fieldId) ? packet : null;
  if (chatting) return null; // retain state; give the original communication popover its full lane
  return html`<${DamageView} packet=${visible} ownerId=${ownerId} ownerName=${ownerName} open=${open} scope=${scope} onOpen=${setOpen} onScope=${setScope} />`;
}
