import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { parseAlgoMetaFromSource, AlgoIndexItem } from '../algo-meta';
import {
  dbGetIndex,
  dbPutIndex,
  dbPutFile,
  dbGetFile,
  dbManifestDeltaPut,
  dbManifestDeltaAll,
} from '../algo-db';

// ---------- Types ----------
export interface StrategyRow {
  id: string;
  name: string;
  systemKey?: string;
  symbol: string;
  mode: 'SPOT' | 'FUTURES';
  leverage?: number;
  fileName?: string;
  size?: number;
  createdAt?: number;
  roiPct: number;
  pnlUsd: number;
  copiers: number;
  runtime: string;
  status: 'running' | 'stopped';
  amount: number;
  venue?: string;
  description?: string;
  icon?: string;
  frequencyLabel?: string;
  code?: string; // optional inline code; worker prefers DB if present
}

const toIndexItem = (r: StrategyRow): AlgoIndexItem => ({
  id: r.id,
  name: r.name,
  fileName: r.fileName ?? `${r.id}.js`,
  size: r.size ?? 0,
  createdAt: r.createdAt ?? Date.now(),
  status: r.status,
  ...(r.amount !== undefined ? { amount: r.amount } : {}),
});

export interface RunningInstance {
  systemId: string;
  name: string;
  symbol: string;
  amount: number;
  pnlUsd: number;
  startedAt: number;
  status: 'running' | 'stopped';
}

interface WorkerHandle {
  worker: Worker;
  systemId: string;
  startedAt: number;
  amount: number;
  pnlUsd: number;
  status: 'running' | 'stopped';
}

// For manifest bootstrap (base + delta)
type ManifestItem = {
  id: string;
  name: string;
  fileName: string;
  size: number;
  createdAt: number;
  status: 'running' | 'stopped';
  amount: number;
};

type HardcodedProfile = {
  key: string;
  strategyType: 'range_vdip_trail' | 'ribbon_pucker_trend';
  name: string;
  icon: string;
  frequencyLabel: string;
  fileName: string;
  algoModule: string;
  symbol: string;
  mode: 'SPOT' | 'FUTURES';
  leverage: number;
  defaultAmount: number;
  constructorConfig: {
    cadence: 'swing' | 'daily' | 'intraday' | 'hf';
    tickEvery: number;
    riskBps: number;
  };
  description: string;
};

const HARDCODED_PROFILES: HardcodedProfile[] = [
  {
    key: 'swing_2_3_week',
    strategyType: 'range_vdip_trail',
    name: 'Swing Atlas',
    icon: '🧭',
    frequencyLabel: 'Trades 2-3 times a week',
    fileName: 'swing_atlas.hardcoded.js',
    algoModule: '/assets/algos/range_vdip_trail.js',
    symbol: 'LTC/USDT',
    mode: 'SPOT',
    leverage: 1,
    defaultAmount: 0.025,
    constructorConfig: { cadence: 'swing', tickEvery: 3600, riskBps: 35 },
    description: 'Low-frequency swing system tuned for slower regime shifts.',
  },
  {
    key: 'scalp_2_3_day',
    strategyType: 'range_vdip_trail',
    name: 'Pulse Scalp',
    icon: '⚡',
    frequencyLabel: 'Trades 2-3 times a day',
    fileName: 'pulse_scalp.hardcoded.js',
    algoModule: '/assets/algos/range_vdip_trail.js',
    symbol: 'LTC/USDT',
    mode: 'SPOT',
    leverage: 2,
    defaultAmount: 0.025,
    constructorConfig: { cadence: 'daily', tickEvery: 900, riskBps: 22 },
    description: 'Session-based scalper focused on medium intraday momentum.',
  },
  {
    key: 'active_10_20_day',
    strategyType: 'ribbon_pucker_trend',
    name: 'Ribbon Intraday',
    icon: '📈',
    frequencyLabel: 'Trades 10-20 times a day',
    fileName: 'ribbon_intraday.hardcoded.js',
    algoModule: '/assets/algos/ribbon_pucker_trend.js',
    symbol: 'LTC/USDT',
    mode: 'FUTURES',
    leverage: 3,
    defaultAmount: 0.025,
    constructorConfig: { cadence: 'intraday', tickEvery: 180, riskBps: 15 },
    description: 'Higher-frequency trend/ribbon executor for active sessions.',
  },
  {
    key: 'ultra_many_day',
    strategyType: 'ribbon_pucker_trend',
    name: 'Orderflow Sprint',
    icon: '🚀',
    frequencyLabel: 'Trades many times a day',
    fileName: 'orderflow_sprint.hardcoded.js',
    algoModule: '/assets/algos/ribbon_pucker_trend.js',
    symbol: 'LTC/USDT',
    mode: 'FUTURES',
    leverage: 5,
    defaultAmount: 0.025,
    constructorConfig: { cadence: 'hf', tickEvery: 45, riskBps: 10 },
    description: 'High-turnover orderflow model with strict risk throttles.',
  },
];

// ---------- Service ----------
@Injectable({ providedIn: 'root' })
export class AlgoTradingService {
  public discovery$ = new BehaviorSubject<StrategyRow[]>([]);
  public running$ = new BehaviorSubject<RunningInstance[]>([]);
  public logs$ = new Subject<{ systemId: string; args: any[] } | string[]>();

  private catalog = new Map<string, StrategyRow>();
  private workers = new Map<string, WorkerHandle>();
  // NEW: explicit init gate
  private inited = false;

  constructor() {
    // Do NOT bootstrap in the ctor anymore (hard to observe in prod).
    console.log('[ALGO] service constructed');
  }

  /** Call once from component */
  public async init(): Promise<void> {
    if (this.inited) { console.log('[ALGO] init() already done'); return; }
    this.inited = true;
    console.log('[ALGO] init() start');
    await this.bootstrapHardcodedCatalog();
    console.log('[ALGO] init() done; catalog size =', this.catalog.size);
    this.refreshDiscovery();
    this.refreshRunning();
  }

  // -------------------------------------------------
  // PUBLIC API
  // -------------------------------------------------
  fetchDiscovery() { this.refreshDiscovery(); }
  fetchRunning()   { this.refreshRunning(); }

  async registerStrategy(file: File) {
    const source = await file.text();
    const meta = parseAlgoMetaFromSource(source);
    const id = this.genId();

    const item: StrategyRow = {
      id,
      name: meta?.name ?? (file?.name?.replace(/\.[^.]+$/, '') || `Strategy ${id.slice(-4)}`),
      symbol: meta?.symbol ?? '3-PERP',
      venue: meta?.venue ?? 'TL',
      mode: (meta?.mode as 'SPOT' | 'FUTURES') ?? 'FUTURES',
      leverage: meta?.leverage ?? 10,
      description: meta?.description ?? '',
      fileName: file?.name ?? `${id}.js`,
      size: typeof file?.size === 'number' ? file.size : new Blob([source]).size,
      createdAt: Date.now(),
      amount: 0,
      status: 'stopped',
      pnlUsd: 0,
      roiPct: 0,
      copiers: 0,
      runtime: '0h',
    };

    // Persist source and index
    await dbPutFile(id, source);

    const index = Array.from(this.catalog.values());
    index.push(item);
    await dbPutIndex(index.map(toIndexItem));

    // Append to manifest delta so it shows on next boot
    await dbManifestDeltaPut({
      id,
      name: item.name,
      fileName: item.fileName!,
      size: item.size ?? source.length,
      createdAt: item.createdAt ?? Date.now(),
      status: 'stopped',
      amount: item.amount ?? 0,
    });

    this.catalog.set(id, item);
    this.refreshDiscovery();
  }

  runSystem(systemId: string, opts?: { amount?: number; counterVenueKey?: string; hedgeMode?: string }) {
    const cfg = this.catalog.get(systemId);
    if (!cfg) return;

    cfg.status = 'running';
    cfg.amount = opts?.amount ?? cfg.amount ?? 0;
    this.catalog.set(systemId, cfg);

    const worker = new Worker(new URL('../algo.worker.ts', import.meta.url), { type: 'module' });

    const handle: WorkerHandle = {
      worker,
      systemId,
      startedAt: Date.now(),
      amount: cfg.amount,
      pnlUsd: 0,
      status: 'running',
    };
    this.workers.set(systemId, handle);

    worker.onmessage = (ev: MessageEvent) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'log':
          const text = msg.msg || (Array.isArray(msg.args) ? msg.args.join(' ') : String(msg));
          this.logs$.next({ systemId: msg.systemId || 'worker', args: [text] });break;
        case 'metric': {
          const h = this.workers.get(msg.systemId);
          if (h && typeof msg.pnl === 'number') {
            h.pnlUsd = msg.pnl;
            this.workers.set(msg.systemId, h);
            this.refreshRunning();
          }
          break;
        }
        case 'order':
          console.warn(`[ALGO ${msg.systemId} ORDER REQUEST]`, msg.order);
          break;
        case 'stopped':
        case 'error':
          if (msg.type === 'error') console.error(`[ALGO ${msg.systemId} ERROR]`, msg.error);
          this.internalStop(msg.systemId);
          break;
      }
    };

    worker.postMessage({
      type: 'run',
      systemId,
      source: cfg.code || this.buildHardcodedWorkerSource(cfg),
      config: {
        amount: cfg.amount,
        hedgeMode: opts?.hedgeMode ?? 'mirror',
        counterVenueKey: opts?.counterVenueKey ?? '',
      },
      meta: { name: cfg.name, symbol: cfg.symbol, mode: cfg.mode, leverage: cfg.leverage },
    });

    this.refreshDiscovery();
    this.refreshRunning();
  }

  stopSystem(systemId: string) {
    const h = this.workers.get(systemId);
    if (!h) {
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
    this.internalStop(systemId);
  }

  // ---------- Internal ----------
  private internalStop(systemId: string) {
    const h = this.workers.get(systemId);
    if (h) {
      try { h.worker.terminate(); } catch {}
      this.workers.delete(systemId);
    }
    const cfg = this.catalog.get(systemId);
    if (cfg) { cfg.status = 'stopped'; this.catalog.set(systemId, cfg); }
    this.refreshDiscovery();
    this.refreshRunning();
  }

  private refreshDiscovery() {
    const rows = Array.from(this.catalog.values()).map((row) => ({
      ...row,
      runtime: row.status === 'running' ? this.prettyRuntime(row.id) : '0h',
      copiers: this.countCopiers(row.id),
      pnlUsd: this.getCurrentPnl(row.id),
      roiPct: this.calcRoiPct(row.id),
    }));
    this.discovery$.next(rows);
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

  private async bootstrapHardcodedCatalog() {
    this.catalog.clear();
    const now = Date.now();

    for (const p of HARDCODED_PROFILES) {
      const id = `sys-${p.key}`;
      const code = this.buildHardcodedWorkerSource({
        id,
        name: p.name,
        systemKey: p.key,
        symbol: p.symbol,
        mode: p.mode,
        leverage: p.leverage,
      } as StrategyRow);

      const row: StrategyRow = {
        id,
        name: p.name,
        systemKey: p.key,
        symbol: p.symbol,
        mode: p.mode,
        leverage: p.leverage,
        fileName: p.fileName,
        size: code.length,
        createdAt: now,
        status: 'stopped',
        amount: p.defaultAmount,
        pnlUsd: 0,
        roiPct: 0,
        copiers: 0,
        runtime: '0h',
        venue: 'TL-Web',
        icon: p.icon,
        frequencyLabel: p.frequencyLabel,
        description: p.description,
        code,
      };

      this.catalog.set(id, row);
      try { await dbPutFile(id, code); } catch {}
    }

    try {
      await dbPutIndex(Array.from(this.catalog.values()).map(toIndexItem));
    } catch (e) {
      console.warn('[ALGO] dbPutIndex failed (non-fatal)', e);
    }
  }

  private buildHardcodedWorkerSource(row: StrategyRow): string {
    const profile = HARDCODED_PROFILES.find((p) => p.key === row.systemKey) || HARDCODED_PROFILES[0];
    const constructorConfig = JSON.stringify(profile.constructorConfig);
    const name = JSON.stringify(row.name || profile.name);
    const symbol = JSON.stringify(row.symbol || profile.symbol);
    const mode = JSON.stringify(row.mode || profile.mode);
    const strategyType = JSON.stringify(profile.strategyType);
    const algoModule = JSON.stringify(profile.algoModule);

    // Moneyball-style factory selection: choose strategy by type and pass size/config at constructor time.
    return `
class RangeVDipTrailStrategy {
  constructor(args) { this.args = args; this.tick = 0; this.pnl = 0; }
  onTick(api) {
    this.tick += 1;
    const every = Math.max(1, Number(this.args.constructorConfig?.tickEvery || 3600));
    if ((this.tick % every) !== 0) return this.pnl;
    const base = Number(this.args.amount || 0);
    const riskBps = Number(this.args.constructorConfig?.riskBps || 20);
    const drift = (Math.cos(this.tick / Math.max(2, every)) * (riskBps / 10000));
    this.pnl += base * drift;
    api.log('[RangeVDipTrail:onTick]', 'size=', base, 'tick=', this.tick, 'pnl=', this.pnl.toFixed(8));
    return this.pnl;
  }
}

class RibbonPuckerTrendStrategy {
  constructor(args) { this.args = args; this.tick = 0; this.pnl = 0; }
  onTick(api) {
    this.tick += 1;
    const every = Math.max(1, Number(this.args.constructorConfig?.tickEvery || 180));
    if ((this.tick % every) !== 0) return this.pnl;
    const base = Number(this.args.amount || 0);
    const riskBps = Number(this.args.constructorConfig?.riskBps || 12);
    const drift = (Math.sin(this.tick / Math.max(2, every)) * (riskBps / 10000));
    this.pnl += base * drift;
    api.log('[RibbonPucker:onTick]', 'size=', base, 'tick=', this.tick, 'pnl=', this.pnl.toFixed(8));
    return this.pnl;
  }
}

function createStrategy(args, api) {
  const req = (typeof require === 'function') ? require : null;
  if (req) {
    try {
      switch (args.strategyType) {
        case 'range_vdip_trail':
          req(args.algoModule);
          break;
        case 'ribbon_pucker_trend':
          req(args.algoModule);
          break;
        default:
          break;
      }
      api.log('[APIAlgo:require]', 'loaded', args.algoModule);
    } catch (err) {
      api.log('[APIAlgo:require:fallback]', String(err?.message || err));
    }
  }
  switch (args.strategyType) {
    case 'range_vdip_trail':
      return new RangeVDipTrailStrategy(args);
    case 'ribbon_pucker_trend':
      return new RibbonPuckerTrendStrategy(args);
    default:
      return new RibbonPuckerTrendStrategy(args);
  }
}

class APIAlgo {
  constructor(args) {
    this.args = args || {};
    this.strategy = null;
    this.pnl = 0;
  }
  start(api) {
    this.api = api;
    this.strategy = createStrategy(this.args, api);
    this.api.log('[APIAlgo:start]', this.args.name, this.args.strategyType, this.args.symbol, 'size=', this.args.amount);
  }
  onTick() {
    if (!this.strategy) return;
    this.pnl = this.strategy.onTick(this.api);
    this.api.metric(this.pnl);
  }
  stop() {
    this.api && this.api.log('[APIAlgo:stop]', this.args.name);
  }
}
let instance = null;
function start(api, config, meta) {
  instance = new APIAlgo({
    name: ${name},
    symbol: ${symbol},
    mode: ${mode},
    strategyType: ${strategyType},
    algoModule: ${algoModule},
    amount: Number(config?.amount || 0),
    constructorConfig: ${constructorConfig},
    meta: meta || {}
  });
  instance.start(api);
}
function onTick(ctx) {
  if (instance) instance.onTick(ctx || {});
}
function stop() {
  if (instance) instance.stop();
}
`;
  }


  private genId(): string {
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
    return 1; // placeholder
  }

  private prettyRuntime(systemId: string): string {
    const h = this.workers.get(systemId);
    if (!h) return '0h';
    const ms = Date.now() - h.startedAt;
    const hours = Math.floor(ms / (1000 * 60 * 60));
    return `${hours}h`;
  }
}
