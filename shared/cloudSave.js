// Versioned, bounded backup envelope; no account/session tokens or gameplay authority.
import { isLoadoutEntries, isLoadoutOps } from './protocol.js';
import { isSkinChoices } from './skins.js';
export const CLOUD_MAX_BYTES = 2_000_000;
export const CLOUD_KEYS = Object.freeze({ stats: 'sp.pref.stats', loadout: 'sp.pref.loadout', skins: 'sp.pref.skins' });
const object = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const keys = (v, allowed) => object(v) && Object.keys(v).every((k) => allowed.includes(k));

function safeTree(v, depth = 0, count = { n: 0 }) {
  if (++count.n > 160_000 || depth > 10) return false;
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v) && Math.abs(v) <= Number.MAX_SAFE_INTEGER;
  if (typeof v === 'string') return v.length <= 256;
  if (Array.isArray(v)) return v.length <= 1000 && v.every((x) => safeTree(x, depth + 1, count));
  return object(v) && Object.keys(v).length <= 1000 && Object.entries(v).every(([k, x]) => k.length <= 64 && !['__proto__', 'constructor', 'prototype'].includes(k) && safeTree(x, depth + 1, count));
}
export function validCloudIdentity(name, password) {
  return typeof name === 'string' && name.length >= 1 && name.length <= 24 && name === name.trim() && !/[\u0000-\u001f\u007f]/.test(name)
    && typeof password === 'string' && password.length >= 8 && password.length <= 128;
}
export function validCloudPayload(p) {
  if (!keys(p, ['v', 'stats', 'operators']) || p.v !== 1 || (!p.stats && !p.operators) || !safeTree(p)) return false;
  if (new TextEncoder().encode(JSON.stringify(p)).length > CLOUD_MAX_BYTES - 1024) return false;
  if (p.stats) {
    const s = p.stats;
    if (!keys(s, ['v', 'records']) || ![1,2].includes(s.v) || !Array.isArray(s.records) || s.records.length > 1000) return false;
    const allowed = ['id','v','t','end','victory','roundsPassed','lastRound','hiddenReached','hiddenCleared','reason','modeId','difficulty','stageId','bossId','hiddenBossId','seed','durationMs','teamLp','roomMode','selfId','players','compact','vs','content'];
    if (!s.records.every((r) => keys(r, allowed) && typeof r.id === 'string' && r.id.length > 0 && r.id.length <= 64 && (r.v === undefined || r.v === 1 || r.v === 2) && Array.isArray(r.players) && r.players.length > 0 && r.players.length <= 8 && r.players.every((x) => object(x) && (!x.lineup || Array.isArray(x.lineup) && x.lineup.length <= 12) && (!x.bonds || Array.isArray(x.bonds) && x.bonds.length <= 24)))) return false;
  }
  if (p.operators) {
    const o = p.operators, l = o.loadout, s = o.skins;
    if (!keys(o, ['loadout', 'skins']) || !keys(l, ['v', 'entries', 'ops']) || l.v !== 1 || !object(l.entries) || !object(l.ops)
      || !keys(s, ['v', 'skins']) || s.v !== 1 || !object(s.skins)) return false;
    if (!isLoadoutEntries(l.entries) || !Object.values(l.entries).every((e) => keys(e, ['skill', 'module']))) return false;
    if (!isLoadoutOps(l.ops) || !Object.values(l.ops).every((e) => keys(e, ['potential', 'cultivate']))) return false;
    if (!isSkinChoices(s.skins)) return false;
  }
  return true;
}
