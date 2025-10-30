// test_run.js — dummy algo that runs for 60 seconds
(async () => {
  console.log('[test_run] starting dummy algo');

  const start = Date.now();
  const duration = 60_000; // 60 seconds

  const interval = setInterval(() => {
    const elapsed = ((Date.now() - start) / 1000).toFixed(1);
    console.log(`[test_run] alive ${elapsed}s`);
    if (Date.now() - start >= duration) {
      console.log('[test_run] done — exiting');
      clearInterval(interval);
      if (typeof self !== 'undefined' && self.close) {
        self.close(); // for webworker
      } else if (typeof process !== 'undefined' && process.exit) {
        process.exit(0); // for node
      }
    }
  }, 2000);
})();
