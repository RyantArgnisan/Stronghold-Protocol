import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PHASE } from '../../shared/constants.js';

test('actual main result wiring excludes welcome/result replay but not a newly observed match', async () => {
  const source = await readFile(new URL('../../public/js/main.js', import.meta.url), 'utf8');
  assert.match(source, /import\s*\{[^}]*\bPHASE\b[^}]*\}\s*from ['"]\.\.\/\.\.\/shared\/constants\.js['"]/, 'main must import the phase constants it uses');
  assert.match(source, /function onWelcome\(msg\)\s*\{\s*recordLiveResult = false/);
  const start = source.indexOf("  net.on('m.public'");
  const end = source.indexOf("  net.on('m.toast'", start);
  const handlers = new Map(), recorded = [];
  const current = { me: { playerId: 'p' }, room: { mode: 'solo' } };
  const net = { on: (name, fn) => handlers.set(name, fn) };
  const store = { get: () => current, patch: () => {} };
  new Function('net','store','PHASE','data','payload','maybeFinishRestore','recordResult', 'let recordLiveResult = false, matchAt;\n'+source.slice(start,end))(net,store,PHASE,{ selectProfile: () => {}, ensureCore: () => Promise.resolve() }, x => x, () => {}, (r,ctx) => recorded.push(ctx.notifyNew));
  handlers.get('m.public')({ phase: PHASE.RESULT }); handlers.get('m.result')({});
  handlers.get('m.public')({ phase: PHASE.PREP }); handlers.get('m.result')({}); handlers.get('m.result')({});
  assert.deepEqual(recorded, [false, true, false]);
});
