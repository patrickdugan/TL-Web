const test = require('node:test');
const assert = require('node:assert/strict');

function makeStorage() {
  const m = new Map();
  return {
    getItem(k) { return m.has(k) ? m.get(k) : null; },
    setItem(k, v) { m.set(String(k), String(v)); },
    removeItem(k) { m.delete(String(k)); },
    clear() { m.clear(); },
  };
}

function resetModule(modPath) {
  const id = require.resolve(modPath);
  delete require.cache[id];
  return require(modPath);
}

function loadKeyStore() {
  global.localStorage = makeStorage();
  global.sessionStorage = makeStorage();
  return resetModule('./keyStore.js');
}

function loadApiWrapper() {
  const orderbookPath = require.resolve('./orderbook.js');
  require.cache[orderbookPath] = {
    id: orderbookPath,
    filename: orderbookPath,
    loaded: true,
    exports: null,
  };

  const ApiWrapper = resetModule('./algoAPI.js');
  ApiWrapper.prototype._initializeSocket = function () { this.socket = null; return null; };
  ApiWrapper.prototype.initUntilSuccess = async function () { return { success: true }; };
  return ApiWrapper;
}

test('hot key store mode: session persists in sessionStorage only', () => {
  const ks = loadKeyStore();
  ks.setEphemeralKeyStoreMode('session');
  ks.setEphemeralKey({ address: 'a', pubkey: 'p', wif: 'w', network: 'LTCTEST' });

  assert.equal(global.sessionStorage.getItem('ephemeral_key') !== null, true);
  assert.equal(global.localStorage.getItem('ephemeral_key'), null);
  assert.equal(ks.getEphemeralKey().wif, 'w');
});

test('hot key store mode: memory never persists to storage', () => {
  const ks = loadKeyStore();
  ks.setEphemeralKeyStoreMode('memory');
  ks.setEphemeralKey({ address: 'a', pubkey: 'p', wif: 'w', network: 'LTCTEST' });

  assert.equal(global.sessionStorage.getItem('ephemeral_key'), null);
  assert.equal(global.localStorage.getItem('ephemeral_key'), null);
  assert.equal(ks.getEphemeralKey().wif, 'w');
});

test('ApiWrapper policy blocks missing clearlist when required', () => {
  const ks = loadKeyStore();
  ks.setEphemeralKeyStoreMode('memory');
  ks.setEphemeralKey({ address: 'tltc1qhot', pubkey: '02hot', wif: 'L1hot', network: 'LTCTEST' });
  const ApiWrapper = loadApiWrapper();
  const api = new ApiWrapper(
    '127.0.0.1',
    3001,
    true,
    false,
    'tltc1qtest',
    '02abc',
    'LTCTEST',
    true,
    'https://testnet-api.layerwallet.com',
    { requireClearlist: true, hotKeyPersistence: 'session' }
  );

  assert.throws(
    () => api._assertOrderSecurityPolicy({ type: 'SPOT', props: { amount: 1, price: 10 } }),
    /missing clearlistGroupId/i
  );
});

test('ApiWrapper policy enforces MM allowlist and passes approved MM', () => {
  const ks = loadKeyStore();
  ks.setEphemeralKeyStoreMode('memory');
  ks.setEphemeralKey({ address: 'tltc1qhot', pubkey: '02hot', wif: 'L1hot', network: 'LTCTEST' });
  const ApiWrapper = loadApiWrapper();
  const api = new ApiWrapper(
    '127.0.0.1',
    3001,
    true,
    false,
    'tltc1qtest',
    '02abc',
    'LTCTEST',
    true,
    'https://testnet-api.layerwallet.com',
    {
      requireClearlist: true,
      allowedClearlistGroupIds: [42],
      allowedCounterpartyPubkeys: ['03mmgood'],
      requireCounterpartyForRapid: true,
      maxOrderNotional: 1000,
      hotKeyPersistence: 'session',
    }
  );

  assert.throws(
    () => api._assertOrderSecurityPolicy({
      type: 'SPOT',
      clearlistGroupId: 42,
      counterpartyPubkey: '03mmbad',
      props: { amount: 1, price: 10 },
    }),
    /not allowlisted/i
  );

  assert.doesNotThrow(() => api._assertOrderSecurityPolicy({
    type: 'SPOT',
    clearlistGroupId: 42,
    counterpartyPubkey: '03mmgood',
    props: { amount: 1, price: 10 },
  }));
});
