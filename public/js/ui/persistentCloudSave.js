// Scoped bearer authorization, never a stored recovery password. HTTP still exposes tokens: see panel warning.
import { requestCloudSave, mergeCloudStats } from './cloudSave.js';
import { validCloudIdentity } from '../../../shared/cloudSave.js';
export function createPersistentCloudUpload({ getIdentity, request = requestCloudSave, storage = globalThis.localStorage, schedule = setTimeout, cancel = clearTimeout }) {
 let auth = null, identityKey = null, generation = 0, queue = [], timer = null, running = false, abort = null, retries = 0, resuming = null;
 const seen = new Set(), listeners = new Set();
 let state = { enabled: false, enabledAt: null, authorized: false, status: 'off', error: null, pending: 0, updatedAt: null };
 const keyFor = name => `sp.cloud.auth.${encodeURIComponent(name)}`;
 const publish = patch => { state = { ...state, ...patch, pending: queue.length }; for (const f of listeners) { try { f(state); } catch {} } };
 const save = () => {
  if (!auth) return;
  const value = JSON.stringify({ v: 1, token: auth.token, queue });
  storage.setItem(keyFor(auth.name), value);
  if (storage.getItem(keyFor(auth.name)) !== value) throw new Error('LOCAL_WRITE');
 };
 const reset = () => { generation++; abort?.abort(); abort = null; if (timer !== null) cancel(timer); timer = null; auth = null; identityKey = null; queue = []; seen.clear(); retries = 0; resuming = null; publish({ enabled: false, enabledAt: null, authorized: false, status: 'off', error: null, updatedAt: null }); };
 const current = epoch => epoch === generation && identityKey === getIdentity().key;
 const apply = result => publish({ enabled: result.auto.enabled, enabledAt: result.auto.enabledAt, authorized: true, status: result.auto.enabled ? 'ready' : 'off', error: null });
 const pump = async () => {
  if (running || timer !== null) return;
  running = true;
  try {
   while (auth && state.enabled && queue.length) {
    const epoch = generation, credential = auth;
    if (!current(epoch)) { await identityChanged(); break; }
    abort = new AbortController(); publish({ status: 'uploading', error: null });
    try {
     const result = await request('append', { ...credential, records: [queue[0]] }, undefined, { signal: abort.signal });
     if (!current(epoch)) continue;
     queue.shift(); save(); retries = 0; publish({ status: 'ready', updatedAt: result.updatedAt });
    } catch (e) {
     if (!current(epoch)) continue;
     if (['NETWORK','RATE','STORAGE'].includes(e.message) && retries++ < 2) {
      publish({ status: 'retry', error: e.message });
      timer = schedule(() => { if (!current(epoch)) return; timer = null; void pump(); }, e.message === 'RATE' ? 60000 : 5000 * retries); break;
     }
     if (e.message === 'AUTH') { storage.removeItem(keyFor(credential.name)); reset(); }
     publish({ enabled: false, status: 'error', error: e.message }); break;
    } finally { if (current(epoch)) abort = null; }
   }
  } finally { running = false; if (auth && state.enabled && queue.length && timer === null && state.status !== 'error') void pump(); }
 };
 const resume = async () => {
  const identity = getIdentity();
  if (!identity.key) return false;
  if (auth && identityKey === identity.key) return state.authorized;
  if (resuming) return resuming;
  identityKey = identity.key; const epoch = generation;
  resuming = (async () => {
   try {
    const saved = JSON.parse(storage?.getItem(keyFor(identity.name)) || 'null');
    if (!saved || !/^[a-f0-9]{64}$/.test(saved.token)) return false;
    const credential = { name: identity.name, token: saved.token };
    const result = await request('state', credential);
    if (!current(epoch)) return false;
    auth = credential; apply(result);
    queue = Array.isArray(saved.queue) && result.auto.enabled ? saved.queue.filter(r => r?.id && Number.isFinite(r.t) && r.t >= result.auto.enabledAt).slice(0,32) : [];
    for (const r of queue) seen.add(r.id);
    save(); publish({}); void pump(); return true;
   } catch (e) { if (current(epoch)) { if (e.message === 'AUTH') storage?.removeItem(keyFor(identity.name)); publish({ status: 'error', error: e.message }); } return false; }
   finally { if (epoch === generation) resuming = null; }
  })();
  return resuming;
 };
 const identityChanged = async () => {
  if (identityKey !== null && identityKey !== getIdentity().key) {
   const previous = auth;
   if (previous) { try { storage.removeItem(keyFor(previous.name)); } catch {} }
   reset();
   if (previous) void request('revoke', previous).catch(() => {});
  }
  return resume();
 };
 const authorize = async (password, enabled) => {
  const identity = getIdentity();
  if (!identity.key || !validCloudIdentity(identity.name, 'xxxxxxxx')) throw new Error('IDENTITY');
  if (!validCloudIdentity(identity.name, password)) throw new Error('PASSWORD');
  reset(); identityKey = identity.key; const epoch = generation;
  const result = await request('authorize', { name: identity.name, password, ...(enabled !== undefined ? { enabled } : {}) });
  if (!current(epoch)) { void request('revoke', { name: identity.name, token: result.token }).catch(() => {}); throw new Error('IDENTITY'); }
  auth = { name: identity.name, token: result.token }; apply(result);
  try { save(); } catch (e) { publish({ enabled: false, status: 'error', error: e.message }); throw e; }
  return true;
 };
 return {
  get: () => state, subscribe: f => { listeners.add(f); return () => listeners.delete(f); }, resume, identityChanged, authorize,
  async refreshStats() {
   if (!await resume() || !auth) return false;
   const epoch = generation, credential = auth;
   const result = await request('read', credential);
   if (!current(epoch)) return false;
   apply(result);
   return mergeCloudStats(result.stats, storage, () => current(epoch));
  },
  async enable(password, confirm) { const identity = getIdentity(); if (!await confirm()) return false; if (identity.key !== getIdentity().key) throw new Error('IDENTITY'); return authorize(password, true); },
  async disable() {
   if (!auth) throw new Error('AUTH');
   const credential = auth, identity = identityKey; reset(); identityKey = identity; auth = credential; const epoch = generation;
   try { const result = await request('settings', { ...credential, enabled: false }); if (!current(epoch)) return; apply(result); save(); }
   catch (e) { if (current(epoch)) publish({ enabled: false, status: 'error', error: e.message }); throw e; }
  },
  enqueue(record) {
   if (!auth || !state.enabled || identityKey !== getIdentity().key || !record?.id || !Number.isFinite(record.t) || record.t < state.enabledAt || seen.has(record.id)) return;
   if (queue.length >= 32) { publish({ enabled: false, status: 'error', error: 'QUEUE' }); return; }
   seen.add(record.id); if (seen.size > 1000) seen.delete(seen.values().next().value);
   queue.push(JSON.parse(JSON.stringify(record)));
   try { save(); publish({}); void pump(); } catch (e) { publish({ enabled: false, status: 'error', error: e.message }); }
  },
 };
}
