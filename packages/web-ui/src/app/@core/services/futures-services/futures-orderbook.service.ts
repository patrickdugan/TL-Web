import { Injectable, OnDestroy } from "@angular/core";
import { Subject, Subscription } from "rxjs";
import { filter, auditTime, takeUntil } from "rxjs/operators";
import { SocketService } from "../socket.service";
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { FuturesMarketService } from "./futures-markets.service";
import { wrangleFuturesObMessageInPlace } from "src/app/@core/utils/ob-normalize";
import { RpcService } from "../rpc.service"

type Side = "bids" | "asks" | "both";

/** Exported row type — matches component expectations (type, keypair, state, props). */
export interface IFuturesOrder {
  uuid: string;
  type: "FUTURES" | "SPOT";
  action: "BUY" | "SELL";
  keypair: { address: string; pubkey: string };
  props: {
    contract_id: number;
    amount: number;
    price: number;
    [k: string]: any;
  };
  timestamp: number;
  state?: "CANCELED" | "FILLED";
  [k: string]: any;
}

/** Internal alias for clarity (structurally identical to IFuturesOrder). */
interface IFuturesOrderRow extends IFuturesOrder {}

export interface IFuturesHistoryTrade {
  txid?: string;
  [k: string]: any;
}

/** Normalize perp market key to consistent format */
function normalizePerpMarketKey(key: string | null | undefined): string | null {
  if (!key) return null;
  return String(key).toLowerCase().trim();
}

/** Simplified row for internal orderbook display */
interface NormalizedOrderRow {
  price: number;
  amount: number;
  sell: boolean;
}

@Injectable({ providedIn: "root" })
export class FuturesOrderbookService implements OnDestroy {
  // Internal storage - uses simplified normalized rows
  private _normalizedOrders: NormalizedOrderRow[] = [];
  
  // Legacy accessor for compatibility
  private _rawOrderbookData: IFuturesOrderRow[] = [];

  // arrays consumed by components (aggregated book levels)
  buyOrderbooks: { amount: number; price: number }[] = [];
  sellOrderbooks: { amount: number; price: number }[] = [];

  // history and UI hooks
  tradeHistory: IFuturesHistoryTrade[] = [];
  onUpdate?: () => void;

  // handy signals
  outsidePriceHandler: Subject<number> = new Subject();
  currentPrice: number | undefined = 1;
  lastPrice = 1;

  // key tracking
  private activeKey: string | null = null;
  private _lastRequestedKey: string | null = null;

  // rxjs subscriptions
  private socketServiceSubscriptions: Subscription[] = [];
  
  // === Proper lifecycle management ===
  private destroy$ = new Subject<void>();
  
  // === Throttled update trigger ===
  private updateTrigger$ = new Subject<void>();

  constructor(
    private socketService: SocketService,
    private futuresMarketService: FuturesMarketService,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private rpcService: RpcService,
  ) {
    // Throttled updates at ~30fps max
    this.updateTrigger$.pipe(
      auditTime(32),
      takeUntil(this.destroy$)
    ).subscribe(() => {
      this.onUpdate?.();
    });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
    this.endOrderbookSubscription();
  }

  // ---- public getters ----
  get selectedMarket() {
    return (this.futuresMarketService as any).selectedMarket;
  }

  get rawOrderbookData(): IFuturesOrderRow[] {
    return this._rawOrderbookData;
  }

  set rawOrderbookData(v: IFuturesOrderRow[]) {
    this._rawOrderbookData = v || [];
    // Don't call structureOrderBook here - we handle it separately for normalized data
  }

  // ---- utils ----
  private key(contract_id: number): string {
    return `${contract_id}-perp`; 
  }

  private ensureActiveKeyFromMessage(msg: any): void {
    if (this.activeKey) return;
    const k = typeof msg?.marketKey === "string" ? msg.marketKey : null;
    if (k) {
      this.activeKey = k;
      return;
    }
    const cid = this.selectedMarket?.contract_id;
    if (typeof cid === "number") this.activeKey = this.key(cid);
  }

  // ---- subscription management ----
  subscribeForOrderbook() {
    this.endOrderbookSubscription();

    // order:error
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "order:error"),
          takeUntil(this.destroy$)
        )
        .subscribe(({ data }) => {
          const message: string = data;
          this.toastrService.error(message || `Undefined Error`, "Orderbook Error");
          this.loadingService.tradesLoading = false;
        })
    );

    // order:saved
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "order:saved"),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          this.loadingService.tradesLoading = false;
          this.toastrService.success(`The Order is Saved in Orderbook`, "Success");
        })
    );

    // update-orders-request
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "update-orders-request"),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          const cid = this.selectedMarket?.contract_id;
          if (typeof cid !== "number") return;
          const net = this.rpcService.NETWORK;
          const mk = this.key(cid);
          const payload = {
            type: "FUTURES",
            contract_id: cid,
            marketKey: mk,
            activeKey: this.activeKey ?? mk,
            lastRequestedKey: this._lastRequestedKey ?? null,
            network: net
          };
          this.socketService.send("update-orderbook", payload);
        })
    );

    // orderbook-data
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "orderbook-data"),
          takeUntil(this.destroy$)
        )
        .subscribe(({ data }: { data: any }) => {
          const msg = wrangleFuturesObMessageInPlace(data);
          console.log('fut ob msg ' + JSON.stringify(msg));
          if (msg.event !== "orderbook-data") return;

          // Get bids/asks from ordersObj (normalized by wrangler)
          const snap = msg.ordersObj;
          
          const bids: Array<{ price: number; amount?: number; quantity?: number }> =
            Array.isArray(snap?.bids) ? snap.bids : [];
          
          const asks: Array<{ price: number; amount?: number; quantity?: number }> =
            Array.isArray(snap?.asks) ? snap.asks : [];

          // Store as normalized rows
          this._normalizedOrders = [
            ...bids.map((b) => ({
              price: Number(b.price),
              amount: Number(b.amount ?? b.quantity ?? 0),
              sell: false,
            })),
            ...asks.map((a) => ({
              price: Number(a.price),
              amount: Number(a.amount ?? a.quantity ?? 0),
              sell: true,
            })),
          ];

          // Rebuild UI orderbooks
          this.structureOrderBook();

          // History
          if (Array.isArray(msg.history)) {
            this.tradeHistory = msg.history as IFuturesHistoryTrade[];
          }

          // Price from best ask
          if (asks.length > 0) {
            this.currentPrice = Number(asks[0].price);
          } else if (bids.length > 0) {
            this.currentPrice = Number(bids[0].price);
          }

          // Trigger UI update
          this.updateTrigger$.next();
        })
    );

    // initial snapshot
    const cid = this.selectedMarket?.contract_id;
    const net = this.rpcService.NETWORK;
    if (typeof cid === "number") {
      this.socketService.send("update-orderbook", {
        filter: { type: "FUTURES", contract_id: cid, network: net },
      });
    }
  }

  endOrderbookSubscription() {
    this.socketServiceSubscriptions.forEach((s) => s.unsubscribe());
    this.socketServiceSubscriptions = [];
  }

  // ---- market switching ----
  async switchMarket(
    contract_id: number,
    p?: { depth?: number; side?: 'bids' | 'asks' | 'both'; includeTrades?: boolean }
  ) {
    const net = this.rpcService.NETWORK;
    const newKey = normalizePerpMarketKey(`${contract_id}-perp`)!;

    // leave old market
    if (this.activeKey && this.activeKey !== newKey) {
      this.socketService.send("orderbook:leave", {
        marketKey: this.activeKey,
        network: net,
      });
    }

    // HARD RESET
    this._normalizedOrders = [];
    this._rawOrderbookData = [];
    this.buyOrderbooks = [];
    this.sellOrderbooks = [];
    this.tradeHistory = [];
    this.currentPrice = undefined;
    this.updateTrigger$.next();

    this.activeKey = newKey;
    this._lastRequestedKey = newKey;

    // request fresh snapshot
    this.socketService.send("update-orderbook", {
      filter: {
        type: "FUTURES",
        contract_id,
        depth: String(p?.depth ?? 50),
        side: p?.side ?? "both",
        includeTrades: String(p?.includeTrades ?? false),
        network: net,
      },
    });

    // join stream
    this.socketService.send("orderbook:join", {
      marketKey: newKey,
      network: net,
    });
  }

  // ---- local shaping ----
  private structureOrderBook() {
    this.buyOrderbooks = this._structureOrderbook(false);  // bids (sell=false)
    this.sellOrderbooks = this._structureOrderbook(true);  // asks (sell=true)
  }

  private _structureOrderbook(isSell: boolean) {
    // Filter normalized orders by side
    const rows = this._normalizedOrders.filter((o) => o.sell === isSell);

    const range = 1000;
    const buckets: { price: number; amount: number }[] = [];

    rows.forEach((o) => {
      const p = Number(o.price) || 0;
      const a = Number(o.amount) || 0;
      const bucketKey = Math.trunc(p * range);
      const existing = buckets.find(
        (b) => Math.trunc(b.price * range) === bucketKey
      );
      if (existing) {
        existing.amount += a;
      } else {
        buckets.push({ price: parseFloat(p.toFixed(4)), amount: a });
      }
    });

    // Update lastPrice from asks (sell side)
    if (isSell && buckets.length > 0) {
      const sorted = [...buckets].sort((a, b) => a.price - b.price);
      this.lastPrice = sorted[0]?.price ?? this.currentPrice ?? 1;
    }

    // Return sorted and sliced
    // Standard orderbook display:
    //   Asks (sells): highest at top, lowest at bottom (closest to spread)
    //   Bids (buys): highest at top (closest to spread), lowest at bottom
    if (isSell) {
      // Asks: sort descending (high to low), so lowest price is at bottom near spread
      return [...buckets]
        .sort((a, b) => b.price - a.price)
        .slice(0, 9);
    } else {
      // Bids: sort descending (high to low), so highest price is at top near spread
      return [...buckets]
        .sort((a, b) => b.price - a.price)
        .slice(0, 9);
    }
  }

  private mergeOrders(
    current: IFuturesOrderRow[],
    deltas: IFuturesOrderRow[]
  ): IFuturesOrderRow[] {
    const map = new Map(current.map((o) => [o.uuid, o]));
    for (const d of deltas) {
      if (d.props?.amount === 0 || d.state === "CANCELED") {
        map.delete(d.uuid);
      } else {
        map.set(d.uuid, d);
      }
    }
    return Array.from(map.values());
  }
}
