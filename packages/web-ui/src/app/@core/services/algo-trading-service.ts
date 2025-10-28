import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';

// ---- public types that the component imports ----

export interface StrategyRow {
  id: string;
  name: string;
  symbol: string;
  mode: 'SPOT' | 'FUTURES';
  leverage?: string;
  roiPct: number;
  pnlUsd: number;
  copiers: number;
  runtime: string;
  status: 'running' | 'stopped';
  amount: number; // planned allocation
  code: string;   // the actual algo source code
}

export interface RunningInstance {
  systemId: string;
  name: string;
  symbol: string;
  amount: number;
  pnlUsd: number;
  startedAt: number;
  status: 'running' | 'stopped';
}

// ---- internal handle we keep for each live worker ----
interface WorkerHandle {
  worker: Worker;
  systemId: string;
  startedAt: number;
  amount: number;
  pnlUsd: number;
  status: 'running' | 'stopped';
}

@Injectable({ providedIn: 'root' })
export class AlgoTradingService {
  // discovery$: "what strategies exist"
  public discovery$ = new BehaviorSubject<StrategyRow[]>([]);

  // running$: "what's actually alive right now"
  public running$ = new BehaviorSubject<RunningInstance[]>([]);

  // pretend this is our on-disk / IndexedDB catalog
  private catalog: Map<string, StrategyRow> = new Map();

  // live workers
  private workers: Map<string, WorkerHandle> = new Map();

  constructor() {
    this.seedDefaults();
    this.refreshDiscovery();
    this.refreshRunning();
  }

  // -------------------------------------------------
  // PUBLIC API that component calls
  // -------------------------------------------------

  fetchDiscovery() {
    this.refreshDiscovery();
  }

  fetchRunning() {
    this.refreshRunning();
  }

  registerStrategy(partial: {
    name: string;
    symbol: string;
    mode: 'SPOT' | 'FUTURES';
    leverage?: string;
    code: string;
  }) {
    const id = this.genId();
    const row: StrategyRow = {
      id,
      name: partial.name,
      symbol: partial.symbol,
      mode: partial.mode,
      leverage: partial.leverage ?? '10x',
      roiPct: 0,
      pnlUsd: 0,
      copiers: 0,
      runtime: '0h',
      status: 'stopped',
      amount: 0,
      code: partial.code,
    };
    this.catalog.set(id, row);
    this.refreshDiscovery();
  }

  runSystem(
    systemId: string,
    opts?: { amount?: number; counterVenueKey?: string; hedgeMode?: string }
  ) {
    const cfg = this.catalog.get(systemId);
    if (!cfg) return;

    // update catalog status
    cfg.status = 'running';
    cfg.amount = opts?.amount ?? cfg.amount ?? 0;
    this.catalog.set(systemId, cfg);

    // spin worker
    const worker = new Worker(
      new URL('./algo.worker.ts', import.meta.url), // adjust path if needed
      { type: 'module' }
    );

    const handle: WorkerHandle = {
      worker,
      systemId,
      startedAt: Date.now(),
      amount: cfg.amount,
      pnlUsd: 0,
      status: 'running',
    };
    this.workers.set(systemId, handle);

    // wire messages FROM worker
    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'log': {
          // forward console output so you can see algo chatter
          // NOTE: this is how you'll see console output from running algos
          console.log(
            `[ALGO ${msg.systemId} LOG]`,
            ...(msg.args || [])
          );
          break;
        }
        case 'metric': {
          // update pnl, etc.
          const h = this.workers.get(msg.systemId);
          if (h) {
            if (typeof msg.pnl === 'number') {
              h.pnlUsd = msg.pnl;
            }
            this.workers.set(msg.systemId, h);
            this.refreshRunning();
          }
          break;
        }
        case 'order': {
          // strategy is asking to place an order
          // TODO: risk checks, signing, relayer call
          console.warn(
            `[ALGO ${msg.systemId} ORDER REQUEST]`,
            msg.order
          );
          break;
        }
        case 'stopped': {
          // worker says it's done
          this.internalStop(msg.systemId);
          break;
        }
        case 'error': {
          console.error(
            `[ALGO ${msg.systemId} ERROR]`,
            msg.error
          );
          // optional: mark as stopped on error
          this.internalStop(msg.systemId);
          break;
        }
      }
    };

    // send RUN message TO worker with code + config/meta
    worker.postMessage({
      type: 'run',
      systemId,
      source: cfg.code,
      config: {
        amount: cfg.amount,
        hedgeMode: opts?.hedgeMode ?? 'mirror',
        counterVenueKey: opts?.counterVenueKey ?? '',
      },
      meta: {
        name: cfg.name,
        symbol: cfg.symbol,
        mode: cfg.mode,
        leverage: cfg.leverage,
      },
    });

    this.refreshDiscovery();
    this.refreshRunning();
  }

  stopSystem(systemId: string) {
    // ask worker to stop gracefully
    const h = this.workers.get(systemId);
    if (!h) {
      // nothing live, but mark catalog stopped anyway
      const cfg = this.catalog.get(systemId);
      if (cfg) {
        cfg.status = 'stopped';
        this.catalog.set(systemId, cfg);
      }
      this.refreshDiscovery();
      this.refreshRunning();
      return;
    }

    h.worker.postMessage({ type: 'stop', systemId });
    // we'll also kill it locally here; worker will echo 'stopped' anyway
    this.internalStop(systemId);
  }

  // -------------------------------------------------
  // INTERNAL HELPERS
  // -------------------------------------------------

  private internalStop(systemId: string) {
    const h = this.workers.get(systemId);
    if (h) {
      try {
        h.worker.terminate();
      } catch (e) {
        /* noop */
      }
      this.workers.delete(systemId);
    }

    const cfg = this.catalog.get(systemId);
    if (cfg) {
      cfg.status = 'stopped';
      this.catalog.set(systemId, cfg);
    }

    this.refreshDiscovery();
    this.refreshRunning();
  }

  private refreshDiscovery() {
    this.discovery$.next(
      Array.from(this.catalog.values()).map(row => ({
        ...row,
        runtime:
          row.status === 'running'
            ? this.prettyRuntime(row.id)
            : '0h',
        copiers: this.countCopiers(row.id),
        pnlUsd: this.getCurrentPnl(row.id),
        roiPct: this.calcRoiPct(row.id),
      }))
    );
  }

  private refreshRunning() {
    const live: RunningInstance[] = [];
    for (const [systemId, h] of this.workers.entries()) {
      const base = this.catalog.get(systemId);
      if (!base) continue;
      live.push({
        systemId,
        name: base.name,
        symbol: base.symbol,
        amount: h.amount,
        pnlUsd: h.pnlUsd,
        startedAt: h.startedAt,
        status: h.status,
      });
    }
    this.running$.next(live);
  }

  private seedDefaults() {
    // You can blow these away later; this is just to have 1-2 visible rows in the UI.
    const id1 = this.genId();
    const id2 = this.genId();
    this.catalog.set(id1, {
      id: id1,
      name: 'Scalper-1',
      symbol: '3-PERP',
      mode: 'FUTURES',
      leverage: '10x',
      roiPct: 0,
      pnlUsd: 0,
      copiers: 12,
      runtime: '0h',
      status: 'stopped',
      amount: 100,
      code: `
        // Example strategy code injected into the worker sandbox
        // Required: define onTick(ctx)
        // Optional: start(api, config, meta), stop()
        function start(api, config, meta) {
          api.log('Starting Scalper-1 on', meta.symbol, 'alloc', config.amount);
        }

        function onTick(ctx) {
          // pretend pnl drifts
          if (!self._pnl) self._pnl = 0;
          self._pnl += Math.sin(ctx.t / 5) * 0.5;
          api.metric(self._pnl);

          // demo order request every ~30 ticks
          if (ctx.t % 30 === 0) {
            api.placeOrder({
              side: 'BUY',
              size: 1,
              price: 100 + (ctx.t % 10),
            });
          }
        }

        function stop() {
          // cleanup if needed
        }
      `,
    });

    this.catalog.set(id2, {
      id: id2,
      name: 'TrendFollower',
      symbol: '5-PERP',
      mode: 'FUTURES',
      leverage: '5x',
      roiPct: 0,
      pnlUsd: 0,
      copiers: 4,
      runtime: '0h',
      status: 'stopped',
      amount: 250,
      code: `
        function start(api, config, meta) {
          api.log('TrendFollower booted', meta);
        }

        function onTick(ctx) {
          if (!self._pnl2) self._pnl2 = 50;
          self._pnl2 += (Math.random() - 0.5) * 0.2;
          api.metric(self._pnl2);
        }

        function stop() {
          // tidy up
        }
      `,
    });
  }

  private genId(): string {
    // quick local unique-ish id
    return 'sys-' + Math.random().toString(36).slice(2, 9);
  }

  private getCurrentPnl(systemId: string): number {
    const h = this.workers.get(systemId);
    if (h) return h.pnlUsd;
    const row = this.catalog.get(systemId);
    return row?.pnlUsd ?? 0;
  }

  private calcRoiPct(systemId: string): number {
    const base = this.catalog.get(systemId);
    if (!base) return 0;
    const pnl = this.getCurrentPnl(systemId);
    const amt = base.amount || 1;
    return amt === 0 ? 0 : (pnl / amt) * 100;
  }

  private countCopiers(_systemId: string): number {
    // stub: you could track how many users are running this config
    return 1;
  }

  private prettyRuntime(systemId: string): string {
    const h = this.workers.get(systemId);
    if (!h) return '0h';
    const ms = Date.now() - h.startedAt;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return hours + 'h';
  }
}
