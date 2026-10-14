// Real networking + real browser chat smoke for the local eight-player build.
// Needs a separate staging server and a HOST Chrome CDP endpoint, both bound to loopback.
// Opt-in: SP_LOCAL8_E2E=1 SP_URL=http://127.0.0.1:3001
//   SP_CDP=http://127.0.0.1:9223 node test/e2e/local8-chat-smoke.mjs
// Two browser players + six WebSocket players; one browser spectator and a rejected ninth player.
import assert from 'node:assert/strict';
import puppeteer from 'puppeteer-core';
import { TestClient } from '../helpers/wsClient.js';

// node --test discovers helpers under test/ too; never mutate a staging/live server implicitly.
if (process.env.SP_LOCAL8_E2E !== '1') process.exit(0);

const base = process.env.SP_URL || 'http://127.0.0.1:3001';
const cdp = process.env.SP_CDP || 'http://127.0.0.1:9223';
const out = process.env.SP_SMOKE_OUT || '/scratch';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const browser = await puppeteer.connect({ browserURL: cdp, protocolTimeout: 60000 });
const contexts = [], pages = [], clients = [], members = new Map();
const checks = [];
const mark = (name) => { checks.push(name); console.log(`PASS ${name}`); };
const request = (page, t, fields = {}) => page.evaluate((t, fields) => globalThis.__SP__.net.request(t, fields), t, fields);
const state = (page) => page.evaluate(() => {
  const s = globalThis.__SP__.store.get();
  return { me: s.me.playerId, room: s.room, public: s.match.public,
    chat: { code: s.chat.code, lastId: s.chat.lastId, count: s.chat.messages.length, open: s.chat.open } };
});
const waitPhase = (page, phase) => page.waitForFunction((phase) => globalThis.__SP__.store.get().match.public?.phase === phase, { timeout: 30000 }, phase);
async function player(name) {
  const context = await browser.createBrowserContext(); contexts.push(context);
  const page = await context.newPage(); pages.push(page);
  await page.setViewport({ width: 1280, height: 720 });
  const problems = [];
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    if (m.type() === 'error' && !/fonts\.(googleapis|gstatic)\.com/.test(m.location()?.url || '') && !/Failed to load resource/.test(m.text())) problems.push(m.text());
  });
  page.on('response', (r) => { if (r.url().startsWith(base) && r.status() >= 400) problems.push(`HTTP ${r.status()}: ${r.url()}`); });
  page.on('requestfailed', (r) => {
    if (r.url().startsWith(base) && r.failure()?.errorText !== 'net::ERR_ABORTED') problems.push(`request failed: ${r.url()}`);
  });
  await page.evaluateOnNewDocument((name) => {
    localStorage.setItem('sp.name', name); sessionStorage.setItem('sp.entered', '1');
    localStorage.setItem('sp.lang', 'zh');
  }, name);
  await page.goto(base, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && document.querySelector('.lobby-screen'), { timeout: 45000 });
  await page.evaluate(() => {
    const net = globalThis.__SP__.net, original = net.request.bind(net);
    globalThis.__chatRequests = [];
    net.request = (t, fields, opts) => { globalThis.__chatRequests.push(t); return original(t, fields, opts); };
  });
  page.problems = problems;
  return page;
}
async function raw(name) {
  const client = await TestClient.connect(base.replace(/^http/, 'ws') + '/ws', { timeout: 10000 });
  clients.push(client);
  const welcome = await client.hello(name);
  return { client, id: welcome.playerId };
}
async function openChat(page) {
  await page.bringToFront();
  if (!(await state(page)).chat.open) await page.click('.chat__toggle');
  await page.waitForSelector('.chat__input');
}
async function typeText(page, text) {
  await page.focus('.chat__input');
  await page.keyboard.down('Control'); await page.keyboard.press('A'); await page.keyboard.up('Control');
  await page.keyboard.type(text);
  await page.waitForFunction((text) => globalThis.__SP__.store.get().chat.draft === text, {}, text);
}
async function sendText(page, text) {
  const before = (await state(page)).chat.lastId;
  await openChat(page); await typeText(page, text); await page.keyboard.press('Enter');
  await page.waitForFunction((before, text) => globalThis.__SP__.store.get().chat.messages.some((m) => m.id > before && m.text === text), { timeout: 10000 }, before, text);
}
try {
  const host = await player('八人测试房主');
  await host.click('.mode-card:nth-child(1)');
  await host.click('.create-box button');
  await host.waitForFunction(() => globalThis.__SP__.store.get().room?.mode === 'solo');
  assert.equal((await state(host)).room.capacity, 1);
  assert.equal((await state(host)).room.seats.length, 1);
  await host.click('.room-screen button[aria-label="离开同盟"]');
  await host.waitForSelector('.lobby-screen');
  await host.click('.mode-card:nth-child(2)');
  await host.waitForSelector('.capacity-picker select');
  mark('actual solo creation UI still works with explicit capacity one');
  assert.equal(await host.$eval('.capacity-picker select', (el) => el.value), '8');
  await host.select('.capacity-picker select', '4'); await host.select('.capacity-picker select', '8');
  await host.click('.create-box button');
  await host.waitForFunction(() => !!globalThis.__SP__.store.get().room);
  const room = (await state(host)).room;
  assert.equal(room.capacity, 8); assert.equal(room.seats.length, 8);
  const code = room.code, hostId = (await state(host)).me;
  members.set(hostId, (t, fields) => request(host, t, fields));
  const guest = await player('八人测试队友');
  await request(guest, 'room.join', { code });
  await guest.waitForFunction(() => !!globalThis.__SP__.store.get().room);
  const guestId = (await state(guest)).me;
  members.set(guestId, (t, fields) => request(guest, t, fields));
  const seated = [];
  for (let i = 0; i < 6; i++) {
    const r = await raw(`八人测试P${i + 3}`); seated.push(r);
    assert.equal((await r.client.request({ t: 'room.join', code })).t, 'ok');
    members.set(r.id, (t, fields) => r.client.request({ t, ...fields }));
  }
  await host.waitForFunction(() => globalThis.__SP__.store.get().room.seats.filter(Boolean).length === 8);
  const ninth = await raw('第九人拒绝测试');
  assert.equal((await ninth.client.request({ t: 'room.join', code })).code, 'ROOM_FULL');
  mark('8 genuine player seats; ninth player rejected; real capacity selector');

  await openChat(host);
  await typeText(host, '中文输入法确认测试');
  const beforeIme = (await state(host)).chat.lastId;
  await host.$eval('.chat__input', (el) => {
    el.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }));
    el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true, isComposing: true }));
    el.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }));
  });
  await sleep(250);
  assert.equal((await state(host)).chat.lastId, beforeIme);
  await host.keyboard.press('Enter');
  await host.waitForFunction(() => globalThis.__SP__.store.get().chat.messages.some((m) => m.text === '中文输入法确认测试'));
  for (const r of seated) await r.client.waitFor('chat.message', (m) => m.text === '中文输入法确认测试', 10000);
  await guest.waitForSelector('.chat__unread');
  mark('Chinese UI Enter broadcasts to all eight players; simulated IME Enter does not send; folded unread');

  await sendText(guest, '<img src=x onerror="window.__chatXss=1">');
  await host.waitForFunction(() => [...document.querySelectorAll('.chat__text')].some((el) => el.textContent === '<img src=x onerror="window.__chatXss=1">'));
  assert.equal(await host.evaluate(() => !!window.__chatXss || !!document.querySelector('.chat__log img')), false);
  mark('hostile HTML remains literal text in the real DOM');

  const watcher = await player('聊天观战测试');
  await request(watcher, 'room.spectate', { code }); await openChat(watcher);
  assert.equal(await watcher.$eval('.chat__input', (el) => el.disabled), true);
  assert.equal((await state(watcher)).chat.count, 2);
  mark('spectator reads real room history and has disabled input');

  await host.click('.chat__moderation summary');
  await host.click(`.chat__mute[data-player-id="${guestId}"]`);
  await guest.waitForFunction(() => document.querySelector('.chat__input')?.disabled === true);
  const muted = await guest.evaluate(async () => { try { await globalThis.__SP__.net.request('chat.send', { clientId: 'muted-e2e', text: '不应发送' }); return null; } catch (e) { return e.code; } });
  assert.equal(muted, 'CHAT_MUTED');
  await host.click(`.chat__mute[data-player-id="${guestId}"]`);
  await guest.waitForFunction(() => document.querySelector('.chat__input')?.disabled === false);
  mark('actual host mute/unmute controls and server-side mute enforcement');

  await guest.reload({ waitUntil: 'domcontentloaded' });
  await guest.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && globalThis.__SP__.store.get().chat.messages.length === 2, { timeout: 45000 });
  assert.equal((await state(guest)).me, guestId);
  mark('real page reload resumes the same seated session and chat history');

  await guest.setViewport({ width: 844, height: 390, isMobile: true, hasTouch: true, deviceScaleFactor: 1 });
  // Switching mobile emulation can reload the document; wait for its real session/history restore.
  await guest.waitForFunction(() => globalThis.__SP__?.store.get().connection.status === 'online' && !!globalThis.__SP__.store.get().chat.code, { timeout: 45000 });
  await openChat(guest);
  const layout = await guest.$eval('.chat', (el) => { const r = el.getBoundingClientRect(); return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: innerWidth, height: innerHeight }; });
  assert.ok(layout.left >= -1 && layout.right <= layout.width + 1 && layout.top >= -1 && layout.bottom <= layout.height + 1, JSON.stringify(layout));
  await guest.screenshot({ path: `${out}/eight-chat-phone.png` });
  await host.bringToFront(); await host.screenshot({ path: `${out}/eight-chat-desktop.png` });
  mark('desktop and landscape-phone chat fit the real viewport (screenshots saved)');

  for (const [id, req] of members) if (id !== hostId) assert.equal((await req('room.ready', { ready: true })).t, 'ok');
  await request(host, 'room.start'); await waitPhase(host, 'INFO_CHECK');
  await sleep(1100); await sendText(host, '本局信息阶段可聊天');
  assert.ok(await watcher.waitForFunction(() => globalThis.__SP__.store.get().chat.messages.some((m) => m.text === '本局信息阶段可聊天')));
  for (const req of members.values()) assert.equal((await req('g.infoReady', {})).t, 'ok');
  await waitPhase(host, 'BAND_DRAFT');
  await sleep(1100); await sendText(host, '选人阶段可聊天');
  mark('chat stays mounted and networked through briefing and band draft');

  const bands = await (await fetch(`${base}/data/bands.json`)).json();
  const allowed = Object.keys(bands).filter((id) => !bands[id].modeTypeList || bands[id].modeTypeList.includes('MULTI'));
  const selected = new Set();
  for (let i = 0; i < 8; i++) {
    await host.waitForFunction(() => globalThis.__SP__.store.get().match.public?.draft?.turn != null);
    const turn = (await state(host)).public.draft.turn;
    let picked = false;
    for (const id of allowed.filter((id) => !selected.has(id))) {
      let reply; try { reply = await members.get(turn)('g.band', { bandId: id }); } catch { continue; }
      if (reply.t === 'ok') { selected.add(id); picked = true; break; }
    }
    assert.ok(picked, `band pick ${i + 1}`);
    await host.waitForFunction((turn) => globalThis.__SP__.store.get().match.public?.draft?.turn !== turn, {}, turn);
  }
  await waitPhase(host, 'PREP');
  await openChat(host);
  const requestsBefore = await host.evaluate(() => globalThis.__chatRequests.length);
  await typeText(host, 'rfdqx'); await host.keyboard.press('Space');
  const duringTyping = await host.evaluate((n) => globalThis.__chatRequests.slice(n), requestsBefore);
  assert.deepEqual(duringTyping, []);
  await host.keyboard.press('Escape');
  assert.equal((await state(host)).chat.open, false);
  await sleep(1100); await sendText(host, '休整期打字不触发快捷键');
  mark('eight unique band picks reach prep; actual typing suppresses gameplay hotkeys; Escape folds');
  for (const req of members.values()) assert.equal((await req('g.ready', { ready: true })).t, 'ok');
  await waitPhase(host, 'COMBAT');
  await sleep(1100); await sendText(host, '作战阶段可聊天');
  mark('text chat works during actual first combat with eight networked players');
  for (const page of pages) assert.deepEqual(page.problems, [], 'no local resource failures or browser exceptions');
  console.log(JSON.stringify({ passed: checks.length, checks, playerSeats: 8, browserPlayers: 2, websocketPlayers: 6, browserSpectators: 1 }));
} finally {
  for (const req of members.values()) { try { await req('room.leave', {}); } catch { /* already left/closed */ } }
  for (const client of clients) await client.close().catch(() => {});
  for (const context of contexts) await context.close().catch(() => {});
  browser.disconnect();
}
