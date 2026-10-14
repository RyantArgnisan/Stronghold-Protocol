import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

test('damage panel hides behind an actual detail card without an unsupported parent CSS selector', () => {
  const css = fs.readFileSync(new URL('../../public/css/screens/damage-board.css', import.meta.url), 'utf8');
  const game = fs.readFileSync(new URL('../../public/js/screens/game.js', import.meta.url), 'utf8');
  assert.match(game, /resolved && 'has-detail'/);
  assert.match(css, /\.gm\.has-detail \.damage-board\s*\{\s*visibility:\s*hidden/);
  assert.doesNotMatch(css, /:has\(/);
});
