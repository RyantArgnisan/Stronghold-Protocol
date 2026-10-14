import { bodyInKeys } from '../../body.js';
import { sortEnemyTargets, absoluteRangeKeys } from '../../targeting.js';

export const alive = (u) => !!u?.alive && u.deployed && !u.removed;
export const inRange = (u, t) => bodyInKeys(t, u.rangeKeySet);
export const talent = (raw, i) => raw.talents?.find((t) => t.index === i)?.bb ?? {};
export const owned = (b, u, id) => b.allyUnits.filter((t) => t.ownerUnit === u && (!id || t.def.id === id) && alive(t));
export const enemies = (b, u, n = Infinity, priority) => {
  const grid = u.skill?.active && u.skill.spec.targeting?.rangeGrid;
  const keys = grid ? absoluteRangeKeys(grid, u.tileR, u.tileC, u.dir, 0) : u.rangeKeys;
  const xs = b.enemiesInKeys(keys, u, { ...u.profile, ...(u.skill?.active ? u.skill.spec.targeting : {}) });
  sortEnemyTargets(b, u, xs, priority ?? u.profile.priority);
  return xs.slice(0, n);
};
export const buff = (b, u, key, mods, duration = Infinity, extra = {}) =>
  b.addBuff(u, { key, mods, duration, ...extra });
export const damage = (b, u, t, scale, type = 'phys', extra = {}) =>
  b.dealDamage(u, t, { amount: u.s.atk * scale, type, tags: ['recruit'], ...extra });
export const every = (b, u, interval, fn) =>
  b.every(
    interval,
    () => {
      if (alive(u)) fn();
    },
    { owner: u },
  );
export const after = (b, u, delay, fn) => {
  const seq = u.deploySeq;
  return b.after(
    delay,
    () => {
      if (alive(u) && u.deploySeq === seq) fn();
    },
    { owner: u },
  );
};
// Only the selected authored spec is exposed; unrelated skills never get marked implemented.
export const kit = (raw, spec, install, trait) => ({ skills: { [raw.skill.skillId]: spec }, install, trait });
