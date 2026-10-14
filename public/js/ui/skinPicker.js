// Pure picker: availability comes from the validated offline manifest, not the catalogue.
import { html } from './components.js';
import { Img } from './gameComponents.js';
import { skinsFor, skinIdFor } from '../../../shared/skins.js';
import { skinAssetEntry } from '../assets.js';
import { t } from '../../../shared/i18n.js';

export function skinOptions(charId, overlay) {
  return [{ id: null, name: t('默认'), available: true }, ...skinsFor(charId).map((s) => {
    const art = skinAssetEntry(overlay, charId, s.id);
    return { ...s, available: !!art?.spine?.front, avatar: art?.avatar || null };
  })];
}
export function SkinPicker({ charId, overlay, choices = {}, readonly = false, onPick }) {
  const selected = skinIdFor(choices, charId);
  return html`<section class="skin-picker" role="radiogroup" aria-label=${t('皮肤')} data-char=${charId}>
    ${skinOptions(charId, overlay).map((s) => html`<button type="button" role="radio" key=${s.id || 'default'}
      data-skin=${s.id || ''} data-available=${s.available ? 'true' : 'false'} aria-checked=${selected === s.id ? 'true' : 'false'}
      class=${selected === s.id ? 'skin-option is-on' : 'skin-option'} disabled=${readonly || !s.available}
      onClick=${() => onPick(charId, s.id)}>
      ${s.avatar ? html`<${Img} src=${s.avatar} fallback=${null} />` : null}
      <b>${s.name}</b><small>${s.group || ''}</small><span>${s.available ? t('可用') : t('资源未安装')}</span>
    </button>`)}
  </section>`;
}
