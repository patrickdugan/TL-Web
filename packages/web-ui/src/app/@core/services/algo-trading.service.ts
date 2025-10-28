import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { parseAlgoMetaFromSource, AlgoIndexItem } from './algo-meta';
import {
  dbGetIndex,
  dbPutIndex,
  dbPutFile,
  dbGetFile,
} from './algo-db';

// ========== TYPES ==========
export interface StrategyRow extends AlgoIndexItem {
  id: string;
  status: 'running' | 'stopped';
  amount: number;
  pnlUsd?: number;
  roiPct?: number;
}

export interface RunningRow {
  id: string;
  name: string;
  allocated: number;
  pnl: number;
  startedAt: number;
  status: 'running' | 'stopped';
}

interface WorkerHandle {
  id: string;
  worker: Worker;
  startedAt: number;
  allocated: number;
  pnl: number;
  status: 'running' | 'stopped';
}

@Injectable({ providedIn: 'root' })
export class AlgoTradingService {
  discovery$ = new BehaviorSubject<StrategyRow[]>([]);
  running$ = new BehaviorSubject<RunningRow[]>([]);
  logs$ = new Subject<{ systemId: string; args: any[] }>();

  private catalog: Map<string, StrategyRow> = new Map();
  private workers: Map<string, WorkerHandle> = new Map();

  constructor() {
    this.bootstrap();
  }

  private async bootstrap() {
    try {
      const index = (await dbGetIndex()) as StrategyRow[] | undefined;
      if (index && Array.isArray(index) && index.length) {
        index.forEach(item => this.catalog.set(item.id, item));
      } else {
        await this.seedDefaults();
      }
    } catch {
      await this.seedDefaults();
    }

    this.refreshDiscovery();
    this.refreshRunning();

    for (const [id, row] of this.catalog.entries()) {
      if (row.status === 'running') {
        this.runSystem(id, { amount: row.amount });
      }
    }
  }

  async fetchDiscovery() {
    this.refreshDiscovery();
  }

  async fetchRunning() {
    this.refreshRunning();
  }

  async registerStrategy(file: File) {
    const source = await file.text();
    const meta = parseAlgoMetaFromSource(source);
    const id = this.genId();

    const item: StrategyRow = {
      id,
      ...meta,
      amount: 0,
      status: 'stopped',
      pnlUsd: 0,
      roiPct: 0,
    };

    await dbPutFile(id, source);
    const index = Array.from(this.catalog.values());
    index.push(item);
    await dbPutIndex(index);

    this.catalog.set(id, item);
    this.refreshDiscovery();
  }

  runSystem(systemId: string, opts?: { amount?: number }) {
    const cfg = this.catalog.get(systemId);
    if (!cfg) return;

    cfg.status = 'running';
    cfg.amount = opts?.amount ?? cfg.amount ?? 0;
    this.catalog.set(systemId, cfg);
    void this.persist();

    const worker = new Worker(new URL('./algo.worker.ts', import.meta.url), {
      type: 'module',
    });

    const handle: WorkerHandle = {
      id: systemId,
      worker,
      startedAt: Date.now(),
      allocated: cfg.amount,
      pnl: 0,
      status: 'running',
    };
    this.workers.set(systemId, handle);

    worker.onmessage = (ev: MessageEvent<any>) => {
      const msg = ev.data;
      if (!msg || typeof msg !== 'object') return;

      switch (msg.type) {
        case 'log':
          console.log(`[ALGO ${msg.systemId}]`, ...(msg.args || []));
          this.logs$.next({ systemId: msg.systemId, args: msg.args || [] });
          break;
        case 'metric':
          const pnl = typeof msg.pnl === 'number' ? msg.pnl : 0;
          handle.pnl = pnl;
          this.refreshRunning();
          this.refreshDiscovery();
          break;
        case 'order':
          console.warn(`[ALGO ${msg.systemId}] ORDER`, msg.order);
          break;
        case 'error':
          console.error(`[ALGO ${msg.systemId}] ERROR`, msg.error);
          this.stopSystem(systemId);
          break;
        case 'stopped':
          this.stopSystem(systemId);
          break;
      }
    };

    dbGetFile(systemId).then((source: string) => {
      worker.postMessage({
        type: 'run',
        systemId,
        source,
        config: { amount: cfg.amount },
        meta: {
          name: cfg.name,
          symbol: cfg.symbol,
          mode: cfg.mode,
          leverage: cfg.leverage,
        },
      });
    });

    this.refreshDiscovery();
    this.refreshRunning();
  }

  stopSystem(systemId: string) {
    const h = this.workers.get(systemId);
    if (h) {
      try {
        h.worker.postMessage({ type: 'stop', systemId });
      } catch {}
      try {
        h.worker.terminate();
      } catch {}
      this.workers.delete(systemId);
    }

    const cfg = this.catalog.get(systemId);
    if (cfg) {
      cfg.status = 'stopped';
      this.catalog.set(systemId, cfg);
    }

    void this.persist();
    this.refreshDiscovery();
    this.refreshRunning();
  }

  private refreshDiscovery() {
    const list: StrategyRow[] = [];
    for (const row of this.catalog.values()) {
      const h = this.workers.get(row.id);
      const pnl = h ? h.pnl : row.pnlUsd ?? 0;
      const roiPct = row.amount ? (pnl / row.amount) * 100 : 0;
      list.push({
        ...row,
        pnlUsd: pnl,
        roiPct,
      });
    }
    this.discovery$.next(list);
  }

  private refreshRunning() {
    const list: RunningRow[] = [];
    for (const [id, h] of this.workers.entries()) {
      const base = this.catalog.get(id);
      if (!base) continue;
      list.push({
        id,
        name: base.name,
        allocated: h.allocated,
        pnl: h.pnl,
        startedAt: h.startedAt,
        status: h.status,
      });
    }
    this.running$.next(list);
  }

  private async persist() {
    await dbPutIndex(Array.from(this.catalog.values()));
  }

  private genId() {
    return 'sys-' + Math.random().toString(36).slice(2, 9);
  }

  private async seedDefaults() {
    const code = `
      function start(api, config, meta) {
        api.log('Example algo starting', meta.symbol);
      }
      function onTick(ctx) {
        if (!self._p) self._p = 0;
        self._p += Math.sin(ctx.t / 5);
        api.metric(self._p);
      }
      function stop() { api.log('Example algo stopped'); }
    `;
    const meta = parseAlgoMetaFromSource(code);
    const id = this.genId();
    const row: StrategyRow = {
      id,
      ...meta,
      amount: 100,
      status: 'stopped',
      pnlUsd: 0,
      roiPct: 0,
    };
    await dbPutFile(id, code);
    this.catalog.set(id, row);
    await dbPutIndex([row]);
  }
}
