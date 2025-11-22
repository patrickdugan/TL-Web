// keyStore.js — minimal global holder

let currentEphemeralKey = 'tl-ephemeral-key';

function clearEphemeralKey() {
  currentEphemeralKey = null;
  try { localStorage.removeItem('tl-ephemeral-key'); } catch {}
}

function setEphemeralKey(obj) {
  currentEphemeralKey = obj;
  try { localStorage.setItem('ephemeral-key', JSON.stringify(obj)); } catch {}
}

function getEphemeralKey() {
  try { return JSON.parse(localStorage.getItem('ephemeral-key')); } catch { return currentEphemeralKey; }
}

module.exports = { setEphemeralKey, getEphemeralKey,clearEphemeralKey };
