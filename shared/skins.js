// Cosmetic catalogue shared by the lobby and browser. IDs are opaque, not URLs.
import { SKIN_CATALOGUE } from './skin-catalogue.js';

export const OPERATOR_SKINS = SKIN_CATALOGUE;
export const SKIN_LIMITS = Object.freeze({ entries: 256, idLen: 80 });

export function skinFor(charId, skinId) {
  return OPERATOR_SKINS.find((s) => s.charId === charId && s.id === skinId) || null;
}

export function skinsFor(charId) {
  return OPERATOR_SKINS.filter((s) => s.charId === charId);
}

export function skinIdFor(choices, charId) {
  if (!choices || typeof choices !== 'object') return null;
  const proto = Object.getPrototypeOf(choices);
  if (proto !== Object.prototype && proto !== null) return null;
  const d = Object.getOwnPropertyDescriptor(choices, charId);
  return d && d.enumerable && Object.hasOwn(d, 'value') && skinFor(charId, d.value) ? d.value : null;
}

export function cleanSkinChoices(value) {
  const out = {};
  if (!value || typeof value !== 'object') return out;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return out;
  for (const charId of Object.keys(value)) {
    if (Object.keys(out).length >= SKIN_LIMITS.entries) break;
    const id = skinIdFor(value, charId);
    if (id) out[charId] = id;
  }
  return out;
}

export function isSkinChoices(value) {
  if (!value || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;
  const keys = Reflect.ownKeys(value);
  if (keys.length > SKIN_LIMITS.entries) return false;
  return keys.every((charId) => {
    const d = Object.getOwnPropertyDescriptor(value, charId);
    return typeof charId === 'string' && d.enumerable && Object.hasOwn(d, 'value')
      && typeof d.value === 'string' && d.value.length <= SKIN_LIMITS.idLen
      && !!skinFor(charId, d.value);
  });
}
