export { createPersistentCloudUpload } from './persistentCloudSave.js';
import { normalizeRecord, MAX_RECORDS, MAX_CHARS } from '../../../shared/statsRecords.js';
import { CLOUD_KEYS, validCloudPayload, validCloudIdentity } from '../../../shared/cloudSave.js';

// Read-only cloud refresh is a union: local copies win duplicate IDs, never prune/compact local history.
export async function mergeCloudStats(incoming, storage = globalThis.localStorage, guard = () => true) {
  if (!validCloudPayload({ v: 1, stats: incoming })) throw new Error('INVALID');
  let local;
  try { local = JSON.parse(storage.getItem(CLOUD_KEYS.stats) || '{"v":1,"records":[]}'); } catch { throw new Error('INVALID'); }
  if (!validCloudPayload({ v: 1, stats: local })) throw new Error('INVALID');
  const byId = new Map(incoming.records.map(r => { const n = normalizeRecord(r); return [n.id, n]; }));
  for (const record of local.records) byId.set(record.id, record);
  const records = [...byId.values()].sort((a,b) => b.t - a.t || a.id.localeCompare(b.id));
  if (records.length > MAX_RECORDS || JSON.stringify(records).length > MAX_CHARS - 40) throw new Error('TOO_LARGE');
  const next = { v: 1, records };
  if (JSON.stringify(next) === JSON.stringify(local)) return false;
  if (!guard()) throw new Error('IDENTITY');
  const before = storage.getItem(CLOUD_KEYS.stats);
  const backup = JSON.stringify({ v: 1, at: new Date().toISOString(), values: { [CLOUD_KEYS.stats]: before } });
  try { storage.setItem('sp.cloud.backup.latest', backup); if (storage.getItem('sp.cloud.backup.latest') !== backup) throw new Error(); } catch { throw new Error('LOCAL_BACKUP'); }
  try { const value = JSON.stringify(next); storage.setItem(CLOUD_KEYS.stats, value); if (storage.getItem(CLOUD_KEYS.stats) !== value) throw new Error(); }
  catch {
    try { if (before === null) storage.removeItem(CLOUD_KEYS.stats); else storage.setItem(CLOUD_KEYS.stats, before); if (storage.getItem(CLOUD_KEYS.stats) !== before) throw new Error(); } catch { throw new Error('LOCAL_ROLLBACK'); }
    throw new Error('LOCAL_WRITE');
  }
  return true;
}

export async function requestCloudSave(action, fields, fetcher = globalThis.fetch, { signal } = {}) {
  if (!['upload', 'restore', 'append', 'authorize', 'state', 'settings', 'read', 'revoke'].includes(action)) throw new Error('INVALID');
  if (!validCloudIdentity(fields.name, 'x'.repeat(8))) throw new Error('IDENTITY');
  if (!fields.token && !validCloudIdentity(fields.name, fields.password)) throw new Error('PASSWORD');
  let response, body;
  try {
    response = await fetcher(`/api/cloud-save/${action}`, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(fields), signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) });
    body = await response.json();
  } catch { throw new Error('NETWORK'); }
  if (!response.ok || !body.ok) throw new Error(['AUTH', 'DISABLED', 'RATE', 'INVALID', 'STORAGE', 'TOO_LARGE'].includes(body.error) ? body.error : 'NETWORK');
  return body;
}

export function snapshotCloudSave(selection, storage = globalThis.localStorage) {
  const read = (key, fallback) => JSON.parse(storage.getItem(key) || JSON.stringify(fallback));
  const payload = { v: 1 };
  if (selection.stats) payload.stats = read(CLOUD_KEYS.stats, { v: 1, records: [] });
  if (selection.operators) {
    const loadout = read(CLOUD_KEYS.loadout, { v: 1, entries: {}, ops: {} });
    if (loadout?.v === 1 && loadout.ops === undefined) loadout.ops = {};
    payload.operators = { loadout, skins: read(CLOUD_KEYS.skins, { v: 1, skins: {} }) };
  }
  if (!validCloudPayload(payload)) throw new Error('INVALID');
  return payload;
}

export async function restoreCloudSave(payload, selection, confirm, storage = globalThis.localStorage) {
  if (!validCloudPayload(payload)) throw new Error('INVALID');
  if (!selection.stats && !selection.operators) throw new Error('INVALID');
  if (selection.stats && !payload.stats || selection.operators && !payload.operators) throw new Error('MISSING_GROUP');
  const values = {};
  if (selection.stats) values[CLOUD_KEYS.stats] = JSON.stringify(payload.stats);
  if (selection.operators) {
    values[CLOUD_KEYS.loadout] = JSON.stringify(payload.operators.loadout);
    values[CLOUD_KEYS.skins] = JSON.stringify(payload.operators.skins);
  }
  // Confirmation is before *any* mutation, including the backup.
  if (!await confirm()) return false;
  const before = Object.fromEntries(Object.keys(values).map((k) => [k, storage.getItem(k)]));
  try {
    const backup = JSON.stringify({ v: 1, at: new Date().toISOString(), values: before });
    storage.setItem('sp.cloud.backup.latest', backup);
    if (storage.getItem('sp.cloud.backup.latest') !== backup) throw new Error('backup readback');
  } catch { throw new Error('LOCAL_BACKUP'); }
  try {
    for (const [key, value] of Object.entries(values)) {
      storage.setItem(key, value);
      if (storage.getItem(key) !== value) throw new Error('write readback');
    }
  } catch {
    let failed = false;
    for (const [key, value] of Object.entries(before)) {
      try {
        if (storage.getItem(key) === value) continue;
        if (value === null) storage.removeItem(key); else storage.setItem(key, value);
        if (storage.getItem(key) !== value) failed = true;
      } catch { failed = true; }
    }
    throw new Error(failed ? 'LOCAL_ROLLBACK' : 'LOCAL_WRITE');
  }
  return true;
}

// Page-lifetime authorization only; no credential/preferences persistence.
export function createAutoCloudUpload({ getIdentity, request = requestCloudSave, schedule = setTimeout, cancel = clearTimeout }) {
  let credential = null, pendingKey = null, generation = 0, queue = [], running = false, timer = null, abort = null, retries = 0;
  const seen = new Set(), listeners = new Set();
  let state = { enabled: false, status: 'off', error: null, pending: 0, updatedAt: null };
  const publish = (patch) => {
    state = { ...state, ...patch, pending: queue.length };
    for (const listener of listeners) { try { listener(state); } catch { /* Observer cannot interrupt upload. */ } }
  };
  const disable = (error = null) => {
    generation++; credential = null; pendingKey = null; queue = []; seen.clear(); retries = 0;
    if (timer !== null) cancel(timer); timer = null;
    abort?.abort(); abort = null;
    publish({ enabled: false, status: error ? 'error' : 'off', error, updatedAt: null });
  };
  const identityChanged = () => {
    const key = credential?.key ?? pendingKey;
    if (key !== null && key !== getIdentity().key) disable();
  };
  const pump = async () => {
    if (running || timer !== null) return;
    running = true;
    try {
      while (credential && queue.length) {
        identityChanged(); if (!credential) break;
        const epoch = generation, current = credential, record = queue[0];
        abort = new AbortController();
        publish({ status: 'uploading', error: null });
        try {
          const result = await request('append', { name: current.name, password: current.password, records: [record] }, undefined, { signal: abort.signal });
          if (epoch !== generation) continue;
          identityChanged(); if (!credential) continue;
          queue.shift(); retries = 0; publish({ status: 'ready', updatedAt: result.updatedAt });
        } catch (error) {
          if (epoch !== generation) continue;
          if (['NETWORK', 'RATE', 'STORAGE'].includes(error.message) && retries++ < 2) {
            publish({ status: 'retry', error: error.message });
            timer = schedule(() => { if (epoch !== generation) return; timer = null; void pump(); }, error.message === 'RATE' ? 60000 : 5000 * retries);
            break;
          }
          disable(error.message);
        } finally { if (epoch === generation) abort = null; }
      }
    } finally { running = false; }
  };
  return {
    get: () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    disable, identityChanged,
    async enable(password, confirm) {
      disable(); const epoch = generation, identity = getIdentity(); pendingKey = identity.key;
      try {
        if (!validCloudIdentity(identity.name, 'x'.repeat(8))) throw new Error('IDENTITY');
        if (!validCloudIdentity(identity.name, password)) throw new Error('PASSWORD');
        if (!await confirm()) { if (epoch === generation) disable(); return false; }
        if (epoch !== generation || getIdentity().key !== identity.key) throw new Error('IDENTITY');
        abort = new AbortController();
        // Validate without applying downloaded data. Missing saves need deliberate manual upload first.
        await request('restore', { name: identity.name, password }, undefined, { signal: abort.signal });
        if (epoch !== generation || getIdentity().key !== identity.key) throw new Error('IDENTITY');
        abort = null; pendingKey = null; credential = { ...identity, password };
        publish({ enabled: true, status: 'ready', error: null }); return true;
      } catch (error) { if (epoch === generation) disable(error.message); throw error; }
    },
    enqueue(record) {
      identityChanged(); if (!credential || !record?.id || seen.has(record.id)) return;
      if (queue.length >= 32) { disable('QUEUE'); return; }
      seen.add(record.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
      queue.push(JSON.parse(JSON.stringify(record))); publish({}); void pump();
    },
  };
}
