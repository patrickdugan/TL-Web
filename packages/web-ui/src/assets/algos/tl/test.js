// test_run.js — dummy algo that runs for 60 seconds

function uiLog(...args) {
  const msg = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : a)).join(' ');
  self.postMessage({ type: 'log', msg });
  uiLog(...args); // still logs to worker console too
}


(async () => {
  uiLog('[test_run] starting dummy algo');

  const start = Date.now();
  const duration = 60_000; // 60 seconds

  const interval = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    uiLog(`[test_run] alive ${elapsed}s`);
    if (Date.now() - start >= duration) {
      uiLog('[test_run] done — exiting');
      clearInterval(interval);
      if (typeof self !== 'undefined' && self.close) {
        self.close(); // for webworker
      } else if (typeof process !== 'undefined' && process.exit) {
        process.exit(0); // for node
      }
    }
  }, 2000);
})();
