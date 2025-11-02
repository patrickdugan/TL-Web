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
  uiLog('[worker] starting dynamic import sequence');

  // 1) load the UMD bundle so it sticks something on global
  try {
    await import('/assets/algos/tl/algoAPI.bundle.js');
    uiLog('[import ok] bundle executed');
  } catch (err) {
    uiLog('[import fail]', err?.message || String(err));
    return;
  }

  // 2) get whatever the bundle actually exported
  const g = (typeof self !== 'undefined' ? self : globalThis);

  // prefer the new shim name if we add it, else fall back
  const exported =
    g.TLAlgoAPI ||           // { createApiWrapper, ApiWrapper } – preferred
    g.ApiWrapper ||          // class ApiWrapper
    null;

  if (!exported) {
    uiLog('[fatal] no TLAlgoAPI / ApiWrapper found on global after import');
    return;
  }

  // 3) normalize all the shapes we might get
  let api = null;

  // case A: UMD gave us an object with a factory
  if (exported && typeof exported === 'object' && typeof exported.createApiWrapper === 'function') {
    uiLog('[worker] using exported.createApiWrapper(...)');
    api = exported.createApiWrapper(
      'ws.layerwallet.com',                 // baseURL / host
      443,                                  // port
      true,                                 // test
      false,                                // tlAlreadyOn
      'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf', // address
      '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677', // pubkey
      'LTCTEST'                             // network
    );
  }

  // case B: UMD gave us the class directly
  else if (typeof exported === 'function') {
    uiLog('[worker] using `new ApiWrapper(...)` from function export');
    api = new exported(
      'ws.layerwallet.com',
      443,
      true,
      false,
      'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf',
      '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677',
      'LTCTEST'
    );
  }

  // case C: UMD gave us an instance already (weird, but let's cope)
  else if (typeof exported === 'object' && exported !== null) {
    uiLog('[worker] exported was an instance – using as-is');
    api = exported;
  }

  if (!api) {
    uiLog('[fatal] could not construct API from bundle export');
    return;
  }

  uiLog(
    '[ok] api ready, proto keys:',
    Object.getOwnPropertyNames(Object.getPrototypeOf(api))
  );

  // 4) test call
  try {
    const spot = await api.getSpotMarkets?.();
    uiLog(
      '[getSpotMarkets]',
      Array.isArray(spot) ? `len=${spot.length}` : typeof spot
    );
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
