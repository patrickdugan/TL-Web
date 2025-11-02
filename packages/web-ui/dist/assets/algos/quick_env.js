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

(async () => {
  uiLog('[worker] start import (with fallback)');

  const BUNDLE_URL = '/assets/algos/tl/algoAPI.bundle.js';

  async function tryDynamicImport() {
    try {
      await import(BUNDLE_URL);
      uiLog('[worker] dynamic import ok');
      return true;
    } catch (err) {
      const msg = err?.message || String(err);
      uiLog('[worker] dynamic import failed:', msg);

      // this is the one you're seeing
      const isCtorErr = msg.includes('Class constructor ApiWrapper cannot be invoked without \'new\'');
      return isCtorErr ? false : false; // false = go to fallback
    }
  }

  async function evalPatchedBundle() {
    uiLog('[worker] fetching bundle to patch …');
    const res = await fetch(BUNDLE_URL, { cache: 'no-store' });
    const src = await res.text();

    // minimal patch: take the old "g.ApiWrapper = factory();" shape
    // and make it export an object instead
    const patched = src.replace(
      /g\.ApiWrapper\s*=\s*factory\(\);\s*$/,
      // ↓ this is what we actually wanted all along
      'g.TLAlgoAPI = (function(){' +
        'const Api = factory();' +
        'return { ApiWrapper: Api, createApiWrapper: function(){ return new Api(...arguments); } };' +
      '})();'
    );

    uiLog('[worker] evaluating patched bundle …');
    // run in worker scope
    (0, eval)(patched);
    uiLog('[worker] patched bundle evaluated');
  }

  // 1) try normal way
  let imported = await tryDynamicImport();

  // 2) if that blew up with the class-ctor thing, do the patch
  if (!imported) {
    try {
      await evalPatchedBundle();
    } catch (e) {
      uiLog('[worker] fallback eval failed:', e?.message || String(e));
      return;
    }
  }

  // 3) now normalize whatever we got on global
  const g = typeof self !== 'undefined' ? self : globalThis;
  const exported = g.TLAlgoAPI || g.ApiWrapper;

  if (!exported) {
    uiLog('[fatal] still no TLAlgoAPI / ApiWrapper on global');
    return;
  }

  // single place for your env
  const cfg = [
    'ws.layerwallet.com',                  // host
    443,                                   // port
    true,                                  // test
    false,                                 // tlAlreadyOn
    'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf', // address
    '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677', // pubkey
    'LTCTEST'
  ];

  let api;

  // preferred: patched shape
  if (typeof exported === 'object' && typeof exported.createApiWrapper === 'function') {
    uiLog('[worker] using createApiWrapper from patched export');
    api = exported.createApiWrapper(...cfg);
  } else if (typeof exported === 'function') {
    // old shape, still works
    uiLog('[worker] using class export');
    api = new exported(...cfg);
  } else {
    // already-instantiated weird shape
    api = exported;
  }

  if (!api) {
    uiLog('[fatal] could not init api');
    return;
  }

  uiLog(
    '[ok] api ready',
    Object.getOwnPropertyNames(Object.getPrototypeOf(api))
  );

  // smoke test
  try {
    const spot = await api.getSpotMarkets?.();
    uiLog('[getSpotMarkets]', Array.isArray(spot) ? `len=${spot.length}` : typeof spot);
  } catch (e) {
    uiLog('[getSpotMarkets fail]', e?.message || String(e));
  }
})();


/*
(async () => {
  uiLog('[worker] starting dynamic import sequence');

  try {
    // Dynamically load the script — forces execution and populates globalThis.ApiWrapper
    //importScripts('/assets/algos/tl/algoAPI.bundle.js');
    const mod = await import('/assets/algos/tl/algoAPI.bundle.js');
    ApiWrapper = mod.ApiWrapper || mod.default?.ApiWrapper || self.ApiWrapper || self.tlApi?.ApiWrapper;

  } catch (err) {
    uiLog('[import fail]', String(err?.message || err));
    return;
  }

  // ✅ Diagnostic: check global scope directly
  uiLog('[typeof globalThis.ApiWrapper]', typeof globalThis.ApiWrapper);
  uiLog('[typeof self.ApiWrapper]', typeof self.ApiWrapper);

  // ✅ Use whichever environment provided it
  
// now it should be on self / globalThis
const ApiWrapper = self.ApiWrapper || globalThis.ApiWrapper;
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
    uiLog('[ApiWrapper keys]', Object.keys(ApiWrapper.prototype || ApiWrapper));
  } catch (err) {
    uiLog('[construct fail]', err.message || err);
  }


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
})();*/





// ---- CONFIG ----
const HOST     = '172.81.181.19';
const PORT     = 3001;
const TESTNET  = true;
const TL_ON    = false;
const ADDRESS  = 'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf';
const PUBKEY   = '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677';
const NETWORK  = 'LTCTEST';
const SIZE     = 0.1;

//uiLog('[env]', HOST, PORT, TESTNET, TL_ON, ADDRESS, PUBKEY, NETWORK);
