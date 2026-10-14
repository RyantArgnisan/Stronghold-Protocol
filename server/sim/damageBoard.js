// Display-only HP telemetry. Mechanism reviewed against the Lele toolkit damage board
// (original feature credited there to Stardust-minus); this client-combat adaptation is independent.
// Values come after mitigation/shields/fatal HP floors, never from the displayed damage event.
export function recordDamage(battle, source, target, dealt) {
  if (source?.side !== 'ally' || target?.side === 'ally' || !source.ownerId || !(dealt > 0) || !Number.isFinite(dealt)) return;
  let root = source;
  const seen = new Set();
  while (root?.ownerUnit && !seen.has(root)) { seen.add(root); root = root.ownerUnit; }
  if (!root || seen.has(root) || root.kind !== 'op' || root.ownerId !== source.ownerId) root = source;
  battle.damageRows ??= [];
  const charId = root.def?.charId || undefined;
  let row = battle.damageRows.find((r) => r.ownerId === source.ownerId && (r.charId || r.defId) === (charId || root.defId) && r.kind === root.kind);
  if (!row) { row = { ownerId: source.ownerId, defId: root.defId, ...(charId ? { charId } : {}), name: String(root.name || root.defId).slice(0, 80), kind: root.kind, damage: 0, summonDamage: 0 }; battle.damageRows.push(row); }
  row.damage += dealt;
  if (root !== source) row.summonDamage += dealt;
}

/** Detached, bounded optional telemetry; legacy clients may omit it entirely. */
export function damagePacket(battle) {
  const meta = [...(battle.damageRows || [])];
  for (const ps of battle.players || []) for (const u of ps.units || []) {
    if (u.kind !== 'op') continue;
    const charId = u.def?.charId || undefined;
    if (!meta.some((r) => r.ownerId === u.ownerId && (r.charId || r.defId) === (charId || u.defId) && r.kind === 'op'))
      meta.push({ ownerId: u.ownerId, defId: u.defId, ...(charId ? { charId } : {}), name: String(u.name || u.defId).slice(0, 80), kind: 'op', damage: 0, summonDamage: 0 });
  }
  const rows = meta.map((r) => ({ ...r, damage: Math.min(1e13, r.damage), summonDamage: Math.min(1e13, r.summonDamage) }));
  const packet = { rows: rows.slice(0, 128), truncated: rows.length > 128 };
  while (packet.rows.length && new TextEncoder().encode(JSON.stringify(packet)).length > 24 * 1024) { packet.rows.pop(); packet.truncated = true; }
  return packet;
}
