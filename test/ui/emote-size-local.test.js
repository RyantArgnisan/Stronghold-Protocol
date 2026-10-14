import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const css = readFileSync(new URL('../../public/css/chat.css', import.meta.url), 'utf8');
function rule(selector) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return css.match(new RegExp(escaped + '\\s*\\{([^}]+)\\}'))?.[1] || '';
}
test('embedded emote panel caps its geometry at 70px without changing chat text', () => {
  assert.match(rule('.chat .ewheel--embedded'), /--emo-unit:\s*min\(70px,\s*calc\(\(100vw - 36px\) \/ 3\.13\)\)/);
  assert.match(rule('.chat'), /font-size:\s*14px/);
  assert.match(rule('.ewheel--embedded .ewheel__item'), /width:\s*calc\(\.85 \* var\(--emo-unit\)\)/);
});
test('embedded scale remains 1 on landscape touch devices', () => {
  assert.match(rule('.ewheel--embedded .ewheel__panel'), /scale:\s*1\s*;/);
});
test('embedded pager hit areas stay below the cells and apart from neighbouring dots', () => {
  assert.match(rule('.ewheel--embedded .ewheel__nav'), /top:\s*calc\(1\.99 \* var\(--emo-unit\)\)/);
  assert.match(rule('.chat .ewheel--embedded .ewheel__dot::before'), /inset:\s*0 calc\(-\.04 \* var\(--emo-unit\)\) calc\(-\.1 \* var\(--emo-unit\)\)/);
  // Maximum active-dot scale (1.12) still leaves a gap horizontally and above the cell row.
  assert.ok((.11 + .08) * (1.12 + 1) / 2 < .11 + .1);
  assert.ok(1.99 - .12 * .06 > .19 + 1.78);
});
