// Selectively adapted from SrC2O4/Stronghold-Protocol @ c76a81fb5cd8ca5bb360ff10f834cc9a166b0c88 (GPL-3.0-or-later).
// S2 automatic adaptation; full friendly beam redirection and S3 are not exposed.
import {genericSkillSpec} from '../generic.js';
import {talent,owned,enemies,buff,damage,inRange,every,after,kit} from './aphrisSupport.js';
const seed=(bb,raw,def)=>genericSkillSpec(def.skill,bb,def);
function onToken(b,u,fn){b.on('deploy',({unit:d})=>{if(d.ownerUnit===u){if(d.skill){d.skill.end('ownerManaged');d.skill.noSkill=true;}fn(d);}},{owner:u,priority:100});}
function aphris(bb, raw, def) {
  const n = raw.skill.index,
    t = talent(raw, 0),
    z = talent(raw, 1),
    s = seed(bb, raw, def);
  if (n === 1) {
    s.attack = { noAttack: true };
    s.targeting = {rangeGrid:Array.from({length:21},(_,c)=>[0,c]),noRangeExtend:true};
    s.onStart = ({ unit: u }) => {
      u.trait.aphrisCd = 0;
    };
    s.onTick = ({ battle: b, unit: u, dt }) => {
      u.trait.aphrisCd += dt;
      if (u.trait.aphrisCd >= bb.interval) {
        u.trait.aphrisCd -= bb.interval;
        for (const e of enemies(b, u)) damage(b, u, e, bb.atk_scale, 'arts');
      }
    };
  }
  return kit(raw, s, (b, u) => {
    onToken(b, u, (d) => {
      d.profile.noAttack = true;
      buff(b, d, 'aphris:relay', {}, Infinity, { flags: { untargetable: true } });
      if (n !== 0)
        after(b, d, 25, () => {
          b.retreat(d, { reason: 'expired' });
        });
    });
    every(b, u, 0.2, () => {
      const ds = owned(b, u);
      buff(b, u, 'aphris:relayAtk', { atkPct: ds.length ? t.atk : 0 }, 0.3);
      b.setExtraRange(
        u,
        ds.flatMap((d) => d.rangeKeys),
      );
      for (const a of b.alliesFor(u).filter((a) => inRange(u, a)))
        buff(b, a, 'aphris:penetration', { resIgnoreFlat: z.magic_resist_penetrate_fixed }, 0.3);
    });
  });
}

export const APHRIS_TOKEN_KITS={'token_10070_aphris_pc':()=>({trait:{noAttack:true}})};
export default {'chess_rhine_aphris_a':aphris};
