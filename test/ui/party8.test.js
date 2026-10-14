import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSeats, roomFacts } from '../../public/js/screens/room.js';

test('runner b.progress retains all six unite leakers without changing boss per-field limits', async () => {
  const { createBattleRunner } = await import('../../public/js/battle/runner.js');
  const { createStore, initialState } = await import('../../public/js/store.js');
  const { makeMatch, DATA } = await import('../match/harness.js');
  const specMod = await import('../../server/sim/spec.js');
  const { DataSource } = await import('../../server/sim/simdata.js');
  const { PHASE } = await import('../../shared/constants.js');
  const h = makeMatch({ mode: 'coop', difficulty: 'NORMAL', humans: 1, bots: 1, seed: 7301, captureFrames: false, clientCombat: true, clients: false });
  h.autoHumans(); h.m.start();
  h.run(() => h.m.phase === PHASE.COMBAT && h.m.round === 1);
  const start = h.lastTo('p_0', 'b.start');
  h.m.dispose();
  assert.ok(start?.authoritative);
  const left = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`p_${i}`, i + 1]));
  const handlers = new Map(), sent = [], frames = [];
  let clock = 1000;
  const net = {
    on(type, fn) { handlers.set(type, fn); return () => handlers.delete(type); },
    send(type, fields) { sent.push({ t: type, ...fields }); return true; },
    request: async () => ({ t: 'ok' }),
  };
  const runner = createBattleRunner({ net, store: createStore(initialState), doc: { hidden: false, addEventListener() {} }, now: () => clock,
    raf: (fn) => { frames.push(fn); return frames.length; }, caf() {}, setInterval: () => 1, clearInterval() {},
    loadSim: async () => ({ ds: new DataSource(DATA, null), spec: { ...specMod, battleProgress: (battle) => ({ ...specMod.battleProgress(battle), left }) } }),
    logger: { error() {}, warn() {}, info() {}, debug() {} },
  });
  try {
    handlers.get('b.start')(start);
    for (let i = 0; i < 8; i++) {
      await new Promise((resolve) => setImmediate(resolve));
      clock += 250;
      for (const fn of frames.splice(0)) fn(clock);
    }
    const progress = sent.find((m) => m.t === 'b.progress');
    assert.ok(progress, 'real runner emitted progress');
    assert.deepEqual(progress.left, left, 'P5/P6 leaker counts are not truncated');
  } finally { runner.dispose(); }
});

test('capacity selector has a visible styled control, not an unstyled inline dropdown', async () => {
  const { readFileSync } = await import('node:fs');
  const css = readFileSync(new URL('../../public/css/screens/lobby.css', import.meta.url), 'utf8');
  assert.match(css, /\.capacity-picker\s*\{/);
  assert.match(css, /\.capacity-picker select\s*\{/);
});

const players = (n) => Array.from({ length: n }, (_, seat) => ({ seat, playerId: `p${seat}`, name: `Doctor ${seat + 1}`, ready: true, connected: true }));

test('room seats use declared 4–8 capacity, not global maximum; legacy rooms keep their actual length', () => {
  for (let capacity = 4; capacity <= 8; capacity++) {
    const seats = players(capacity);
    assert.equal(normalizeSeats({ mode: 'coop', capacity, seats }).length, capacity);
    assert.equal(roomFacts({ mode: 'coop', capacity, seats, hostId: 'p0' }, 'p0').humans.length, capacity);
  }
  assert.equal(normalizeSeats({ mode: 'coop', seats: players(4) }).length, 4);
  assert.equal(normalizeSeats({ mode: 'coop', seats: players(7) }).length, 7);
  assert.equal(normalizeSeats({ mode: 'coop' }).length, 4);
  assert.equal(normalizeSeats({ mode: 'solo', capacity: 8, seats: players(8) }).length, 1);
  assert.equal(normalizeSeats({ mode: 'coop', capacity: 8, seats: [players(1)[0]] }).filter((s) => s === null).length, 7);
});

test('capacity selector offers 4/5/6/7/8 and creates eight-seat co-op by default, solo stays one', async () => {
  const lobby = await import('../../public/js/screens/lobby.js');
  assert.equal(typeof lobby.CapacityPicker, 'function');
  assert.equal(typeof lobby.createRoomFields, 'function');
  assert.deepEqual(lobby.createRoomFields('coop', 'FUNNY'), { mode: 'coop', difficulty: 'FUNNY', capacity: 8 });
  assert.deepEqual(lobby.createRoomFields('coop', 'HARD', 5), { mode: 'coop', difficulty: 'HARD', capacity: 5 });
  assert.deepEqual(lobby.createRoomFields('solo', 'FUNNY', 8), { mode: 'solo', difficulty: 'FUNNY', capacity: 1 });
  const view = lobby.CapacityPicker({ capacity: 8, onChange() {} });
  const options = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'option') options.push(n.props.value);
    for (const ch of [n.props?.children].flat(Infinity)) walk(ch);
  }
  walk(view);
  assert.deepEqual(options, [4, 5, 6, 7, 8]);
});

test('extended SP draft exposes all ten independently pickable cards including slots 7–10', async () => {
  const { normalizeSp } = await import('../../public/js/ui/gameLogic/draft.js');
  const { ChoiceView, cardPickable } = await import('../../public/js/ui/choiceOverlay.js');
  const sp = normalizeSp({ cards: Array.from({ length: 12 }, (_, idx) => ({ id: `card${idx}`, name: `Card ${idx}` })), order: players(8).map((p) => p.playerId), turn: 'p7', picks: { p6: 6 } }, players(8));
  assert.equal(sp.cards.length, 10);
  assert.equal(sp.pickOf.get('p6'), 6);
  assert.equal(cardPickable(sp, sp.cards[9], { myId: 'p7', solo: false }), true);
  const view = ChoiceView({ pub: { players: players(8) }, sp, myId: 'p7', solo: false });
  const buttons = [];
  function walk(n) {
    if (!n || typeof n !== 'object') return;
    if (n.type === 'button') buttons.push(n);
    for (const ch of [n.props?.children].flat(Infinity)) walk(ch);
  }
  walk(view);
  assert.equal(buttons.filter((b) => String(b.props.class).includes('spcard')).length, 10);
});

test('saved result and replay retain P7 and P8, bounded to eight player rows', async () => {
  const { buildRecord, recordToResult, normalizeRecord } = await import('../../public/js/ui/stats.js');
  const result = { victory: true, modeId: 'mode_multi_funny', players: players(8) };
  const record = buildRecord(result, { myId: 'p7', roomMode: 'coop', now: 1 });
  assert.equal(record.players.length, 8);
  assert.equal(record.players[7].playerId, 'p7');
  assert.equal(recordToResult(record).players.length, 8);
  assert.equal(normalizeRecord({ ...record, players: players(20) }).players.length, 8);
});

test('eight-seat waiting/draft/team/result layout scrolls and all eight avatar colours are distinct', async () => {
  const { PlayerAvatar } = await import('../../public/js/ui/gameComponents.js');
  const { readFileSync } = await import('node:fs');
  assert.equal(new Set(players(8).map((player) => PlayerAvatar({ player }).props.style)).size, 8);
  const css = (f) => readFileSync(new URL(`../../public/css/${f}`, import.meta.url), 'utf8');
  assert.ok(/overflow-y: auto/.test(css('screens/room.css')), 'waiting room can scroll two seat rows');
  assert.ok(/max-width: 900px/.test(css('screens/room.css')), 'two columns on narrow screens');
  assert.ok(/max-width: 480px/.test(css('screens/room.css')), 'one column on very narrow screens');
  assert.ok(/spov__grid--extended/.test(css('screens/game-panels.css')), 'ten cards have their own responsive scroll layout');
  const draft = readFileSync(new URL('../../public/js/screens/bandDraft.js', import.meta.url), 'utf8');
  assert.ok(!draft.includes('who.slice(0, 4)'), 'all band owners remain visible');
});
