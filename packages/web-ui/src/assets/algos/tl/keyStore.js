// keyStore.js - hot key store for algo worker.
// Supports explicit persistence modes for rapid-signing workflows.

const LEGACY_KEYS = ['ephemeral-key', 'ephemeral_key', 'tl-ephemeral-key'];
const STORAGE_KEY = 'ephemeral_key';

let currentEphemeralKey = null;
let storageMode = 'session'; // memory | session | local

function scrubObject(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) obj[k] = null;
}

function getStorage(mode = storageMode) {
  try {
    if (mode === 'local' && typeof localStorage !== 'undefined') return localStorage;
    if (mode === 'session' && typeof sessionStorage !== 'undefined') return sessionStorage;
  } catch {}
  return null;
}

function removeLegacyStorage() {
  try {
    const stores = [localStorage, sessionStorage].filter(Boolean);
    for (const s of stores) {
      for (const k of LEGACY_KEYS) s.removeItem(k);
    }
  } catch {}
}

function readLegacyStorageOnce() {
  try {
    const stores = [sessionStorage, localStorage].filter(Boolean);
    for (const s of stores) {
      for (const k of LEGACY_KEYS) {
        const raw = s.getItem(k);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        removeLegacyStorage();
        return parsed;
      }
    }
  } catch {}
  return null;
}

function readFromActiveStorage() {
  const store = getStorage();
  if (!store) return null;
  try {
    const raw = store.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeToActiveStorage(obj) {
  const store = getStorage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(obj));
  } catch {}
}

function clearFromStorage() {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(STORAGE_KEY);
    if (typeof sessionStorage !== 'undefined') sessionStorage.removeItem(STORAGE_KEY);
  } catch {}
}

function clearEphemeralKey() {
  scrubObject(currentEphemeralKey);
  currentEphemeralKey = null;
  clearFromStorage();
  removeLegacyStorage();
}

function setEphemeralKeyStoreMode(mode) {
  const next = String(mode || '').toLowerCase();
  if (!['memory', 'session', 'local'].includes(next)) return storageMode;
  storageMode = next;
  // Keep runtime key, but reflect mode persistence policy.
  if (storageMode === 'memory') {
    clearFromStorage();
  } else if (currentEphemeralKey) {
    writeToActiveStorage(currentEphemeralKey);
  }
  return storageMode;
}

function getEphemeralKeyStoreMode() {
  return storageMode;
}

function setEphemeralKey(obj) {
  clearEphemeralKey();
  if (!obj || typeof obj !== 'object') return null;
  currentEphemeralKey = {
    address: obj.address || null,
    pubkey: obj.pubkey || null,
    wif: obj.wif || null,
    network: obj.network || null,
  };
  if (storageMode !== 'memory') writeToActiveStorage(currentEphemeralKey);
  return currentEphemeralKey;
}

function getEphemeralKey() {
  if (currentEphemeralKey) return currentEphemeralKey;
  const fromActive = readFromActiveStorage();
  if (fromActive) {
    currentEphemeralKey = fromActive;
    return currentEphemeralKey;
  }
  const migrated = readLegacyStorageOnce();
  if (migrated) return setEphemeralKey(migrated);
  return null;
}

module.exports = {
  setEphemeralKey,
  getEphemeralKey,
  clearEphemeralKey,
  setEphemeralKeyStoreMode,
  getEphemeralKeyStoreMode,
};
