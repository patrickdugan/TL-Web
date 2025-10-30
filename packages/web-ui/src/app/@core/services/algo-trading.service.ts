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
    await this.bootstrapFromManifest();
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

    worker.onmessage = e => {
  if (e.data?.type === 'log') {
   
  }
};

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
      source: cfg.code, // worker will also try DB by id if needed
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

private async bootstrapFromManifest() {
  //try {
    const url = new URL('assets/algos/manifest.json', document.baseURI).toString();
    const res = await fetch(url);
    console.log('res '+JSON.stringify(res))
    if (!res.ok) {
      console.warn('[ALGO] manifest fetch failed', res.status, url);
      this.refreshDiscovery();
      this.refreshRunning();
      return;
    }

    const base = await res.json();
    // Accept either an array or {files:[...]}
    const rows: any[] = Array.isArray(base)
      ? base
      : (Array.isArray(base?.files) ? base.files : []);

    if (!rows.length) {
      console.warn('[ALGO] manifest parsed but empty');
      this.refreshDiscovery();
      this.refreshRunning();
      return;
    }

    for (const m of rows) {
      // accept fileName OR filename OR name; add .js if missing
      let fname = (m.fileName ?? m.filename ?? m.name ?? '').toString();
      if (!fname) {
        console.warn('[ALGO] skip manifest row without name/fileName', m);
        continue;
      }
      if (!/\.js$/i.test(fname)) fname += '.js';

      // try to fetch code, but do NOT block listing if it fails
      let code = '';
      try {
        const jsUrl = new URL(`assets/algos/${fname}`, document.baseURI).toString();
        const s = await fetch(jsUrl);
        if (s.ok) code = await s.text();
        else console.warn('[ALGO] strategy file missing', fname, s.status);
      } catch (e) {
        console.warn('[ALGO] fetch error for', fname, e);
      }

      const id: string = (m.id ?? 'sys-' + Math.random().toString(36).slice(2, 9)).toString();
      const name: string = (m.name ?? fname.replace(/\.js$/i, '')).toString();

      const row: StrategyRow = {
        id,
        name,
        symbol: (m.symbol ?? '3-PERP').toString(),
        mode: ((m.mode as 'SPOT' | 'FUTURES') ?? 'FUTURES'),
        leverage: (typeof m.leverage === 'number' ? m.leverage : 5),
        fileName: fname,
        size: (typeof m.size === 'number' ? m.size : (code ? code.length : 0)),
        createdAt: (typeof m.createdAt === 'number' ? m.createdAt : Date.now()),
        status: (m.status === 'running' ? 'running' : 'stopped'),
        amount: (typeof m.amount === 'number' ? m.amount : 0),
        pnlUsd: 0,
        roiPct: 0,
        copiers: 0,
        runtime: '0h',
        code, // may be ''
      };

      this.catalog.set(row.id, row);
      if (code) {
        try { await dbPutFile(row.id, code); } catch {}
      }
    }

    // snapshot to index (best-effort)
    try {
      await dbPutIndex(Array.from(this.catalog.values()).map(toIndexItem));
    } catch (e) {
      console.warn('[ALGO] dbPutIndex failed (non-fatal)', e);
    }

    console.debug('[ALGO] bootstrap complete; discovered', this.catalog.size, 'algos');
    this.refreshDiscovery();
    this.refreshRunning();

  /*} catch (e) {
    console.warn('[ALGO] bootstrapFromManifest fatal', e);
    this.refreshDiscovery();
    this.refreshRunning();
  }*/
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
