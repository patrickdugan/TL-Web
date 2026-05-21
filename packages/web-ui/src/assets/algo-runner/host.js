(function () {
  const config = window.__ALGO_RUNNER_CONFIG__ || {};
  const allowedParentOrigins = Array.isArray(config.allowedParentOrigins)
    ? config.allowedParentOrigins
    : [];
  const state = {
    port: null,
    strategies: new Map(),
    workers: new Map(),
    running: new Map(),
  };

  window.addEventListener('message', function (event) {
    if (!event.data || event.data.type !== 'runner.handshake') {
      return;
    }

    if (
      allowedParentOrigins.length > 0 &&
      !allowedParentOrigins.includes(event.origin)
    ) {
      return;
    }

    if (
      event.data.parentOrigin &&
      typeof event.data.parentOrigin === 'string' &&
      event.data.parentOrigin !== event.origin
    ) {
      return;
    }

    const port = event.ports && event.ports[0];
    if (!port) {
      return;
    }

    state.port = port;
    port.onmessage = onPortMessage;
    if (typeof port.start === 'function') {
      port.start();
    }
    port.postMessage({
      type: 'runner.ready',
      version: 1,
      capabilities: ['importStrategy', 'startStrategy', 'stopStrategy', 'getRunning'],
    });
  });

  function onPortMessage(event) {
    const message = event.data || {};
    const requestId = message.requestId;
    if (!message.type || !requestId) {
      return;
    }

    Promise.resolve()
      .then(function () {
        switch (message.type) {
          case 'runner.importStrategy':
            return importStrategy(message.payload || {});
          case 'runner.listStrategies':
            return listStrategies();
          case 'runner.startStrategy':
            return startStrategy(message.payload || {});
          case 'runner.stopStrategy':
            return stopStrategy((message.payload || {}).systemId);
          case 'runner.getRunning':
            return getRunning();
          default:
            throw new Error('Unsupported runner command: ' + message.type);
        }
      })
      .then(function (result) {
        reply(requestId, result);
      })
      .catch(function (error) {
        fail(requestId, error);
      });
  }

  function importStrategy(payload) {
    if (!payload.id || !payload.source) {
      throw new Error('Strategy payload requires id and source');
    }

    state.strategies.set(payload.id, {
      id: payload.id,
      source: payload.source,
      name: payload.name || payload.id,
      meta: payload.meta || {},
    });
    return { ok: true };
  }

  function listStrategies() {
    return Array.from(state.strategies.values()).map(function (strategy) {
      return {
        id: strategy.id,
        name: strategy.name,
        meta: strategy.meta,
      };
    });
  }

  function startStrategy(payload) {
    if (!payload.systemId || !payload.source) {
      throw new Error('Start payload requires systemId and source');
    }

    stopExisting(payload.systemId);

    const workerUrl = new URL('./host-worker.js', window.location.href);
    const worker = new Worker(workerUrl.toString());
    const startedAt = Date.now();
    const runningRow = {
      systemId: payload.systemId,
      startedAt: startedAt,
      amount: Number((payload.config || {}).amount || 0),
      pnlUsd: 0,
      status: 'running',
    };

    state.running.set(payload.systemId, runningRow);
    state.workers.set(payload.systemId, worker);

    worker.onmessage = function (workerEvent) {
      const data = workerEvent.data || {};

      if (data.type === 'metric') {
        const live = state.running.get(data.systemId);
        if (live) {
          live.pnlUsd = Number(data.pnl || 0);
          state.running.set(data.systemId, live);
        }
      }

      if (data.type === 'stopped' || data.type === 'error') {
        const live = state.running.get(data.systemId);
        if (live) {
          live.status = 'stopped';
          state.running.set(data.systemId, live);
        }
        stopExisting(data.systemId);
      }

      emitEvent(data);
    };

    worker.postMessage({
      type: 'run',
      systemId: payload.systemId,
      source: payload.source,
      config: payload.config || {},
      meta: payload.meta || {},
    });

    return {
      systemId: payload.systemId,
      startedAt: startedAt,
    };
  }

  function stopStrategy(systemId) {
    if (!systemId) {
      throw new Error('stopStrategy requires systemId');
    }

    const worker = state.workers.get(systemId);
    if (worker) {
      worker.postMessage({ type: 'stop', systemId: systemId });
    } else {
      stopExisting(systemId);
      emitEvent({ type: 'stopped', systemId: systemId });
    }

    return { ok: true };
  }

  function getRunning() {
    return Array.from(state.running.values());
  }

  function stopExisting(systemId) {
    const worker = state.workers.get(systemId);
    if (worker) {
      try {
        worker.terminate();
      } catch (_error) {}
      state.workers.delete(systemId);
    }

    const runningRow = state.running.get(systemId);
    if (runningRow) {
      runningRow.status = 'stopped';
      state.running.set(systemId, runningRow);
    }
  }

  function reply(requestId, result) {
    if (!state.port) {
      return;
    }
    state.port.postMessage({
      type: 'runner.response',
      requestId: requestId,
      ok: true,
      result: result,
    });
  }

  function fail(requestId, error) {
    if (!state.port) {
      return;
    }
    state.port.postMessage({
      type: 'runner.response',
      requestId: requestId,
      ok: false,
      error: error && error.message ? error.message : String(error),
    });
  }

  function emitEvent(event) {
    if (!state.port || !event || !event.type) {
      return;
    }

    state.port.postMessage({
      type: 'runner.event',
      event: event,
    });
  }
})();
