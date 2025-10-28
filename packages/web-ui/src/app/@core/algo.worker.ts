self.onmessage = (ev) => {
  const msg = ev.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'run') {
    const { systemId, source, config, meta } = msg;
    try {
      const api = {
        log: (...args) => self.postMessage({ type: 'log', systemId, args }),
        metric: (pnl) => self.postMessage({ type: 'metric', systemId, pnl }),
        placeOrder: (order) => self.postMessage({ type: 'order', systemId, order }),
      };
      const func = new Function('api', 'config', 'meta', source);
      func(api, config, meta);

      let t = 0;
      const loop = () => {
        t++;
        try {
          if (typeof onTick === 'function') onTick({ t, config, meta });
        } catch (e) {
          self.postMessage({ type: 'error', systemId, error: e.message });
        }
        if (!self._stop) setTimeout(loop, 1000);
      };
      loop();
    } catch (e) {
      self.postMessage({ type: 'error', systemId, error: e.message });
    }
  } else if (msg.type === 'stop') {
    self._stop = true;
    if (typeof stop === 'function') {
      try { stop(); } catch {}
    }
    self.postMessage({ type: 'stopped', systemId: msg.systemId });
  }
};
