// runAlgo.js  — browser/worker-safe version
function uiLog(...args) {
  const msg = args
    .map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)))
    .join(' ');

  if (typeof self !== 'undefined' && self.postMessage) {
    // running inside WebWorker
    self.postMessage({ type: 'log', msg });
  } else {
    // running under Node (quick_env.js CLI test)
    console.log('[node]', msg);
  }
}

// load the API wrapper (ensure tl/algoAPI.js exists in same assets/algos folder)
self.addEventListener('error', e => {
  self.postMessage({ type: 'log', msg: '[WorkerError] ' + e.message });
  console.error(e);
});
self.addEventListener('unhandledrejection', e => {
  self.postMessage({ type: 'log', msg: '[UnhandledRejection] ' + e.reason });
  console.error(e.reason);
});
uiLog('[debug] worker booted');

//setTimeout(startAlgo, 6000);
// simple logger that streams to the UI and browser console
let ApiWrapper;

(async () => {
  uiLog('[worker] starting dynamic import sequence');

  try {
    // Dynamically load the script — forces execution and populates globalThis.ApiWrapper
    await import('/assets/algos/tl/algoAPI.bundle.js');
  } catch (err) {
    uiLog('[import fail]', String(err?.message || err));
    return;
  }

  // ✅ Diagnostic: check global scope directly
  uiLog('[typeof globalThis.ApiWrapper]', typeof globalThis.ApiWrapper);
  uiLog('[typeof self.ApiWrapper]', typeof self.ApiWrapper);

  // ✅ Use whichever environment provided it
  ApiWrapper = globalThis.ApiWrapper ?? self.ApiWrapper;
  uiLog('[final resolved ApiWrapper]', typeof ApiWrapper);

  if (typeof ApiWrapper !== 'function') {
    uiLog('[fatal] ApiWrapper not defined or not a constructor');
    return;
  }

  try {
    const api = new ApiWrapper(
      'ws.layerwallet.com', 443, true, false,
      'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf',
      '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677',
      'LTCTEST'
    );
    uiLog('[construct ok]', !!api);
  } catch (err) {
    uiLog('[construct fail]', err.message || err);
  }
})();




/*
// ---- CONFIG ----
const HOST     = '172.81.181.19';
const PORT     = 3001;
const TESTNET  = true;
const TL_ON    = false;
const ADDRESS  = 'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf';
const PUBKEY   = '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677';
const NETWORK  = 'LTCTEST';
const SIZE     = 0.1;

uiLog('[env]', HOST, PORT, TESTNET, TL_ON, ADDRESS, PUBKEY, NETWORK);

// ---- INIT ----
//const api = new ApiWrapper(HOST, PORT, TESTNET, TL_ON, ADDRESS, PUBKEY, NETWORK);

const delay = ms => new Promise(res => setTimeout(res, ms));
// ---- MAIN ----
(async () => {
  try {
    await delay(1500);
    const getExtensionSigner = () => ({ sign: async () => console.log('[stub signer]') });

    //const me = api.getMyInfo();
    //uiLog('me:', me.address);

    const spot = await api.getSpotMarkets();
    uiLog('spot markets:', Array.isArray(spot) ? spot.length : 0);

    const ob = await api.getOrderbookData({
      type: 'SPOT',
      first_token: 0,
      second_token: 5
    });
    uiLog('orderbook levels:', {
      bids: ob?.bids?.length || 0,
      asks: ob?.asks?.length || 0
    });

    const order = {
      type: 'SPOT',
      action: 'BUY',
      isLimitOrder: true,
      keypair: {
        address: ADDRESS,
        pubkey: PUBKEY
      },
      props: {
        id_for_sale: 0,
        id_desired: 5,
        price: 100,
        amount: SIZE,
        transfer: false
      }
    };

    const uuid = await api.sendOrder(order);
    uiLog('order sent:', uuid);

    uiLog('[done]');
    self.close();
  } catch (e) {
    uiLog('[fatal]', e.message || e);
    console.error(e);
  }
})();
*/