import { Injectable } from "@angular/core";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { SocketService } from "../socket.service";
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { FuturesMarketService } from "./futures-markets.service";
import { wrangleFuturesObMessageInPlace } from "src/app/@core/utils/ob-normalize";

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

@Injectable({ providedIn: "root" })
export class FuturesOrderbookService {
  private _rawOrderbookData: IFuturesOrderRow[] = [];

  // arrays consumed by components (aggregated book levels)
  buyOrderbooks: { amount: number; price: number }[] = [];
  sellOrderbooks: { amount: number; price: number }[] = [];

  // history and UI hooks
  tradeHistory: IFuturesHistoryTrade[] = [];
  onUpdate?: () => void;

  // handy signals
  outsidePriceHandler: Subject<number> = new Subject();
  currentPrice = 1;
  lastPrice = 1;

  // key tracking
  private activeKey: string | null = null;
  private _lastRequestedKey: string | null = null;

  // rxjs subscriptions
  private socketServiceSubscriptions: Subscription[] = [];

  constructor(
    private socketService: SocketService,
    private futuresMarketService: FuturesMarketService,
    private toastrService: ToastrService,
    private loadingService: LoadingService
  ) {}

  // ---- public getters ----
  get selectedMarket() {
    return (this.futuresMarketService as any).selectedMarket;
  }

  get rawOrderbookData(): IFuturesOrderRow[] {
    return this._rawOrderbookData;
  }

  set rawOrderbookData(v: IFuturesOrderRow[]) {
    this._rawOrderbookData = v || [];
    this.structureOrderBook();
  }

  // ---- utils ----
  private key(contract_id: number): string {
    return `FUTURES:${contract_id}`;
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
        .pipe(filter(({ event }) => event === "order:error"))
        .subscribe(({ data }) => {
          const message: string = data;
          this.toastrService.error(message || `Undefined Error`, "Orderbook Error");
          this.loadingService.tradesLoading = false;
        })
    );

    // order:saved
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(filter(({ event }) => event === "order:saved"))
        .subscribe(() => {
          this.loadingService.tradesLoading = false;
          this.toastrService.success(`The Order is Saved in Orderbook`, "Success");
        })
    );

    // update-orders-request
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(filter(({ event }) => event === "update-orders-request"))
        .subscribe(() => {
          const cid = this.selectedMarket?.contract_id;
          if (typeof cid !== "number") return;

          const mk = this.key(cid);
          const payload = {
            type: "FUTURES",
            contract_id: cid,
            marketKey: mk,
            activeKey: this.activeKey ?? mk,
            lastRequestedKey: this._lastRequestedKey ?? null,
          };
          this.socketService.send("update-orderbook", payload);
        })
    );

    // orderbook-data
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(filter(({ event }) => event === "orderbook-data"))
        .subscribe(({ data }: { data: any }) => {
          // inside your existing WS handler after wrangling:
          const msg  = wrangleFuturesObMessageInPlace(data);
          if (msg.event !== 'orderbook-data') return;

          const book = msg.orders || {};
          const bids = book.bids ?? msg.bids ?? [];
          const asks = book.asks ?? msg.asks ?? [];

          this.buyOrderbooks  = bids;   // or whatever arrays your template reads
          this.sellOrderbooks = asks;
          
          // optional history
          if (Array.isArray(data?.history)) {
            this.tradeHistory = data.history as IFuturesHistoryTrade[];
          }

          // update current price from asks (lowest ask proxy)
          if (this.sellOrderbooks.length > 0) {
            const asksSorted = [...this.sellOrderbooks].sort((a, b) => a.price - b.price);
            this.currentPrice = asksSorted[0]?.price ?? this.currentPrice ?? 1;
          }

          this.onUpdate?.();
        })
    );

    // initial snapshot
    const cid = this.selectedMarket?.contract_id;
    if (typeof cid === "number") {
      this.socketService.send("update-orderbook", {
        filter: { type: "FUTURES", contract_id: cid },
      });
    }
  }

  endOrderbookSubscription() {
    this.socketServiceSubscriptions.forEach((s) => s.unsubscribe());
    this.socketServiceSubscriptions = [];
  }

  // ---- market switching ----
   // ---- market switching ----
  // Accept both styles:
  //   switchMarket(contract_id, params?)
  //   switchMarket('FUTURES', contract_id, params?)
  async switchMarket(
    a: number | "FUTURES",
    b?: number | { depth?: number; side?: Side; includeTrades?: boolean },
    c?: { depth?: number; side?: Side; includeTrades?: boolean }
  ) {
    let contract_id: number;
    let p: { depth?: number; side?: Side; includeTrades?: boolean } | undefined;

    if (typeof a === "string") {
      contract_id = Number(b);
      p = c;
    } else {
      contract_id = a;
      p = (b as any) || undefined;
    }

    const newKey = this.key(contract_id);
    this._lastRequestedKey = this.activeKey;

    if (this.activeKey && this.activeKey !== newKey) {
      this.socketService.send("orderbook:leave", { marketKey: this.activeKey });
    }

    this.activeKey = newKey;

    this.socketService.send("update-orderbook", {
      filter: {
        type: "FUTURES",
        contract_id,
        depth: String(p?.depth ?? 50),
        side: p?.side ?? "both",
        includeTrades: String(p?.includeTrades ?? false),
      },
    });

    this.socketService.send("orderbook:join", { marketKey: newKey });
  }

  // ---- local shaping ----
  private structureOrderBook() {
    this.buyOrderbooks = this._structureOrderbook(true);
    this.sellOrderbooks = this._structureOrderbook(false);
  }

  /**
   * Group by price with 0.001 bucket precision; top-9 bids / bottom-9 asks.
   * We treat BUY action as bids and SELL action as asks and filter by selected contract_id.
   */
  private _structureOrderbook(isBuy: boolean) {
    const cid = this.selectedMarket?.contract_id;
    if (typeof cid !== "number") return [];

    const side = isBuy ? "BUY" : "SELL";
    const rows = (this._rawOrderbookData || []).filter(
      (o) => o?.props?.contract_id === cid && o?.action === side
    );

    const range = 1000;
    const buckets: { price: number; amount: number }[] = [];

    rows.forEach((o) => {
      const p = Number(o.props.price) || 0;
      const a = Number(o.props.amount) || 0;
      const bucketKey = Math.trunc(p * range);
      const existing = buckets.find(
        (b) => Math.trunc(b.price * range) === bucketKey
      );
      if (existing) existing.amount += a;
      else buckets.push({ price: parseFloat(p.toFixed(4)), amount: a });
    });

    if (!isBuy) {
      // derive a "last price" approximation from asks (lowest ask)
      const sorted = [...buckets].sort((a, b) => a.price - b.price);
      const last = sorted[0]?.price;
      this.lastPrice = last ?? this.currentPrice ?? 1;
    }

    // bids: highest first → top 9; asks: highest first then take last 9 (lowest)
    return isBuy
      ? [...buckets].sort((a, b) => b.price - a.price).slice(0, 9)
      : [...buckets]
          .sort((a, b) => b.price - a.price)
          .slice(Math.max(buckets.length - 9, 0));
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
