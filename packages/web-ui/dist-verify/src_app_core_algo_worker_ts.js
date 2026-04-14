/******/ (() => { // webpackBootstrap
/******/ 	"use strict";
var __webpack_exports__ = {};
/*!**************************************!*\
  !*** ./src/app/@core/algo.worker.ts ***!
  \**************************************/

/* src/app/@core/algo.worker.ts */
const ctx = self; // treat as DedicatedWorkerGlobalScope
let running = false;
let timer = null;
let userOnTick = null;
let userStop = null;
function post(msg) {
    // In worker context, postMessage(message) is fine; typing via ctx avoids DOM overload.
    ctx.postMessage(msg);
}
function safeClearTimer() {
    if (timer) {
        clearTimeout(timer);
        timer = null;
    }
}
ctx.onmessage = (ev) => {
    var _a, _b;
    const msg = ev.data;
    if (!msg || typeof msg !== 'object')
        return;
    if (msg.type === 'run' && !running) {
        running = true;
        const { systemId, source, config, meta } = msg;
        try {
            const api = {
                log: (...args) => post({ type: 'log', systemId, args }),
                metric: (pnl) => post({ type: 'metric', systemId, pnl }),
                placeOrder: (order) => post({ type: 'order', systemId, order }),
            };
            // Evaluate user strategy in a local scope; capture exports from globals.
            // eslint-disable-next-line no-new-func
            const fn = new Function('api', 'config', 'meta', `
          "use strict";
          // User code can define: start(api, config, meta), onTick(ctx), stop()
          ${source || ''};
          // expose any globals the user defined:
          return {
            start: (typeof start === 'function') ? start : undefined,
            onTick: (typeof onTick === 'function') ? onTick : undefined,
            stop: (typeof stop === 'function') ? stop : undefined
          };
        `);
            const exports = fn(api, config || {}, meta || {}) || {};
            userOnTick = typeof exports.onTick === 'function' ? exports.onTick : null;
            const userStart = typeof exports.start === 'function' ? exports.start : null;
            userStop = typeof exports.stop === 'function' ? exports.stop : null;
            try {
                userStart && userStart(api, config, meta);
            }
            catch (e) {
                post({ type: 'error', systemId, error: String(((_a = e) === null || _a === void 0 ? void 0 : _a.message) || e) });
            }
            let t = 0;
            const loop = () => {
                var _a;
                if (!running)
                    return;
                t++;
                try {
                    userOnTick && userOnTick({ t, config, meta });
                }
                catch (e) {
                    post({ type: 'error', systemId, error: String(((_a = e) === null || _a === void 0 ? void 0 : _a.message) || e) });
                }
                timer = setTimeout(loop, 1000);
            };
            loop();
        }
        catch (e) {
            post({ type: 'error', systemId: msg.systemId, error: String(((_b = e) === null || _b === void 0 ? void 0 : _b.message) || e) });
            running = false;
            safeClearTimer();
        }
    }
    else if (msg.type === 'stop') {
        running = false;
        safeClearTimer();
        try {
            userStop && userStop();
        }
        catch (_c) { }
        post({ type: 'stopped', systemId: msg.systemId });
    }
};

/******/ })()
;
//# sourceMappingURL=src_app_core_algo_worker_ts.js.map