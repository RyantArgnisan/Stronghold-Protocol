import { store } from '../store.js';
import { createPersistentCloudUpload } from './cloudSave.js';
import { subscribeNewRecords } from './stats.js';

export function autoCloudIdentity(state) {
  const name = state?.session?.entered && typeof state?.me?.name === 'string' ? state.me.name : '';
  return { name, key: name && state.me.playerId != null ? JSON.stringify([name, state.me.playerId]) : null };
}
export const autoCloudUpload = createPersistentCloudUpload({ getIdentity: () => autoCloudIdentity(store.get()) });
let installed = false;
export function installAutoCloudUpload() {
  if (installed) return;
  installed = true;
  store.subscribe(() => { void autoCloudUpload.identityChanged(); });
  void autoCloudUpload.resume();
  subscribeNewRecords(record => autoCloudUpload.enqueue(record));
}
