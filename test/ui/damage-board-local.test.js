import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const mod = await import('../../public/js/ui/damageBoard.js').catch(() => ({}));
function nodes(n, pred) { const out = []; function walk(v) { if (!v || typeof v !== 'object') return; if (pred(v)) out.push(v); for (const x of [v.props?.children].flat(Infinity)) walk(x); } walk(n); return out; }
const packet = { round: 2, ownerId: 'p1', fieldId: 'n:p1', total: [{ ownerId: 'p1', defId: 'op1', name: '<img src=x>', kind: 'op', damage: 100, summonDamage: 20 }], current: [{ ownerId: 'p1', defId: 'op1', name: '<img src=x>', kind: 'op', damage: 10, summonDamage: 2 }], peers: [] };
test('damage table defaults to match totals, collapses accessibly, switches round and never renders unapproved seats', () => {
  assert.equal(typeof mod.DamageView, 'function', 'damage panel exists');
  let open, scope;
  const view = mod.DamageView({ packet, ownerId: 'p1', open: true, scope: 'total', onOpen: (v) => { open = v; }, onScope: (v) => { scope = v; } });
  const toggle = nodes(view, (v) => v.type === 'button' && v.props['aria-expanded'] !== undefined)[0];
  assert.equal(toggle.props['aria-expanded'], true); toggle.props.onClick(); assert.equal(open, false);
  assert.equal(nodes(view, (v) => v.type === 'table').length, 1);
  assert.ok(nodes(view, (v) => v.props?.['data-total'] === 100).length, 'selected-seat aggregate footer');
  assert.equal(nodes(view, (v) => v.type === 'img').length, 0, 'operator name is plain text');
  assert.ok(nodes(view, (v) => v.type === 'td').some((v) => v.props.children === '100'));
  nodes(view, (v) => v.type === 'button' && v.props['data-scope'] === 'current')[0].props.onClick(); assert.equal(scope, 'current');
  const current = mod.DamageView({ packet, ownerId: 'p1', open: true, scope: 'current' });
  assert.ok(nodes(current, (v) => v.type === 'td').some((v) => v.props.children === '10'));
  assert.equal(nodes(mod.DamageView({ packet, ownerId: 'p1', open: false }), (v) => v.type === 'table').length, 0);
  assert.equal(nodes(mod.DamageView({ packet, ownerId: 'p2', open: true }), (v) => v.type === 'td').length, 0, 'no cached unrelated owner');
});
test('damage panel flows below ready controls in the right HUD column, with pass-through outside its footprint', () => {
  const game = readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.match(game, /damagePanel=\$\{html`<\$\{DamageBoard\} ownerId=\$\{strip.ownerId\}/);
  assert.equal([...game.matchAll(/<\$\{DamageBoard\}/g)].length, 1, 'one panel instance');
  const hud = readFileSync(new URL('../../public/js/ui/hud.js', import.meta.url), 'utf8');
  const right = hud.slice(hud.indexOf('<div class="gtop__right">'));
  assert.ok(right.indexOf('<${ReadyToggle}') >= 0);
  assert.ok(right.indexOf('${damagePanel}') > right.indexOf('<${ReadyToggle}'), 'shared right column keeps the panel after ready');
  const css = readFileSync(new URL('../../public/css/screens/damage-board.css', import.meta.url), 'utf8');
  assert.match(css, /pointer-events: none/); assert.match(css, /overflow-y: auto/);
  assert.match(css, /\.damage-board\s*\{[^}]*position: relative/);
  const detachedOverlay = /(?:^|[;{])\s*(?:bottom\s*:|position\s*:\s*(?:fixed|absolute)\b)/;
  assert.doesNotMatch('.panel { border-bottom: 1px solid; position: relative; }', detachedOverlay, 'border-bottom is not bottom');
  for (const declaration of ['bottom: 0', 'position: fixed', 'position: absolute']) {
    assert.match(`.panel { ${declaration}; }`, detachedOverlay, `detect ${declaration}`);
    assert.match(`border: 0; ${declaration}`, detachedOverlay, `detect after semicolon: ${declaration}`);
    assert.match(declaration, detachedOverlay, `detect at start: ${declaration}`);
  }
  assert.doesNotMatch(css, detachedOverlay, 'no detached corner overlay');
});
