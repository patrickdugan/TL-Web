/* src/app/@core/algo.worker.ts */

// We intentionally avoid depending on "lib.webworker" to prevent DOM conflicts.
type AnyObj = Record<string, any>;
type RunMsg = {
  type: 'run';
  systemId: string;
  source: string;
  config: AnyObj;
  meta: AnyObj;
};
type StopMsg = { type: 'stop'; systemId: string };
type LogEvent = { systemId: string; args: any[] };

const ctx: any = self as any; // treat as DedicatedWorkerGlobalScope
let running = false;
let timer: any = null;
let userOnTick: ((x: AnyObj) => void) | null = null;
let userStop: (() => void) | null = null;

function post(msg: any) {
  // In worker context, postMessage(message) is fine; typing via ctx avoids DOM overload.
  ctx.postMessage(msg);
}

function safeClearTimer() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

ctx.onmessage = (ev: MessageEvent) => {
  const msg = ev.data as RunMsg | StopMsg;
  if (!msg || typeof msg !== 'object') return;

  if (msg.type === 'run' && !running) {
    running = true;
    const { systemId, source, config, meta } = msg as RunMsg;
    try {
      const api = {
        log: (...args: any[]) =>
          post({ type: 'log', systemId, args } as LogEvent),
        metric: (pnl: number) =>
          post({ type: 'metric', systemId, pnl }),
        placeOrder: (order: AnyObj) =>
          post({ type: 'order', systemId, order }),
      };

      // Evaluate user strategy in a local scope; capture exports from globals.
      // eslint-disable-next-line no-new-func
      const fn = new Function(
        'api',
        'config',
        'meta',
        `
          "use strict";
          // User code can define: start(api, config, meta), onTick(ctx), stop()
          ${source || ''};
          // expose any globals the user defined:
          return {
            start: (typeof start === 'function') ? start : undefined,
            onTick: (typeof onTick === 'function') ? onTick : undefined,
            stop: (typeof stop === 'function') ? stop : undefined
          };
        `
      );
      const exports = fn(api, config || {}, meta || {}) || {};
      userOnTick = typeof exports.onTick === 'function' ? exports.onTick : null;
      const userStart = typeof exports.start === 'function' ? exports.start : null;
      userStop = typeof exports.stop === 'function' ? exports.stop : null;

      try { userStart && userStart(api, config, meta); } catch (e) {
        post({ type: 'error', systemId, error: String((e as any)?.message || e) });
      }

      let t = 0;
      const loop = () => {
        if (!running) return;
        t++;
        try {
          userOnTick && userOnTick({ t, config, meta });
        } catch (e) {
          post({ type: 'error', systemId, error: String((e as any)?.message || e) });
        }
        timer = setTimeout(loop, 1000);
      };
      loop();

    } catch (e) {
      post({ type: 'error', systemId: (msg as RunMsg).systemId, error: String((e as any)?.message || e) });
      running = false;
      safeClearTimer();
    }
  } else if (msg.type === 'stop') {
    running = false;
    safeClearTimer();
    try { userStop && userStop(); } catch {}
    post({ type: 'stopped', systemId: msg.systemId });
  }
};
