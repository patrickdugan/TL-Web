// Full replacement: algoAPI.js
// Adds API mode with axios routing to relayer endpoints (URIs configurable via RELAYER_PATHS).

// ---- logging bridge (works in worker or node) -----------------
const log =
  // if worker script already defined uiLog, use it
  (typeof uiLog === 'function' && uiLog) ||
  // else, if we are in a worker, forward to UI
  (typeof self !== 'undefined' && self.postMessage
    ? (...args) => {
        const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
        self.postMessage({ type: 'log', msg });
      }
    // last fallback: console
    : (...args) => console.log('[algoAPI]', ...args));


const io = require('socket.io-client');
const axios = require('axios');
const BigNumber = require('bignumber.js');
const {ensureBitcoin,
  //getExtensionSigner,
  //makeEphemeralKey,
  signPsbtLocal,
  //getUnifiedSigner,
  makeNewAddress,
  makeMultisig,
  makeLocalRpc,
  createRawTransaction,
  createPsbtAsync, 
  decodeRawTransactionAsync, 
  decodepsbtAsync,
  signRawTransaction}= require('./util');
// Keep these requires so existing imports don't break if used elsewhere.
let OrderbookSession;
try { OrderbookSession = require('./orderbook.js'); } catch { OrderbookSession = null; }
let createTransport;
try { ({ createTransport } = require('./ws-transport')); } catch { createTransport = null; }
const { getEphemeralKey, setEphemeralKey } = require('./keyStore.js');


const { createLitecoinClient, createBitcoinClient } = (() => {
  try { return require('./client.js'); }
  catch { return { createLitecoinClient: () => null, createBitcoinClient: () => null }; }
})();

/**
 * Centralized map of relayer paths discovered from your routes.
 * Adjust here if your server has different prefixes.
 *
 * Known route files in zip:
 * - address.route.ts → /address/validate/:address, /address/balance/:address, (fund assumed)
 * - chain.route.ts   → /chain/*   (we map /chain/info)
 * - rpc.route.ts     → /rpc       (generic passthrough)
 * - token.route.ts   → /token/*   (we map /token/balance/:address)
 * - tx.route.ts      → /tx/:txid and POST /tx/broadcast
 */
const RELAYER_PATHS = {
  addressValidate    : '/address/validate/:address',
  addressBalance     : '/address/balance/:address',
  // If faucet/funding exists; otherwise remove.
  addressFund        : '/address/fund',

  chainInfo          : '/chain/info',

  rpcPassthrough     : '/rpc',

  tokenBalance       : '/token/balance/:address',

  txGet              : '/tx/:txid',
  txBroadcast        : '/tx/broadcast',

  // Orderbook routes (not in zip, but commonly present)
  orderbookSnapshot  : '/orderbook/snapshot',
  orderPlace         : '/orders/place',
  orderCancel        : '/orders/cancel',
};


function fillPath(path, params = {}) {
  return path.replace(/:([A-Za-z_]\w*)/g, (_, k) => encodeURIComponent(params[k] ?? ''));
}

var ApiWrapper = class ApiWrapper {
  constructor(baseURL, port, test, tlAlreadyOn = false, address, pubkey, network, apiMode = false, relayerBase) {
    this.baseURL = baseURL;
    this.port = port;
    this.test = !!test;
    this.network = network || (this.test ? 'LTCTEST' : 'LTC');
    this.myInfo = {
      address: address,
      keypair: { address, pubkey: pubkey || null },
      otherAddrs: []
    };

    // Local client (only used when tlOn && !apiMode)
    this.client = (network && network.toUpperCase().startsWith('BTC'))
      ? createBitcoinClient(this.test)
      : createLitecoinClient(this.test);

    // WebSocket endpoint (kept for compatibility)
    const netloc = (baseURL || '').replace(/^ws:\/\/|^wss:\/\//, '').replace(/^http:\/\/|^https:\/\//, '');
    this.apiUrl = `http://${netloc}:${port}`;
    this.wsUrl  = `wss://${netloc}:${port}/ws`;

    // API Mode wiring
    this.tlOn = !!tlAlreadyOn;
    this.apiMode = !!apiMode || !this.tlOn;
    const defaultRelayer = this.test
      ? 'https://testnet-api.layerwallet.com'
      : 'https://api.layerwallet.com';

    this.relayer = axios.create({
      baseURL: relayerBase || defaultRelayer,
      timeout: 25000,
      headers: { 'Content-Type': 'application/json' },
    });

    // Orderbook session (optional, when not using relayer for books)
    this.orderbookSession = OrderbookSession ? new OrderbookSession() : null;
    this.sessionKey = this.loadEphemeralKey();
    // Socket handle
    this.socket = null;
    this._initializeSocket();
    setTimeout(() => { this.initUntilSuccess(); }, 0);
  }

  getMyInfo() {
    return this.myInfo
  }

  getEphemeralKey() {
    return this.sessionKey;
  }

  async generateEphemeralKey(network = 'LTCTEST') {
    const keyObj = makeNewAddress(network);
    this.sessionKey = keyObj;
    this.saveEphemeralKey(keyObj);
    return keyObj;
  }

  clearEphemeralKey() {
    this.sessionKey = null;
    //clearEphemeralKey();
  }

loadEphemeralKey() {
  try {
    if (typeof localStorage !== 'undefined') {
      const raw = localStorage.getItem('ephemeral_key');
      if (raw){ 
        return JSON.parse(raw);
      }else{
        this.generateEphemeralKey()
      }

    }
  } catch (err) {
    console.warn('[EphemeralKey] localStorage read failed', err);
  }
  return null;
}

saveEphemeralKey(eph) {
  try {
    if (typeof localStorage !== 'undefined' && eph) {
      localStorage.setItem('ephemeral_key', JSON.stringify(eph));
      return true;
    }
  } catch (err) {
    console.warn('[EphemeralKey] localStorage save failed', err);
  }
  return false;
}


  // --- Socket setup (assigns this.socket if created) ---
 // Function to initialize a socket connection
_initializeSocket() {
  if (this.socket) {
    log('[ws] reusing existing socket');
    return this.socket;
  }

  const url = this.wsUrl; // e.g. wss://ws.layerwallet.com/ws
  log('[ws] attempting connection to', url);

  try {
    const sock = createTransport({ type: 'ws', url });
    this.socket = sock;

    sock.connect(url)
      .then(() => {
        log('[ws] connected to', url);
        this.myInfo.socketId = null; // event-bus mode

        if (typeof OrderbookSession === 'function') {
          this.orderbookSession = new OrderbookSession(
            sock,
            this.myInfo,
            this.client,
            this.test
          );
          log('[ws] OrderbookSession initialized');
        }
      })
      .catch(err => {
        log('[ws] connect() failed:', err?.message || err);
      });

    // Core socket event handlers
    sock.on('connect', () => {
      log('[ws][connect]', url);
      this.myInfo.socketId = sock.id || null;
    });

    sock.on('disconnect', reason => {
      log('[ws][disconnect]', reason);
    });

    sock.on('error', err => {
      log('[ws][error evt]', err?.message || err);
    });

    sock.on('order:saved', orderUuid => {
      log('[ws][order:saved]', orderUuid);
      if (!this.myOrders) this.myOrders = [];
      this.myOrders.push(orderUuid);
    });

    sock.on('order:canceled', payload => {
      const orderUuid = payload?.orderUuid || payload?.uuid;
      log('[ws][order:canceled]', orderUuid);
      if (this.myOrders && orderUuid) {
        this.myOrders = this.myOrders.filter(o => o !== orderUuid);
      }
    });

    sock.on('order:error', err => {
      log('[ws][order:error]', typeof err === 'string' ? err : JSON.stringify(err));
    });

    sock.on('orderbook-data', data => {
      log('[ws][orderbook-data] update received');
    });

    return sock;
  } catch (err) {
    log('[ws][fatal]', err?.message || err);
    return null;
  }
}



  // --- API helper ---
  async _relayerPost(path, body) {
    const payload = Object.assign({ network: this.network }, body || {});
    const { data } = await this.relayer.post(path, payload);
    return data;
  }
  async _relayerGet(path) {
    const { data } = await this.relayer.get(path, { params: { network: this.network } });
    return data;
  }

  // --- INIT paths ---
  async init() {
    if (this.apiMode) return await this.initApiMode();
    try {
      const response = await this.getBlockchainInfo();
      if (!response.initialblockdownload) {
        if (!this.socket) this._initializeSocket();
      } else {
        await new Promise(r => setTimeout(r, 10000));
        return await this.init();
      }
      return {
        success: !response.initialblockdownload,
        message: response.initialblockdownload
          ? 'Block indexing is still in progress.'
          : 'Block indexing is complete.',
      };
    } catch (error) {
      return { success: false, message: error.message || String(error) };
    }
  }

  async initApiMode() {
    console.log('inside init api mode')
    try {
      const address = this?.myInfo?.address || this?.myInfo?.keypair?.address;
      if (!address) throw new Error('Address required to initialize in API mode');

      // Probe relayer connectivity (prefer UTXOs, fall back to balance)
      try {
        await this.getUTXOBalances(address);
      } catch (e) {
        try { await this.getAllBalancesForAddress(address); } catch { throw e; }
      }

      if (!this.socket) {
        const s = this._initializeSocket();
        if (s && !this.socket) this.socket = s;
      }
      return { success: true, message: 'API mode initialized' };
    } catch (error) {
      return { success: false, message: error?.message || String(error) };
    }
  }

  async initUntilSuccess(maxRetries = 10, backoffMs = 5000) {
    let attempt = 0;
    console.log('attempt '+attempt)
    while (attempt < maxRetries) {
      try {
        const res = this.tlOn ? await this.initApiMode() : await this.init();
        if (res && res.success) return res;
      } catch {}
      attempt++;
      await new Promise(r => setTimeout(r, backoffMs));
    }
    throw new Error(`Initialization failed after ${maxRetries} attempts`);
  }

  // --- Chain / RPC ---
  async getBlockchainInfo() {
    if (this.apiMode) {
      return await this._relayerGet(RELAYER_PATHS.chainInfo);
    }
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client.getBlockchainInfo) return reject(new Error('Client not available'));
      this.client.getBlockchainInfo((err, res) => err ? reject(err) : resolve(res));
    });
  }

  async rpcCall(method, params = []) {
    // Generic RPC passthrough to relayer
    return await this._relayerPost(RELAYER_PATHS.rpcPassthrough, { method, params });
  }

  // --- Address / Token ---
  async validateAddress(address) {
    const path = fillPath(RELAYER_PATHS.addressValidate, { address });
    return await this._relayerGet(path);
  }

  async getAddressBalance(address) {
    const path = fillPath(RELAYER_PATHS.addressBalance, { address });
    return await this._relayerGet(path);
  }

  async fundAddress(address, amount) {
    // Assuming POST /address/fund { address, amount }
    return await this._relayerPost(RELAYER_PATHS.addressFund, { address, amount });
  }

  async getAllBalancesForAddress(address) {
    // Prefer token route; fallback to address balance if token route is absent.
    try {
      const path = fillPath(RELAYER_PATHS.tokenBalance, { address });
      return await this._relayerGet(path);
    } catch (e) {
      return await this.getAddressBalance(address);
    }
  }

  async getUTXOBalances(address) {
    // If relayer exposes UTXO list, wire it here; otherwise use RPC passthrough.
    // Example via RPC: listunspent 0 9999999 [address]
    try {
      const res = await this.rpcCall('listunspent', [0, 9999999, [address]]);
      return res;
    } catch (e) {
      // Last resort: return empty list
      return [];
    }
  }

  // --- Transactions ---
  async sendRawTransaction(rawhex) {
    if (this.apiMode) {
      return await this._relayerPost(RELAYER_PATHS.txBroadcast, { rawhex });
    }
    return new Promise((resolve, reject) => {
      if (!this.client || !this.client.sendRawTransaction) return reject(new Error('Client not available'));
      this.client.sendRawTransaction(rawhex, (err, txid) => err ? reject(err) : resolve({ txid }));
    });
  }

  async getTx(txid) {
    const path = fillPath(RELAYER_PATHS.txGet, { txid });
    return await this._relayerGet(path);
  }

  // --- Orderbook / Orders ---
  getOrderbookData(filter) {
        return new Promise((resolve, reject) => {
            this.socket.emit('update-orderbook', filter);
            this.socket.once('orderbook-data', (data) => {
                resolve(data);
            });
            this.socket.once('order:error', (error) => {
                reject(error);
            });
        });
    }

  async placeOrder(order) {
    if (!this.sessionKey) {
      const keyObj = makeNewAddress(this.network || 'LTCTEST');
      this.sessionKey = keyObj;
      setEphemeralKey(keyObj);
    }

    order.keypair = {
      address: this.sessionKey.address,
      pubkey: this.sessionKey.pubkey,
    };

    if (this.socket) {
      this.socket.emit('place-order', order);
      return { ok: true };
    }

    throw new Error('No order placement backend available');
  }


  async cancelOrder(orderId) {
    //if (this.apiMode) return await this._relayerPost(RELAYER_PATHS.orderCancel, { orderId });
    if (this.socket) { this.socket.emit('cancel-order', { id: orderId }); return { ok: true }; }
    throw new Error('No order cancel backend available');
  }
// --- Utility helpers & legacy compatibility ---

/** simple async delay (ms) */
delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** return your own address / pubkey info */
getMyInfo() {
  return this.myInfo || { address: null, keypair: { address: null, pubkey: null } };
}

/** fetch list of SPOT markets */
async getSpotMarkets() {
  try {
    if (this.apiMode) {
      // use relayer REST if available
      const { data } = await this.relayer.get('/markets/spot');
      return data;
    }
    // if node-local or relayer missing, fallback to socket request
    if (!this.socket) this._initializeSocket();
    if (this.socket) {
      return await this._relayerPost('/markets/spot'); // reuse axios path
    }
    return [];
  } catch (err) {
    console.error('[getSpotMarkets] error:', err);
    return [];
  }
}

/** submit a SPOT or FUTURES order */
async sendOrder(order) {
  try {
    if (this.apiMode) {
      // direct REST submission
      const { data } = await this.relayer.post('/orders/place', order);
      return data?.uuid || data?.id || null;
    }

    if (!this.socket) this._initializeSocket();
    if (this.socket) {
      const uuid = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
      this.socket.emit('place-order', { ...order, uuid });
      return uuid;
    }

    throw new Error('No active socket or relayer available to send order');
  } catch (err) {
    console.error('[sendOrder] error:', err);
    throw err;
  }
}

 async getSpotMarkets() {
            const response = await axios.get(`${this.apiUrl}/markets/spot/${this.network}`);

           const payload = Array.isArray(response.data) ? response.data : response.data.data;
        const markets = payload?.[0]?.markets;
        if (markets){ return markets
        }else{throw new Error('Invalid response format: spot markets not found')};
    }

    // Modified getFuturesMarkets with safer logging
    async getFuturesMarkets() {
            const response = await axios.get(`${this.apiUrl}/markets/futures/${this.network}`);
            
            // Log just the response data instead of the whole response
            //console.log('Futures Markets Response Data:', util.inspect(response.data, { depth: null }));

           
           const payload = Array.isArray(response.data) ? response.data : response.data.data;
        const markets = payload?.[0]?.markets;
        if (markets){ return markets
        }else{throw new Error('Invalid response format: futures markets not found')};
    }
}
// --- Final hard export (no tree-shake, no closure loss) ---
try {
  // Force a reference so Terser keeps it
  const _ApiWrapperRef = ApiWrapper;
  // Attach everywhere possible
  (typeof globalThis !== 'undefined' ? globalThis : self).ApiWrapper = _ApiWrapperRef;
  if (typeof window !== 'undefined') window.ApiWrapper = _ApiWrapperRef;
  if (typeof self !== 'undefined') self.ApiWrapper = _ApiWrapperRef;
  if (typeof module !== 'undefined' && module.exports) module.exports = _ApiWrapperRef;
  if (typeof define === 'function' && define.amd) define([], () => _ApiWrapperRef);
  // expose name for diagnostics
  log('[export] ApiWrapper prototype keys:', Object.keys(_ApiWrapperRef?.prototype || {}));
} catch (err) {
  log('[export] failed', err);
}

Object.defineProperty(globalThis, 'ApiWrapper', { value: ApiWrapper, writable: true });