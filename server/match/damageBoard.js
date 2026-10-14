// Match-local display ledger, never persisted to player stats. Replace absolute snapshots,
// not deltas: retransmission/reconnect/takeover cannot double count a field.
const key = (r) => JSON.stringify([r.ownerId, r.charId || r.defId, r.kind]);
function add(map, rows) {
  let truncated = false;
  for (const r of rows) {
    const k = key(r), old = map.get(k);
    if (old) { old.damage += r.damage; old.summonDamage += r.summonDamage; }
    else if (map.size < 4096) map.set(k, { ...r });
    else truncated = true;
  }
  return truncated;
}
export class DamageLedger {
  constructor() { this.round = 0; this.base = new Map(); this.fields = new Map(); this.truncated = false; }
  advance(round) {
    if (round <= this.round) return;
    for (const p of this.fields.values()) { const cut = add(this.base, p.rows); this.truncated = this.truncated || cut || p.truncated; }
    this.fields.clear(); this.round = round;
  }
  replace(round, fieldKey, packet) {
    if (round < this.round) return;
    this.advance(round);
    this.fields.set(fieldKey, structuredClone(packet));
  }
  view(round, ownerId) {
    this.advance(round);
    const current = new Map();
    let truncated = this.truncated;
    for (const p of this.fields.values()) { add(current, p.rows); truncated ||= p.truncated; }
    const total = new Map([...this.base].map(([k, v]) => [k, { ...v }]));
    add(total, current.values());
    const rows = (map) => { const found = [...map.values()].filter((r) => r.ownerId === ownerId).sort((a, b) => b.damage - a.damage); truncated ||= found.length > 512; return found.slice(0, 512); };
    const totalRows = rows(total), currentRows = rows(current);
    return { round: this.round, ownerId, total: totalRows, current: currentRows, truncated };
  }
}
