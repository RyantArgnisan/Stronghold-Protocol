import { HeadlessJob } from '../../server/match/fields.js';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { recordDamage, damagePacket } from '../../server/sim/damageBoard.js';
import { makeBattle, enemyRec } from '../helpers/battleHarness.js';

test('opt-in headless fallback records bounded HP timeline independently of ordinary rehearsal', () => {
  const { h, u, e } = arena(); h.b.dealDamage(u, e, { amount: 15, type: 'true' });
  h.b.forceEnd('forced');
  const job = new HeadlessJob(h.b, { damageTelemetry: true }); job.run();
  assert.ok(job.output().damageTimeline?.length);
  assert.equal(job.output().damageTimeline.at(-1)[1].rows[0].damage, 15);
});
test('packet includes zero operators, distinguishes DIY charId, bounds UTF-8 payload and detached copies', () => {
  const { h, u, e } = arena();
  assert.equal(damagePacket(h.b).rows.length, 1, 'zero-damage operator included');
  u.def = { ...u.def, charId: 'char_aaa' }; recordDamage(h.b, u, e, 5);
  u.def = { ...u.def, charId: 'char_bbb' }; recordDamage(h.b, u, e, 7);
  assert.equal(h.b.damageRows.length, 2, 'different composed operators do not share a DIY slot total');
  h.b.damageRows = Array.from({ length: 160 }, (_, i) => ({ ownerId: 'p1', defId: `op_${i}`, name: '汉'.repeat(80), kind: 'op', damage: 1, summonDamage: 0 }));
  const packet = damagePacket(h.b);
  assert.ok(packet.truncated);
  assert.ok(new TextEncoder().encode(JSON.stringify(packet)).length <= 24576);
  packet.rows[0].damage = 999;
  assert.equal(h.b.damageRows[0].damage, 1);
});

export function arena() {
  const h = makeBattle({ content: 'none', defs: { enemies: { enemy_dummy: enemyRec({ key: 'enemy_dummy', hp: 100, speed: 0 }) } }, units: [{ uid: 1, chessId: 'chess_char_1_02_a', row: 10, col: 5 }], autoFinish: false });
  h.step(); return { h, u: h.unit(1), e: h.spawn('enemy_dummy', { pos: [10, 8] }) };
}
test('damage board observes actual enemy HP lost: shields excluded and overkill capped, no balance changes', () => {
  const { h, u, e } = arena();
  h.b.addBuff(e, { key: 'shield', shield: 50 });
  assert.equal(h.b.dealDamage(u, e, { amount: 80, type: 'true' }), 30);
  assert.equal(h.b.dealDamage(u, e, { amount: 1000, type: 'true' }), 70);
  assert.ok(Array.isArray(h.b.damageRows), 'battle exposes display-only HP damage rows');
  assert.equal(h.b.damageRows[0].damage, 100);
  assert.equal(h.b.damageRows[0].summonDamage, 0);
  assert.equal(e.hp, 0);
});
test('nested summons follow explicit same-seat operator; removed summons retain damage; unresolved tokens stay separate', () => {
  const { h, u, e } = arena();
  const token = { side: 'ally', kind: 'token', ownerId: u.ownerId, defId: 'token_x', name: '同名', ownerUnit: { ownerId: u.ownerId, kind: 'token', ownerUnit: u } };
  recordDamage(h.b, token, e, 20);
  assert.equal(h.b.damageRows[0].defId, u.defId);
  assert.equal(h.b.damageRows[0].summonDamage, 20);
  token.ownerUnit = null;
  recordDamage(h.b, token, e, 30);
  assert.equal(h.b.damageRows.length, 2);
  assert.equal(h.b.damageRows[1].kind, 'token');
  assert.equal(h.b.damageRows[0].damage, 20);
  token.ownerUnit = { ...u, ownerId: 'other' };
  recordDamage(h.b, token, e, 5);
  assert.equal(h.b.damageRows[1].damage, 35);
});
