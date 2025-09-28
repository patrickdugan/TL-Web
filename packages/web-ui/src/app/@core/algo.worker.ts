/// <reference lib="webworker" />
// NOTE: add "WebWorker" to tsconfig.app.json "lib" so TS understands this file.

type RunMsg = {
  type: 'run';
  systemId: string;
  fileName: string;
  source: string;
  meta: any;
  config: Record<string, any>;
};

let running = false;
let timer: any = null;

addEventListener('message', (e: MessageEvent) => {
  const msg = e.data as RunMsg | { type: 'stop' };
  if (!msg) return;

  if (msg.type === 'run' && !running) {
    running = true;
    try {
      const api = {
        log: (...a: any[]) => postMessage({ type: 'log', args: a }),
        // TODO: add web wallet / relayer calls here when you wire them up
      };

      // eslint-disable-next-line no-new-func
      const userExports = new Function('api', 'config', 'meta', `
        "use strict";
        if (typeof onTick !== 'function') { var onTick = function(_){}; }
        return { start: function(){}, stop: function(){}, onTick };
      `)(api, msg.config || {}, msg.meta || {});

      if (!userExports || typeof userExports.onTick !== 'function') {
        throw new Error('Strategy must define onTick(ctx)');
      }

      try { userExports.start && userExports.start(); } catch {}

      let t = 0;
      const loop = () => {
        if (!running) return;
        t++;
        try { userExports.onTick({ t }); } catch {}
        const pnl = Math.sin(t / 10) * 100;
        postMessage({ type: 'metric', ts: Date.now(), pnl });
        timer = setTimeout(loop, 1000);
      };
      loop();

    } catch (e: any) {
      postMessage({ type: 'error', error: String(e?.message || e) });
      running = false;
    }
  } else if (msg.type === 'stop') {
    if (!running) return;
    running = false;
    if (timer) clearTimeout(timer);
    postMessage({ type: 'stopped' });
  }
});
