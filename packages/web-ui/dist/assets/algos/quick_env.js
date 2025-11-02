// runAlgo.js (worker)
function uiLog(...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a))).join(' ');
  if (typeof self !== 'undefined' && self.postMessage) {
    self.postMessage({ type: 'log', msg });
  } else {
    console.log('[node]', msg);
  }
}

self.addEventListener('error', e => {
  uiLog('[WorkerError]', e.message);
});
self.addEventListener('unhandledrejection', e => {
  uiLog('[UnhandledRejection]', e.reason && e.reason.message ? e.reason.message : String(e.reason));
});

uiLog('[debug] worker booted');

(async () => {
  const BUNDLE_URL = '/assets/algos/tl/algoAPI.bundle.js';

  // 1) try normal dynamic import
  try {
    await import(BUNDLE_URL);
    uiLog('[worker] dynamic import ok');
  } catch (err) {
    uiLog('[worker] dynamic import failed:', err?.message || String(err));

    // 2) fetch text and patch the bad shapes
    try {
      uiLog('[worker] fetching bundle to patch …');
      const res = await fetch(BUNDLE_URL, { cache: 'no-store' });
      let src = await res.text();

      // (a) fix "return ApiWrapper()" → "return ApiWrapper"
      src = src.replace(
        /return\s+ApiWrapper\s*\(\s*\)\s*;?/g,
        'return ApiWrapper;'
      );

      // (b) fix "g.ApiWrapper = factory();" → object export
      src = src.replace(
        /g\.ApiWrapper\s*=\s*factory\(\);\s*/g,
        'g.TLAlgoAPI = (function(){' +
          'const Api = factory();' +
          'return { ApiWrapper: Api, createApiWrapper: function(){ return new Api(...arguments); } };' +
        '})();'
      );

      // (c) also fix CommonJS form if present
      src = src.replace(
        /module\.exports\s*=\s*factory\(\);\s*/g,
        'module.exports = (function(){' +
          'const Api = factory();' +
          'return { ApiWrapper: Api, createApiWrapper: function(){ return new Api(...arguments); } };' +
        '})();'
      );

      uiLog('[worker] evaluating patched bundle …');
      (0, eval)(src);
      uiLog('[worker] patched bundle evaluated');
    } catch (e) {
      uiLog('[worker] fallback eval failed:', e?.message || String(e));
      return;
    }
  }

  // 3) now try to read what the bundle left us
  const g = typeof self !== 'undefined' ? self : globalThis;
  const exported = g.TLAlgoAPI || g.ApiWrapper;

  if (!exported) {
    uiLog('[fatal] still no TLAlgoAPI / ApiWrapper on global');
    return;
  }

  // shared hardcoded cfg (you can wire from FE later)
  const cfg = [
    'ws.layerwallet.com',
    443,
    true,
    false,
    'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf',
    '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677',
    'LTCTEST'
  ];

  let api;

  if (typeof exported === 'object' && typeof exported.createApiWrapper === 'function') {
    uiLog('[worker] using createApiWrapper');
    api = exported.createApiWrapper(...cfg);
  } else if (typeof exported === 'function') {
    uiLog('[worker] using class export');
    api = new exported(...cfg);
  } else {
    uiLog('[worker] using instance export');
    api = exported;
  }

  if (!api) {
    uiLog('[fatal] could not init api');
    return;
  }

  uiLog('[ok] api ready', Object.getOwnPropertyNames(Object.getPrototypeOf(api)));

(async () => {
  const BUNDLE_URL = '/assets/algos/tl/algoAPI.bundle.js';

  function uiLog(...args) {
    if (typeof self !== 'undefined' && self.postMessage) {
      self.postMessage({ type: 'log', msg: args.join(' ') });
    } else {
      console.log('[worker]', ...args);
    }
  }

  uiLog('[worker] boot');

  // 1) get the raw bundle text
  let src;
  try {
    const res = await fetch(BUNDLE_URL + '?_=' + Date.now(), { cache: 'no-store' });
    src = await res.text();
  } catch (e) {
    uiLog('[fatal] cannot fetch bundle:', e?.message || String(e));
    return;
  }

  // 2) protect the class/function definition name so we don't break it
  // covers: "class ApiWrapper {" and "function ApiWrapper("
  src = src
    .replace(/class\s+ApiWrapper\s*\{/g, 'class __ApiWrapper_DEF__ {')
    .replace(/function\s+ApiWrapper\s*\(/g, 'function __ApiWrapper_DEF__(');

  // 3) now nuke ALL calls like "ApiWrapper(...)" (the thing throwing)
  // we only match when preceded by a non-identifier char, so we don't hit "...SomeApiWrapper("
  src = src.replace(/([^A-Za-z0-9_$])ApiWrapper\s*\(/g, '$1ApiWrapper');

  // 4) restore the real name
  src = src.replace(/__ApiWrapper_DEF__/g, 'ApiWrapper');

  // 5) make extra sure it exposes TLAlgoAPI (in case your built file was older)
  if (!/TLAlgoAPI/.test(src)) {
    src += `
    (function (root, factory) {
      var lib = factory();
      (root || (typeof self !== 'undefined' ? self : globalThis)).TLAlgoAPI = lib;
    })(typeof self !== 'undefined' ? self : this, function () {
      function createApiWrapper() {
        return new ApiWrapper(...arguments);
      }
      return { ApiWrapper: ApiWrapper, createApiWrapper: createApiWrapper };
    });
    `;
  }

  // 6) eval the cleaned bundle
  try {
    (0, eval)(src);
    uiLog('[worker] patched bundle evaluated');
  } catch (e) {
    uiLog('[fatal] eval still failed:', e?.message || String(e));
    return;
  }

  // 7) consume it
  const g = typeof self !== 'undefined' ? self : globalThis;
  const exported = g.TLAlgoAPI || g.ApiWrapper;

  if (!exported) {
    uiLog('[fatal] no TLAlgoAPI / ApiWrapper on global after eval');
    return;
  }

  // hardcoded for now
  const cfg = [
    'ws.layerwallet.com',
    443,
    true,
    false,
    'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf',
    '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677',
    'LTCTEST'
  ];

  let api;
  if (typeof exported === 'object' && typeof exported.createApiWrapper === 'function') {
    uiLog('[worker] using createApiWrapper');
    api = exported.createApiWrapper(...cfg);
  } else if (typeof exported === 'function') {
    uiLog('[worker] using class export');
    api = new exported(...cfg);
  } else {
    uiLog('[worker] using instance export');
    api = exported;
  }

  if (!api) {
    uiLog('[fatal] could not init api');
    return;
  }

  uiLog('[ok] api ready', Object.getOwnPropertyNames(Object.getPrototypeOf(api)));

  // 8) smoke test
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
