// Shared strict record normalization, dedupe and storage budgets (browser/server).
export const STATS_VERSION = 2;
export const MAX_RECORDS = 1000;
export const FULL_KEEP = 30;
export const MAX_CHARS = 800_000;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, d) => (Number.isFinite(v) ? Math.round(v) : d);
const num = (v) => (Number.isFinite(v) ? v : null);
const bool = (v, d = false) => (typeof v === 'boolean' ? v : d);
/** A non-empty string, cut to `max` characters. */
const str = (v, max = 64) => (typeof v === 'string' && v.length ? v.slice(0, max) : null);

// per-record bounds (an imported file is foreign data: nothing a row holds may grow without limit)
const MAX_PLAYERS = 8; // extended co-op rooms; retain every settlement row
const MAX_LINEUP = 12;
const MAX_ITEMS = 4;
const MAX_BONDS = 24;
const MAX_STAT_KEYS = 24;
const MAX_NAME = 24;

function normalizeStatBlock(raw) {
  const out = {};
  if (!isObj(raw)) return out;
  let n = 0;
  for (const [k, v] of Object.entries(raw)) {
    if (!Number.isFinite(v) || k.length > 32) continue;
    out[k] = v;
    if (++n >= MAX_STAT_KEYS) break;
  }
  return out;
}

/**
 * FNV-1a 32-bit, hex — a content hash needs no crypto, only stability across sessions.
 * @param {string} s
 * @returns {string}
 */
function fnv1a(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

function normalizePlayerRow(raw, quit = false) {
  const p = isObj(raw) ? raw : {};
  // the page and the replay read the title record from the game data by id: the sent texts are not kept
  const title = isObj(p.title) && str(p.title.id) ? { id: str(p.title.id) } : null;
  const lineup = (Array.isArray(p.lineup) ? p.lineup : []).filter(isObj).slice(0, MAX_LINEUP).map((u) => {
    // ids only — the tile position (row/col) is replay detail, not a statistic; items kept (配发装备统计); a 自选
    // pick and a 补位 stand-in kept too, or the replayed card would draw the plain operator
    const e = {
      id: str(u.id) || '', golden: bool(u.golden), tier: int(u.tier, 0),
      items: (Array.isArray(u.items) ? u.items : []).filter((i) => typeof i === 'string' && i.length).slice(0, MAX_ITEMS).map((i) => i.slice(0, 64)),
    };
    if (u.kind === 'token') e.kind = 'token';
    if (isObj(u.diy) && str(u.diy.charId)) {
      e.diy = { charId: str(u.diy.charId), skillIndex: Number.isInteger(u.diy.skillIndex) ? u.diy.skillIndex : 0, uniEquipId: str(u.diy.uniEquipId) };
    }
    if (str(u.standInFor)) e.standInFor = str(u.standInFor);
    return e;
  }).filter((u) => u.id);
  const bonds = (Array.isArray(p.bonds) ? p.bonds : []).filter(isObj).slice(0, MAX_BONDS).map((b) => ({
    bondId: str(b.bondId) || str(b.id) || '', layers: int(b.layers, 0), active: bool(b.active),
  })).filter((b) => b.bondId);
  return {
    playerId: str(p.playerId) || '',
    seat: int(p.seat, 0),
    name: str(p.name, MAX_NAME) || '',
    isBot: bool(p.isBot),
    left: bool(p.left),
    alive: bool(p.alive, true),
    victory: bool(p.victory), // server semantics: team won AND this player was still in at the end
    roundsPassed: quit ? num(p.roundsPassed) : int(p.roundsPassed, 0),
    ...(Number.isInteger(p.creditedKills) && p.creditedKills >= 0 && p.creditedKills <= 1e9 ? { creditedKills: p.creditedKills } : {}),
    eliminatedRound: num(p.eliminatedRound),
    lp: num(p.lp),
    bandId: str(p.bandId),
    title,
    trophies: int(p.trophies, 0),
    reward: int(p.reward, 0),
    lineup,
    bonds,
    ...(Array.isArray(p.usedBondIds) ? { usedBondIds: usedBondIdsOf(p) } : {}),
    stats: normalizeStatBlock(p.stats),
  };
}

/**
 * Normalize ONE match record to the current shape (a strict schema: missing fields get defaults, unknown ones are
 * dropped, every string / list is bounded). A record without an `end` is a settled one — the PR #323 build, which
 * never recorded anything else, wrote none.
 * @param {any} raw
 * @returns {any|null} null when the row is not salvageable (no usable player row at all)
 */
export function normalizeRecord(raw) {
  const r = isObj(raw) ? raw : {};
  // a record IS a played match — no usable players array, no record
  if (!Array.isArray(r.players)) return null;
  const quit = r.end === 'quit';
  const players = r.players.filter(isObj).slice(0, MAX_PLAYERS).map((p) => normalizePlayerRow(p, quit));
  if (!players.length) return null;
  const rec = {
    id: str(r.id),
    v: STATS_VERSION,
    t: int(r.t, 0),
    end: quit ? 'quit' : 'settled',
    victory: bool(r.victory),
    roundsPassed: quit ? num(r.roundsPassed) : int(r.roundsPassed, 0),
    lastRound: num(r.lastRound),
    hiddenReached: bool(r.hiddenReached),
    hiddenCleared: bool(r.hiddenCleared),
    reason: str(r.reason, 32),
    modeId: str(r.modeId),
    difficulty: str(r.difficulty, 24),
    stageId: str(r.stageId),
    bossId: str(r.bossId),
    hiddenBossId: str(r.hiddenBossId),
    seed: num(r.seed),
    durationMs: num(r.durationMs),
    teamLp: num(r.teamLp),
    roomMode: r.roomMode === 'solo' || r.roomMode === 'coop' ? r.roomMode : null,
    selfId: str(r.selfId),
    // the room's cosmetic plugins (see the header): its visual set, null without any (or a record from before 0.3.0)
    vs: vsOf(r.vs),
    // the room's gameplay plugins (see the header): its content set, null for the original game
    content: contentOf(r.content),
    players,
  };
  if (r.compact === true) rec.compact = true;
  // an id-less (hand-made) record gets a content id, so both copies of it land on the same key (`vs` and `content` left
  // out: the id of a record from before 0.3.0 stays the same)
  if (!rec.id) rec.id = `c.${fnv1a(JSON.stringify({ ...rec, vs: undefined, content: undefined }))}`;
  return rec;
}

const COMPACT_FRAME = ['id', 'v', 't', 'end', 'victory', 'roundsPassed', 'lastRound', 'hiddenReached', 'hiddenCleared', 'reason', 'modeId',
  'difficulty', 'roomMode', 'durationMs', 'selfId', 'vs', 'content'];

export function compactRecord(rec) {
  const self = selfRowOf(rec);
  const usedBondIds = usedBondIdsOf(self);
  const out = {};
  for (const k of COMPACT_FRAME) if (rec[k] != null) out[k] = rec[k];
  out.compact = true;
  out.players = self ? [{
    playerId: self.playerId, seat: self.seat, alive: self.alive, victory: self.victory, roundsPassed: self.roundsPassed,
    eliminatedRound: self.eliminatedRound, bandId: self.bandId, title: self.title, left: self.left, stats: self.stats,
    trophies: self.trophies,
    ...(usedBondIds.length ? { usedBondIds } : {}),
    ...(self.creditedKills != null ? { creditedKills: self.creditedKills } : {}),
  }] : [];
  return out;
}

/**
 * What goes to storage: the newest FULL_KEEP records as they are, older ones compacted, then the oldest dropped until
 * the JSON fits `maxChars` (the newest record is always kept).
 * @param {any[]} records newest first
 * @param {number} [maxChars]
 * @returns {any[]}
 */
export function fitToBudget(records, maxChars = MAX_CHARS) {
  const kept = [];
  let used = 40; // the envelope itself
  const peakId = highestBondRecord(records.slice(0, MAX_RECORDS))?.record.id;
  records.slice(0, MAX_RECORDS).forEach((r, i) => {
    const rec = i < FULL_KEEP || r.id === peakId ? r : compactRecord(r);
    const n = JSON.stringify(rec).length + 1;
    if (kept.length && used + n > maxChars) return;
    used += n;
    kept.push(rec);
  });
  return kept;
}

export function selfRowOf(rec) {
  const ps = Array.isArray(rec?.players) ? rec.players : [];
  return ps.find((p) => p.playerId && p.playerId === rec.selfId)
    || ps.find((p) => !p.isBot)
    || ps[0]
    || null;
}

const newestFirst = (a, b) => (b.t - a.t) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);
export function mergeStats(a, b) {
  const byId = new Map();
  for (const r of [...(Array.isArray(b?.records) ? b.records : []), ...(Array.isArray(a?.records) ? a.records : [])]) {
    const rec = normalizeRecord(r);
    if (rec) byId.set(rec.id, rec);
  }
  const records = [...byId.values()].sort(newestFirst).slice(0, MAX_RECORDS);
  return { v: STATS_VERSION, records };
}


const vsOf = (v) => (typeof v === 'string' && /^[0-9a-f]{64}$/.test(v) ? v : null);
export function contentOf(c) {
  if (!isObj(c) || c.vanilla === true || !vsOf(c.cs)) return null;
  const list = (Array.isArray(c.plugins) ? c.plugins : [])
    .map((p) => (typeof p === 'string' ? p : isObj(p) && typeof p.id === 'string' ? `${p.id}@${typeof p.version === 'string' ? p.version : '?'}` : null))
    .filter((x) => typeof x === 'string' && x.length <= 80).slice(0, 32);
  return { cs: c.cs, plugins: list };
}
export function usedBondIdsOf(player) {
  const ids = Array.isArray(player?.usedBondIds) ? player.usedBondIds
    : (Array.isArray(player?.bonds) ? player.bonds : []).filter((b) => b?.active === true).map((b) => b.bondId);
  return [...new Set(ids.filter((id) => typeof id === 'string' && id.length).map((id) => id.slice(0, 64)))].slice(0, MAX_BONDS);
}
export function highestBondRecord(records) {
  let best = null;
  for (const record of records) {
    if (record.end === 'quit' || record.compact) continue;
    const player = selfRowOf(record);
    for (const bond of player?.bonds || []) {
      if (!bond.active || !Number.isFinite(bond.layers) || bond.layers <= 0) continue;
      if (!best || bond.layers > best.bond.layers) best = { record, player, bond };
    }
  }
  return best;
}
