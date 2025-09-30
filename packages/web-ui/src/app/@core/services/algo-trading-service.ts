import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, Subject, of } from 'rxjs';
import { catchError, map, tap } from 'rxjs/operators';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../environments/environment';

import { parseAlgoMetaFromSource, AlgoIndexItem } from '../algo-meta';
import { dbGetIndex, dbPutIndex, dbPutFile, dbGetFile } from '../algo-db';

export interface DiscoveryRow {
  id: string;
  rank: number;
  market: string;
  mode: 'SPOT' | 'FUTURES';
  leverage?: string;
  roiPct: number;
  pnlUsd: number;
  copiers: number;
  runtime: string;
  meta?: any;
}

export interface RunningSystem {
  runId: string;
  name: string;
  allocated: number;
  pnl: number;
  startedAt: string | number | Date;
  counterVenuePct?: number;
}

type Dict<T = any> = { [k: string]: T };

// --------------------

const DEFAULTS_DIR = 'assets/algo-defaults';
const DEFAULT_FILES = ['meanReversion.js','gridBot.js','mmEx.js'];

function shortId(seed: string) {
  const s = seed + Date.now();
  let hash = 0;
  for (let i = 0; i < s.length; i++) hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  const h = (hash >>> 0).toString(16).padStart(8, '0') + Math.floor(Math.random()*0xffffffff).toString(16).padStart(8,'0');
  return h.slice(0, 12);
}
function safeName(s: string) { return String(s || '').replace(/[^\w.\-]+/g, '_'); }

// Worker handles by systemId
type WorkerHandle = { worker: Worker; startedAt: number };
const running = new Map<string, WorkerHandle>();

@Injectable({ providedIn: 'root' })
export class AlgoTradingService {
  constructor(private http: HttpClient) {}
  private base = environment.apiBase + '/algo';
  private preloadDefaults = environment.algoDefaults;

  /** Discovery (ranked systems) and running instances for current user */
  readonly discovery$ = new BehaviorSubject<DiscoveryRow[]>([]);
  readonly running$   = new BehaviorSubject<RunningSystem[]>([]);

  // Optional loading flags if your UI uses them
  readonly loadingDiscovery$ = new BehaviorSubject<boolean>(false);
  readonly loadingRunning$   = new BehaviorSubject<boolean>(false);
  readonly uploading$        = new BehaviorSubject<boolean>(false);

  // ---- Bootstrap defaults on first use
  private seeded = false;
  private async seedDefaultsIfEmpty(): Promise<void> {
    if (this.seeded) return;
    const current = await dbGetIndex();
    if (current.length > 0) { this.seeded = true; return; }

    const list: AlgoIndexItem[] = [];
    for (const name of DEFAULT_FILES) {
      try {
        const src = await this.http.get(`${DEFAULTS_DIR}/${name}`, { responseType: 'text' }).toPromise();
        if (!src) continue;
        const meta = parseAlgoMetaFromSource(src);
        const id = shortId(name);
        const fileName = `${id}-${safeName(name)}`;
        await dbPutFile(fileName, src);
        list.push({
          id,
          name: meta?.name || name,
          fileName,
          size: new Blob([src]).size,
          createdAt: Date.now(),
          status: 'stopped',
          amount: 0,
          meta,
        });
      } catch (e) {
        console.warn('[algo.defaults] failed to import', name, e);
      }
    }
    await dbPutIndex(list);
    this.seeded = true;
  }

  // ---- Public API (keeps same shape your components call)

  fetchDiscovery(filters: Dict): Observable<DiscoveryRow[]> {
    this.loadingDiscovery$.next(true);
    return new Observable<DiscoveryRow[]>(observer => {
      (async () => {
        await this.seedDefaultsIfEmpty();
        const rows = await dbGetIndex();
        // Map to UI DiscoveryRow (safe placeholders)
        const mapped = rows.map((i, idx): DiscoveryRow => ({
          id: i.id,
          rank: idx + 1,
          market: i.meta?.symbol || '—',
          mode: (i.meta?.mode || 'SPOT') as 'SPOT' | 'FUTURES',
          leverage: i.meta?.leverage != null ? String(i.meta.leverage) : undefined,
          roiPct: 0,
          pnlUsd: 0,
          copiers: 0,
          runtime: i.status === 'running' ? 'Running' : 'Stopped',
          meta: i,
        }));
        this.discovery$.next(mapped);
        observer.next(mapped);
        observer.complete();
        this.loadingDiscovery$.next(false);
      })().catch(err => {
        console.error('[algo] fetchDiscovery error:', err);
        this.discovery$.next([]);
        observer.next([]);
        observer.complete();
        this.loadingDiscovery$.next(false);
      });
    });
  }

  fetchRunning(): Observable<RunningSystem[]> {
    this.loadingRunning$.next(true);
    return new Observable<RunningSystem[]>(observer => {
      (async () => {
        const rows = await dbGetIndex();
        const nowRunning = rows.filter(r => r.status === 'running');
        const mapped = nowRunning.map(i => ({
          runId: i.id,
          name: i.meta?.name || i.name,
          allocated: i.amount ?? 0,
          pnl: 0,
          startedAt: i.createdAt,
          counterVenuePct: undefined,
        }));
        this.running$.next(mapped);
        observer.next(mapped);
        observer.complete();
        this.loadingRunning$.next(false);
      })().catch(err => {
        console.error('[algo] fetchRunning error:', err);
        this.running$.next([]);
        observer.next([]);
        observer.complete();
        this.loadingRunning$.next(false);
      });
    });
  }

  uploadSystem(file: File, name?: string): Observable<{ ok: boolean; systemId: string }> {
    this.uploading$.next(true);
    return new Observable(observer => {
      (async () => {
        const src = await file.text();
        const meta = parseAlgoMetaFromSource(src);
        const id = shortId(file.name);
        const fileName = `${id}-${safeName(name || file.name)}`;
        await dbPutFile(fileName, src);

        const item: AlgoIndexItem = {
          id,
          name: meta?.name || name || file.name,
          fileName,
          size: file.size,
          createdAt: Date.now(),
          status: 'stopped',
          amount: 0,
          meta,
        };
        const list = await dbGetIndex();
        list.push(item);
        await dbPutIndex(list);

        // refresh discovery
        this.fetchDiscovery({}).subscribe();

        observer.next({ ok: true, systemId: id });
        observer.complete();
        this.uploading$.next(false);
      })().catch(err => {
        console.error('[algo] upload error:', err);
        observer.error(err);
        this.uploading$.next(false);
      });
    });
  }

  runSystem(systemId: string) {
    return new Observable<{ ok: boolean }>(observer => {
      (async () => {
        const list = await dbGetIndex();
        const item = list.find(i => i.id === systemId);
        if (!item) throw new Error('System not found');
        if (running.has(systemId)) { observer.next({ ok:true }); observer.complete(); return; }

        const source = await dbGetFile(item.fileName);
        if (!source) throw new Error('Source missing');

        // Worker creation (Angular supports the URL pattern since v13+ / Webpack 5)
        const worker = new Worker(new URL('../workers/algo.worker.ts', import.meta.url), { type: 'module' });

        worker.postMessage({
          type: 'run',
          systemId,
          fileName: item.fileName,
          source,
          meta: item.meta || null,
          config: {}, // pass web wallet/relayer config later as needed
        });

        worker.onmessage = (e: MessageEvent) => {
          const msg = e.data;
          if (!msg || typeof msg !== 'object') return;
          if (msg.type === 'stopped' || msg.type === 'error') {
            this.stopSystem(systemId).subscribe(); // ensure state sync
          }
          // if (msg.type === 'metric') { /* fan out to charts */ }
        };

        running.set(systemId, { worker, startedAt: Date.now() });
        item.status = 'running';
        await dbPutIndex(list);

        // refresh streams
        this.fetchDiscovery({}).subscribe();
        this.fetchRunning().subscribe();

        observer.next({ ok: true });
        observer.complete();
      })().catch(err => {
        console.error('[algo] run error:', err);
        observer.error(err);
      });
    });
  }

  stopSystem(systemId: string) {
    return new Observable<{ ok: boolean }>(observer => {
      (async () => {
        const h = running.get(systemId);
        if (h) { h.worker.postMessage({ type: 'stop' }); h.worker.terminate(); running.delete(systemId); }

        const list = await dbGetIndex();
        const item = list.find(i => i.id === systemId);
        if (item) { item.status = 'stopped'; await dbPutIndex(list); }

        // refresh streams
        this.fetchDiscovery({}).subscribe();
        this.fetchRunning().subscribe();

        observer.next({ ok: true });
        observer.complete();
      })().catch(err => {
        console.error('[algo] stop error:', err);
        observer.error(err);
      });
    });
  }

  // Stubs to keep existing component calls happy; wire when relayer is ready
  allocate(req: { systemId: string; amount: number }) { return of({ ok: true }); }
  withdraw(payload: { systemId: string; amount: number }) { return of({ ok: true }); }
}
