import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { parseAlgoMetaFromSource, AlgoIndexItem  } from '../algo-meta';
import { dbGetIndex, dbPutIndex, dbPutFile, dbGetFile } from '../algo-db';
import { Subject } from 'rxjs'; // (alongside BehaviorSubject import)



// ---- public types that the component imports ----
export interface StrategyRow /* keep this in the same file */ {
  // identity & catalog/meta
  id: string;

  // parsed from source (via parseAlgoMetaFromSource)
  name: string;
  symbol: string;
  mode: 'SPOT' | 'FUTURES';
  leverage?: number;

  // file/catalog bookkeeping (required if you store source in IndexedDB)
  fileName?: string;
  size?: number;        // bytes
  createdAt?: number;   // ms epoch

  // runtime/UX fields
  roiPct: number;
  pnlUsd: number;
  copiers: number;
  runtime: string;
  status: 'running' | 'stopped';
  amount: number;      // planned allocation
  venue?: string;
  description?: string;

  // optional: keep for seed rows that inline code (worker will prefer DB if present)
  code?: string;
}

// Force StrategyRow -> AlgoIndexItem without relying on r.meta
const toIndexItem = (r: StrategyRow): AlgoIndexItem => ({
  id: r.id,
  name: r.name,
  fileName: r.fileName ?? `${r.id}.js`,  // deterministic fallback
  size: r.size ?? 0,
  createdAt: r.createdAt ?? Date.now(),
  status: r.status,
  ...(r.amount !== undefined ? { amount: r.amount } : {}),
  // meta is optional on AlgoIndexItem; omit it to avoid typing issues
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
  public logs$ = new Subject<{ systemId: string; args: any[] } | string[]>();

  // pretend this is our on-disk / IndexedDB catalog
  private catalog: Map<string, StrategyRow> = new Map();

  // live workers
  private workers: Map<string, WorkerHandle> = new Map();

  constructor() {
    this.bootstrapFromManifest();
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
  
  async registerStrategy(file: File) {
    const source = await file.text();
    const meta = parseAlgoMetaFromSource(source);
    const id = this.genId();

    
  const item: StrategyRow = {
    // ---- required from AlgoIndexItem
    id,
    name: meta?.name ?? (file?.name?.replace(/\.[^.]+$/, '') || `Strategy ${id.slice(-4)}`),
    symbol: meta?.symbol ?? '3-PERP',
    venue: meta?.venue ?? 'TL',
    mode: (meta?.mode as 'SPOT' | 'FUTURES') ?? 'FUTURES',
    leverage: meta?.leverage ?? 10,
    description: meta?.description ?? '',

    // file metadata (required)
    fileName: file?.name ?? `${id}.js`,
    size: typeof file?.size === 'number' ? file.size : new Blob([source]).size,
    createdAt: Date.now(),

    // ---- StrategyRow extras
    amount: 0,
    status: 'stopped',
    pnlUsd: 0,
    roiPct: 0,
    copiers: 0,
    runtime: '0h',
  };

    await dbPutFile(id, source);
    const index = Array.from(this.catalog.values());
    index.push(item);
    await dbPutIndex(index.map(toIndexItem));

    await dbManifestDeltaPut({
      id,
      name: item.name,
      fileName: item.fileName!,     // you set this above
      size: item.size ?? source.length,
      createdAt: item.createdAt ?? Date.now(),
      status: 'stopped',
      amount: item.amount ?? 0,
    });


    this.catalog.set(id, item);
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
      new URL('../algo.worker.ts', import.meta.url), // adjust path if needed
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
          // push to stream for the component
          this.logs$.next({ systemId: msg.systemId, args: msg.args || [] });
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

// types for manifest rows (matches your index.json)
type ManifestItem = {
  id: string;
  name: string;
  fileName: string;
  size: number;
  createdAt: number;
  status: 'running' | 'stopped';
  amount: number;
};

private async bootstrapFromManifest() {
  // 1) load base manifest.json shipped with app
  const baseUrl = new URL('assets/algos/manifest.json', document.baseURI).toString();
  let base: any[] = [];
  try {
    const res = await fetch(baseUrl);
    if (res.ok) base = await res.json();
  } catch {}

  // 2) load delta rows persisted from prior uploads
  const delta = await dbManifestDeltaAll(); // [] if none

  // 3) merge by fileName (delta overwrites/extends base)
  const byFile = new Map<string, any>();
  for (const r of base) byFile.set(r.fileName, r);
  for (const r of delta) byFile.set(r.fileName, r);

  // 4) hydrate catalog/IDB files
  for (const m of byFile.values()) {
    const srcUrl = new URL(`assets/algos/${m.fileName}`, document.baseURI).toString();
    let code = '';
    try {
      const res = await fetch(srcUrl);
      if (res.ok) code = await res.text();
    } catch {}
    // If not found in assets (e.g., upload only), try loading the file body you saved keyed by id
    if (!code) {
      // you already save sources keyed by id -> retrieve fallback
      const maybe = await dbGetFile(m.id);
      if (maybe) code = maybe;
    }

    const row: StrategyRow = {
      id: m.id,
      name: m.name ?? m.fileName.replace(/\.js$/i, ''),
      symbol: '3-PERP',
      mode: 'FUTURES',
      leverage: 5,
      fileName: m.fileName,
      size: m.size ?? code.length,
      createdAt: m.createdAt ?? Date.now(),
      status: m.status ?? 'stopped',
      amount: m.amount ?? 0,
      pnlUsd: 0,
      roiPct: 0,
      copiers: 0,
      runtime: '0h',
      code,
    };
    this.catalog.set(row.id, row);
    if (code) await dbPutFile(row.id, code);
  }

    await dbPutIndex(Array.from(this.catalog.values()).map(toIndexItem)); // aligns with your current index writing
    this.refreshDiscovery();
  }
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
