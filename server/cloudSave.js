// Manual player backups and authenticated new-record append. One process owns this private, durable directory.
import { mkdir, readFile, open, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomBytes, timingSafeEqual, scrypt as scryptCallback } from 'node:crypto';
import { promisify } from 'node:util';
import { sendJson } from './http/common.js';
import { CLOUD_MAX_BYTES, validCloudIdentity, validCloudPayload } from '../shared/cloudSave.js';
import { mergeStats, fitToBudget } from '../shared/statsRecords.js';
const scrypt = promisify(scryptCallback);
const KDF = Object.freeze({ N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 });

// Collect Buffers before decoding: chunk boundaries can split Chinese UTF-8.
function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []; let bytes = 0;
    const timer = setTimeout(() => finish(new Error('TIMEOUT')), 10000);
    const finish = (error, value) => {
      clearTimeout(timer); req.off('data', data); req.off('end', end); req.off('error', errorHandler); req.off('aborted', aborted);
      if (error) { req.resume(); reject(error); } else resolve(value);
    };
    const data = (chunk) => {
      bytes += chunk.length;
      if (bytes > CLOUD_MAX_BYTES) finish(new Error('TOO_LARGE'));
      else chunks.push(chunk);
    };
    const end = () => { try { finish(null, JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { finish(new Error('INVALID')); } };
    const errorHandler = () => finish(new Error('INVALID'));
    const aborted = () => finish(new Error('INVALID'));
    req.on('data', data); req.once('end', end); req.once('error', errorHandler); req.once('aborted', aborted);
  });
}

// Windows cannot open/fsync directory descriptors through Node's regular file API.
// The temporary file is still fsynced before atomic rename on every platform.
export async function syncCloudSaveDirectory(dir, { platform = process.platform, openDirectory = open } = {}) {
  if (platform === 'win32') return;
  const directory = await openDirectory(dir, 'r');
  try { await directory.sync(); } finally { await directory.close(); }
}

export function createCloudSaveHandler({ dir, rate = 30 }) {
  let queue = Promise.resolve(), active = 0;
  const attempts = new Map();
  return async (req, res, route) => {
    const action = route.startsWith('/api/cloud-save/') ? route.slice('/api/cloud-save/'.length) : '';
    if (!['upload', 'restore', 'append', 'authorize', 'state', 'settings', 'read', 'revoke'].includes(action)) return false;
    const fail = (status, error) => { req.resume(); sendJson(req, res, status, { ok: false, error }); return true; };
    if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return fail(405, 'METHOD'); }
    if (!/^application\/json(?:;|$)/i.test(req.headers['content-type'] || '')) return fail(400, 'INVALID');
    if (req.headers.origin && ![`http://${req.headers.host}`, `https://${req.headers.host}`].includes(req.headers.origin)) return fail(403, 'ORIGIN');
    // Direct peer only: forwarded headers cannot bypass limits; loopback/LAN are not exempt.
    const now = Date.now(), address = req.socket.remoteAddress || 'unknown';
    for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key);
    if (!attempts.has(address)) {
      if (attempts.size >= 4096) return fail(429, 'RATE');
      attempts.set(address, { n: 0, until: now + 60000 });
    }
    if (++attempts.get(address).n > rate || active >= 4) { res.setHeader('Retry-After', '60'); return fail(429, 'RATE'); }
    if (Number(req.headers['content-length']) > CLOUD_MAX_BYTES) return fail(413, 'TOO_LARGE');
    active++;
    try {
      let body;
      try { body = await readBody(req); } catch (e) { return fail(e.message === 'TOO_LARGE' ? 413 : e.message === 'TIMEOUT' ? 408 : 400, e.message); }
      const { name, password, payload, records, token, enabled } = body || {};
      const append = action === 'append';
      const scoped = ['state', 'settings', 'read', 'revoke'].includes(action) || (append && token !== undefined);
      if (append && (!Array.isArray(records) || !records.length || records.length > 32 || !validCloudPayload({ v: 1, stats: { v: 1, records } }) || Object.keys(body).some(k => !['name', 'password', 'token', 'records'].includes(k)))) return fail(400, 'INVALID');
      if (!validCloudIdentity(name, scoped ? 'xxxxxxxx' : password)) return fail(scoped ? 403 : 400, scoped ? 'AUTH' : 'INVALID');
      if (action === 'upload' && !validCloudPayload(payload)) return fail(400, 'INVALID');
      if ((action === 'settings' || action === 'authorize' && enabled !== undefined) && typeof enabled !== 'boolean') return fail(400, 'INVALID');
      const file = path.join(dir, `${createHash('sha256').update(name).digest('hex')}.json`);
      // Serialize registration/auth/write so simultaneous names never overwrite each other's password.
      const previous = queue; let release;
      queue = new Promise((resolve) => { release = resolve; });
      await previous;
      try {
        let existing;
        try { existing = JSON.parse(await readFile(file, 'utf8')); } catch (e) { if (e.code !== 'ENOENT') throw e; }
        if (existing) {
          if (existing.v !== 1 || existing.name !== name || existing.auth?.kdf !== 'scrypt' || !/^[a-f0-9]{32}$/.test(existing.auth.salt) || !/^[a-f0-9]{64}$/.test(existing.auth.hash) || !validCloudPayload(existing.payload)) throw new Error('STORAGE');
          if (scoped) {
            if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) return fail(403, 'AUTH');
            const hash = createHash('sha256').update(token).digest('hex');
            if (!existing.autoSessions?.some(s => s.hash === hash && s.expiresAt > Date.now())) return fail(403, 'AUTH');
          } else {
            const candidate = await scrypt(password, existing.auth.salt, 32, KDF);
            if (!timingSafeEqual(candidate, Buffer.from(existing.auth.hash, 'hex'))) return fail(403, 'AUTH');
          }
        }
        if ((scoped || action === 'authorize') && !existing) return fail(403, 'AUTH');
        const persist = async record => {
          await mkdir(dir, { recursive: true, mode: 0o700 });
          const temporary = `${file}.${randomBytes(8).toString('hex')}.tmp`;
          try {
            const handle = await open(temporary, 'wx', 0o600);
            try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); } finally { await handle.close(); }
            await rename(temporary, file);
            await syncCloudSaveDirectory(dir);
          } finally { await unlink(temporary).catch(() => {}); }
        };
        if (['authorize', 'state', 'settings', 'read', 'revoke'].includes(action)) {
          existing.auto ??= { enabled: false, enabledAt: null };
          let issued;
          if (action === 'authorize') {
            issued = randomBytes(32).toString('hex');
            existing.autoSessions = [...(existing.autoSessions || []).filter(s => s.expiresAt > Date.now()).slice(-7), { hash: createHash('sha256').update(issued).digest('hex'), expiresAt: Date.now() + 30 * 86400000 }];
          }
          if ((action === 'settings' || action === 'authorize') && enabled !== undefined) {
            if (enabled && !existing.auto.enabled) existing.auto = { enabled: true, enabledAt: Date.now() };
            else if (!enabled) existing.auto = { enabled: false, enabledAt: null };
          }
          if (action === 'revoke') existing.autoSessions = (existing.autoSessions || []).filter(s => s.hash !== createHash('sha256').update(token).digest('hex'));
          if (['authorize', 'settings', 'revoke'].includes(action)) await persist(existing);
          sendJson(req, res, 200, { ok: true, auto: existing.auto, ...(issued ? { token: issued } : {}), ...(action === 'read' ? { stats: existing.payload.stats || { v: 1, records: [] } } : {}) });
          return true;
        }
        if (route.endsWith('/restore')) {
          if (!existing) return fail(403, 'AUTH');
          sendJson(req, res, 200, { ok: true, payload: existing.payload, updatedAt: existing.updatedAt });
          return true;
        }
        if (append && !existing) return fail(403, 'AUTH');
        if (append && scoped && (!existing.auto?.enabled || records.some(r => !Number.isFinite(r.t) || r.t < existing.auto.enabledAt))) return fail(403, 'DISABLED');
        const merged = append
          ? { ...existing.payload, stats: { v: 1, records: fitToBudget(mergeStats(existing.payload.stats, { records }).records) } }
          : { ...existing?.payload, ...payload };
        if (!validCloudPayload(merged)) return fail(413, 'TOO_LARGE');
        await mkdir(dir, { recursive: true, mode: 0o700 });
        let auth = existing?.auth;
        if (!auth) {
          const salt = randomBytes(16).toString('hex');
          auth = { kdf: 'scrypt', N: KDF.N, r: KDF.r, p: KDF.p, salt, hash: (await scrypt(password, salt, 32, KDF)).toString('hex') };
        }
        const record = { ...existing, v: 1, name, auth, payload: merged, updatedAt: new Date().toISOString() };
        await persist(record);
        sendJson(req, res, 200, { ok: true, updatedAt: record.updatedAt });
        return true;
      } finally { release(); }
    } catch { return fail(500, 'STORAGE'); } // Never log credentials/body/errors that could contain them.
    finally { active--; }
  };
}
