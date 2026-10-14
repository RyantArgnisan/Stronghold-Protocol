// Cosmetic browser preferences, separate from gameplay loadouts. Exact IDs are never URLs.
import { cleanSkinChoices, skinFor } from '../../../shared/skins.js';
import { t } from '../../../shared/i18n.js';

export const SKINS_PREF = 'skins';
export const SKINS_IMPORT_MAX_BYTES = 256 * 1024;
export const toStoredSkins = (skins) => ({ v: 1, skins: cleanSkinChoices(skins) });
export const parseStoredSkins = (raw) => raw?.v === 1 ? cleanSkinChoices(raw.skins) : {};
export function setSkinChoice(choices, charId, id) {
  const out = cleanSkinChoices(choices);
  if (id == null) delete out[charId];
  else if (skinFor(charId, id)) out[charId] = id;
  return out;
}
export function serializeSkins(choices) {
  return JSON.stringify({ kind: 'stronghold.skins', ...toStoredSkins(choices) }, null, 2);
}
export function parseSkinImport(input) {
  let raw = input;
  if (typeof raw === 'string') {
    if (raw.length > SKINS_IMPORT_MAX_BYTES) return { ok: false, error: t('内容过长，无法导入') };
    try { raw = JSON.parse(raw); } catch { return { ok: false, error: t('无法识别的内容') }; }
  }
  if (!raw || raw.v !== 1 || raw.kind !== 'stronghold.skins' || !raw.skins || typeof raw.skins !== 'object' || Array.isArray(raw.skins)) {
    return { ok: false, error: t('无法识别的格式') };
  }
  return { ok: true, skins: cleanSkinChoices(raw.skins) };
}
