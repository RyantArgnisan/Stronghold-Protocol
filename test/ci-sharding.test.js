// The complete matrix remains intact: sharding partitions discovered files, never filters test names.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const workflow = fs.readFileSync(new URL('../.github/workflows/ci.yml', import.meta.url), 'utf8');

test('CI keeps both OS/Node lines and runs all four complementary shards under the same timeout', () => {
  assert.match(workflow, /os: \[ubuntu-latest, windows-latest\]/);
  assert.match(workflow, /node: \[22, 24\]/);
  assert.match(workflow, /shard: \[1, 2, 3, 4\]/);
  assert.match(workflow, /run: node --test --test-shard=\$\{\{ matrix\.shard \}\}\/4/);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.doesNotMatch(workflow, /--test-(?:skip|name)-pattern/);
});

test('Node discovery across complementary shards executes every fixture once and propagates failures', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sp-ci-shards-'));
  // This probe is a new test-runner root, not a child file of the enclosing runner.
  const { NODE_TEST_CONTEXT: _context, ...env } = process.env;
  try {
    fs.mkdirSync(path.join(dir, 'test'));
    for (let i = 0; i < 8; i++) fs.writeFileSync(path.join(dir, 'test', `${i}.test.mjs`),
      `import { test } from 'node:test'; test('fixture-${i}', () => {});\n`);
    const seen = [];
    for (let i = 1; i <= 4; i++) {
      const r = spawnSync(process.execPath, ['--test', '--test-reporter=tap', `--test-shard=${i}/4`], {
        cwd: dir, env, encoding: 'utf8', timeout: 15000,
      });
      assert.equal(r.status, 0, r.stderr);
      seen.push(...[...r.stdout.matchAll(/^ok \d+ - fixture-(\d+)$/gm)].map((m) => Number(m[1])));
    }
    assert.deepEqual(seen.sort((a, b) => a - b), Array.from({ length: 8 }, (_, i) => i));
    fs.writeFileSync(path.join(dir, 'test', '0.test.mjs'),
      "import { test } from 'node:test'; test('fixture-0', () => { throw new Error('expected failure'); });\n");
    const codes = [];
    for (let i = 1; i <= 4; i++) codes.push(spawnSync(process.execPath,
      ['--test', `--test-shard=${i}/4`], { cwd: dir, env, encoding: 'utf8', timeout: 15000 }).status);
    assert.equal(codes.filter((code) => code === 1).length, 1, 'the shard containing a broken test must fail');
    assert.equal(codes.filter((code) => code === 0).length, 3);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
