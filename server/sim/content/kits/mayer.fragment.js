import { num, talentBb, skillRec, freeTileAround, enemiesInGrid, alliesInGridOf, up } from './shared/tier1.js';
import { RHINE_BALANCE as B } from '../../../../shared/rhineResearch.js';
import { canReceiveHeal } from '../../damage.js';

export const OTTER = 'token_10004_otter_motter';
const MAYER_S1 = 'skchr_otter_1', MAYER_S2 = 'skchr_otter_2';
export const liveOtters = (b, owner) => b.allyUnits.filter(a => a.kind === 'token' && a.defId === OTTER && a.ownerUnit === owner && up(a));
const selected = (chess, def) => def?.skill?.id ?? chess.skill?.skillId;
const record = (chess, id, bb, def) => {
  const rec = skillRec(chess, id) ?? {};
  return id === selected(chess, def) ? { ...rec, bb: bb ?? rec.bb ?? {} } : rec;
};

/** Same named aura never stacks; a weaker source cannot overwrite a stronger live source. */
function aura(b, target, key, source, value, mods) {
  const cur = target.findBuff(key);
  if (cur && cur.source !== source && num(cur.data?.value) > value && cur.timeLeft > 0.05) return;
  b.addBuff(target, { key, source, duration: 0.2, data: { value }, mods, tags: ['aura'] });
}

/** Intrinsic blocking slow reads the token's OWN resolved module variant, including pre-placed otters. */
export function otterKit() {
  return { fromTokens: true, skill: null, talents: [{ install(b, t) {
    b.addBuff(t, { key: 'mayer:noOperatorHeal', persist: true, allowDead: true, flags: { noOperatorHeal: true } });
    const owner = t.ownerUnit;
    const slow = num(t.def.talents?.find(x => x.bb?.attack_speed != null)?.bb.attack_speed, -25);
    const s1 = owner?.def.skill?.id === MAYER_S1 ? owner.def.raw?.skill : null;
    const dodge = num(s1?.bb?.prob);
    const apply = () => {
      if (!up(t)) return;
      for (const enemy of t.blocking) if (enemy.alive) aura(b, enemy, 'mayer:otterBlock', t, -slow, { aspd: slow });
      if (dodge > 0 && up(owner)) for (const ally of alliesInGridOf(b, t, s1.rangeGrid ?? [[0, 0]])) {
        aura(b, ally, 'mayer:confusion', t, dodge, { dodgePhys: dodge, dodgeArts: dodge });
      }
    };
    b.every(0.1, apply, { owner: t });
    b.on('deploy', c => { if (c.unit === t) apply(); }, { owner: t });
  } }] };
}
export const RHINE_SUPPORT_TOKEN_KITS = { [OTTER]: otterKit };

export function mayer(bb, chess, def) {
  const capacity = Math.min(B.mayerSummons[chess.isGolden ? 1 : 0], Math.max(1, num(talentBb(chess).cnt, 1)));
  const s2 = record(chess, MAYER_S2, bb, def);
  const summon = (b, u) => {
    if (!up(u) || !(u.mem.otterStock > 0) || liveOtters(b, u).length >= capacity) return;
    const tile = freeTileAround(b, u, (r, c) => b.grid.canStand(r, c) && !b.grid.isObstacle(r, c));
    if (!tile) return;
    const t = b.spawnToken(u, OTTER, ...tile, { kit: otterKit() });
    if (t) { u.mem.otterStock--; b.fx('summon', { x: t.x, y: t.y, id: t.id, token: OTTER }); }
  };
  const skills = {
    [MAYER_S1]: { kind: 'passive' }, // each otter applies its selected skill's aura, including board pieces
    [MAYER_S2]: { kind: 'instant', onStart({ battle: b, unit: u }) {
      const data = s2.bb ?? {}, seq = u.deploySeq;
      for (const t of liveOtters(b, u)) {
        // The owner's skill triggers the summon skill: a stunned/frozen/silenced otter cannot detonate.
        if (!t.canAct || t.s.flags.silence) continue;
        for (const e of enemiesInGrid(b, t, s2.rangeGrid, { canHitFly: true })) {
          b.dealDamage(u, e, { amount: u.s.atk * num(data.atk_scale, 3.8), type: 'arts', isSkill: true, tags: ['skill', 'mayerExplosion'] });
          if (e.alive) b.applyStatus(e, 'stun', { duration: num(data.stun, 1), source: u });
        }
        b.fx('explode', { x: t.x, y: t.y, id: t.id });
        b.retreat(t, { reason: 'recycle', permanent: true });
        u.mem.otterStock = Math.min(capacity, num(u.mem.otterStock) + 1);
      }
      // Automatic placement retains the project's summon adaptation; it never consumes another owner's stock.
      b.after(1, () => { if (u.deploySeq === seq) summon(b, u); }, { owner: u });
    } },
  };
  return { skills, skill: skills[selected(chess, def)] ?? skills[MAYER_S2], talents: [{ install(b, u) {
    b.on('deploy', c => {
      if (c.unit !== u) return;
      const seq = u.deploySeq;
      // Operators deploy before their board tokens. Count those tokens before any automatic placement.
      b.after(0, () => {
        if (!up(u) || u.deploySeq !== seq) return;
        u.mem.otterStock = Math.max(0, capacity - liveOtters(b, u).length);
        summon(b, u);
      }, { owner: u });
    }, { owner: u });
    b.on('death', c => {
      if (c.unit !== u) return;
      for (const t of liveOtters(b, u)) b.retreat(t, { reason: 'ownerGone', permanent: true });
      u.mem.otterStock = 0;
    }, { owner: u });
    b.every(10, () => summon(b, u), { owner: u });
    if (u.skill.id === MAYER_S2) {
      const activate = u.skill.activate;
      u.skill.activate = function(reason, opts) {
        return liveOtters(b, u).length ? activate.call(this, reason, opts) : false;
      };
    }
  } }] };
}
