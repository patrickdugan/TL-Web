// keyStore.js - in-memory ephemeral key holder for algo runtime.
// We intentionally avoid persisting WIF/private material to web storage.

const LEGACY_KEYS = ['ephemeral-key', 'ephemeral_key', 'tl-ephemeral-key'];
let currentEphemeralKey = null;

function scrubObject(obj) {
  if (!obj || typeof obj !== 'object') return;
  for (const k of Object.keys(obj)) obj[k] = null;
}

function removeLegacyStorage() {
  try {
    if (typeof localStorage === 'undefined') return;
    for (const k of LEGACY_KEYS) localStorage.removeItem(k);
  } catch {}
}

function readLegacyStorageOnce() {
  try {
    if (typeof localStorage === 'undefined') return null;
    for (const k of LEGACY_KEYS) {
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw);
      // Immediate purge keeps backward compatibility while ending persistence.
      removeLegacyStorage();
      return parsed;
    }
  } catch {}
  return null;
}

function clearEphemeralKey() {
  scrubObject(currentEphemeralKey);
  currentEphemeralKey = null;
  removeLegacyStorage();
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
  return currentEphemeralKey;
}

function getEphemeralKey() {
  if (currentEphemeralKey) return currentEphemeralKey;
  const migrated = readLegacyStorageOnce();
  if (migrated) return setEphemeralKey(migrated);
  return null;
}

module.exports = { setEphemeralKey, getEphemeralKey, clearEphemeralKey };
