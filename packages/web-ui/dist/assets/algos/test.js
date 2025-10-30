function uiLog(...args) {
  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : String(a)
  ).join(' ');
  if (typeof self !== 'undefined' && self.postMessage) {
    self.postMessage({ type: 'log', msg });
  }
  console.log('[worker]', msg);
}

// global catch for any unhandled crash
self.addEventListener('error', e => {
  uiLog('[worker error]', e.message);
});
self.addEventListener('unhandledrejection', e => {
  uiLog('[unhandled rejection]', e.reason?.message || e.reason);
});

try {
  uiLog('[boot] worker starting…');
  // put a long timeout so you can attach debugger
  setTimeout(() => {
    uiLog('[boot] entering main logic');
    try {
      // your existing logic goes here
      const ApiWrapper =
        typeof require !== 'undefined'
          ? require('./tl/algoAPI.js')
          : (importScripts('tl/algoAPI.js'), self.ApiWrapper);

      const api = new ApiWrapper(
        '172.81.181.19',
        3001,
        true,
        false,
        'tltc1qn006lvcx89zjnhuzdmj0rjcwnfuqn7eycw40yf',
        '03670d8f2109ea83ad09142839a55c77a6f044dab8cb8724949931ae8ab1316677',
        'LTCTEST'
      );

      uiLog('[api] constructed');
      // maybe call a safe method first
      api.getMyInfo && uiLog('[me]', JSON.stringify(api.getMyInfo()));
    } catch (inner) {
      uiLog('[inner crash]', inner.message || inner);
    }
  }, 8000);
} catch (outer) {
  uiLog('[outer crash]', outer.message || outer);
}
