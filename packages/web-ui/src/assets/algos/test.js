// test_run.js — dummy algo that runs for 60 seconds

function uiLog(...args) {
  const msg = args.map(a =>
    typeof a === 'object' ? JSON.stringify(a) : a
  ).join(' ');
  self.postMessage({ type: 'log', msg });
  console.log(...args); // still shows if you open the worker console
}

uiLog('[test] worker started');

let i = 0;
const timer = setInterval(() => {
  i++;
  uiLog(`[test] tick ${i}`);
  if (i >= 30) {
    uiLog('[test] done');
    clearInterval(timer);
    self.close();
  }
}, 2000);


/*
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
*/