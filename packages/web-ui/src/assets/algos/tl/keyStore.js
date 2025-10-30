// keyStore.js — minimal global holder

let currentEphemeralKey = 'tl-ephemeral-key';

export function setEphemeralKey(obj) {
  currentEphemeralKey = obj;
  try {
    localStorage.setItem('tl-ephemeral-key', JSON.stringify(obj));
  } catch {}
}

export function getEphemeralKey() {
  if (currentEphemeralKey) return currentEphemeralKey;
  try {
    const data = localStorage.getItem('tl-ephemeral-key');
    currentEphemeralKey = data ? JSON.parse(data) : null;
  } catch {}
  return currentEphemeralKey;
}

export function clearEphemeralKey() {
  currentEphemeralKey = null;
  try { localStorage.removeItem('tl-ephemeral-key'); } catch {}
}
