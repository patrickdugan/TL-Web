var running = false;
var timer = null;
var userOnTick = null;
var userStop = null;

function post(message) {
  self.postMessage(message);
}

function clearLoop() {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
}

self.onmessage = function (event) {
  var message = event.data || {};

  if (message.type === 'run' && !running) {
    running = true;
    startRunner(message);
    return;
  }

  if (message.type === 'stop') {
    running = false;
    clearLoop();
    try {
      if (typeof userStop === 'function') {
        userStop();
      }
    } catch (_error) {}
    post({ type: 'stopped', systemId: message.systemId });
  }
};

function startRunner(message) {
  var systemId = message.systemId;
  var source = message.source || '';
  var config = message.config || {};
  var meta = message.meta || {};

  try {
    var api = {
      log: function () {
        post({ type: 'log', systemId: systemId, args: Array.prototype.slice.call(arguments) });
      },
      metric: function (pnl) {
        post({ type: 'metric', systemId: systemId, pnl: pnl });
      },
      placeOrder: function (order) {
        post({ type: 'order', systemId: systemId, order: order });
      },
    };

    var fn = new Function(
      'api',
      'config',
      'meta',
      '"use strict";\n' +
        source +
        '\nreturn {' +
        'start: (typeof start === "function") ? start : undefined,' +
        'onTick: (typeof onTick === "function") ? onTick : undefined,' +
        'stop: (typeof stop === "function") ? stop : undefined' +
        '};'
    );

    var exports = fn(api, config, meta) || {};
    var userStart = typeof exports.start === 'function' ? exports.start : null;
    userOnTick = typeof exports.onTick === 'function' ? exports.onTick : null;
    userStop = typeof exports.stop === 'function' ? exports.stop : null;

    if (userStart) {
      userStart(api, config, meta);
    }

    var tick = 0;
    var loop = function () {
      if (!running) {
        return;
      }

      tick += 1;

      try {
        if (typeof userOnTick === 'function') {
          userOnTick({ t: tick, config: config, meta: meta });
        }
      } catch (error) {
        post({ type: 'error', systemId: systemId, error: String((error && error.message) || error) });
      }

      timer = setTimeout(loop, 1000);
    };

    loop();
  } catch (error) {
    running = false;
    clearLoop();
    post({ type: 'error', systemId: systemId, error: String((error && error.message) || error) });
  }
}
