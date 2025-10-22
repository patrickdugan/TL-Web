import { Injectable } from "@angular/core";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { SpotMarketsService, IMarket } from "./spot-markets.service";
import { SocketService } from "../socket.service";
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { AuthService } from "../auth.service";
import { ITradeInfo } from "src/app/utils/swapper";
import { ISpotTradeProps } from "src/app/utils/swapper/common";
import { wrangleObMessageInPlace } from "src/app/@core/utils/ob-normalize";

type Side = 'bids' | 'asks' | 'both';

interface ISpotOrderbookData {
  orders: ISpotOrder[];
  history: ISpotHistoryTrade[];
}

export interface ISpotHistoryTrade extends ITradeInfo<ISpotTradeProps> {
  txid: string;
  side?: "SELL" | "BUY";
}

export interface ISpotOrder {
  action: "SELL" | "BUY";
  keypair: {
    address: string;
    pubkey: string;
  };
  lock: boolean;
  props: {
    amount: number;
    id_desired: number;
    id_for_sale: number;
    price: number;
  };
  socketService_id: string; // keep web naming
  timestamp: number;
  type: "SPOT";
  uuid: string;
  state?: "CANCELED" | "FILLED";
}

@Injectable({ providedIn: "root" })
export class SpotOrderbookService {
  private _rawOrderbookData: ISpotOrder[] = [];
  outsidePriceHandler: Subject<number> = new Subject();
  buyOrderbooks: { amount: number; price: number }[] = [];
  sellOrderbooks: { amount: number; price: number }[] = [];
  tradeHistory: ISpotHistoryTrade[] = [];
  currentPrice: number = 1;
  lastPrice: number = 1;
  private activeKey: string | null = null;
  private _lastRequestedKey: string | null = null;
  onUpdate?: () => void;

  // RxJS subscription holders
  private socketServiceSubscriptions: Subscription[] = [];

  constructor(
    private socketService: SocketService,
    private spotMarkertService: SpotMarketsService,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private authService: AuthService
  ) {}

  get activeSpotKey() {
    return this.authService.activeSpotKey;
  }

  get activeSpotAddress() {
    return this.activeSpotKey?.address;
  }

  get selectedMarket() {
    return this.spotMarkertService.selectedMarket;
  }

  get rawOrderbookData() {
    return this._rawOrderbookData;
  }

  get marketFilter() {
    return this.spotMarkertService.marketFilter;
  }

  /** Normalize spot keys using p1<p2 rule */
  private normalizeKey(p1: number, p2: number): string {
    return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
  }

  /** If activeKey is not set, adopt it from message.marketKey or current selected market */
  private ensureActiveKeyFromMessage(msg: any): void {
    if (this.activeKey) return;

    const mk =
      typeof msg?.marketKey === "string" && /^\d+-\d+$/.test(msg.marketKey)
        ? msg.marketKey
        : null;

    if (mk) {
      this.activeKey = mk;
      return;
    }

    const sel = this.selectedMarket;
    const base = sel?.first_token?.propertyId;
    const quote = sel?.second_token?.propertyId;
    if (typeof base === "number" && typeof quote === "number") {
      this.activeKey = this.normalizeKey(base, quote);
    }
  }

  /**
   * Subscribe to raw events:
   *  "order:error", "order:saved", "update-orders-request", "orderbook-data"
   */
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

    // update-orders-request (server asks for a refresh)
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(filter(({ event }) => event === "update-orders-request"))
        .subscribe(() => {
          const marketKey = this.normalizeKey(
            this.marketFilter.first_token,
            this.marketFilter.second_token
          );

          // add hints for the server (matches desktop shape but via web send)
          const payload = {
            ...this.marketFilter, // { type, first_token, second_token, depth, side, includeTrades, ... }
            marketKey,
            activeKey: this.activeKey ?? marketKey,
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
           console.log('orderbook data raw '+JSON.stringify(data))
          // Normalize like desktop
          let ob = wrangleObMessageInPlace(data);
          // Ignore clearing snapshots (desktop behavior)
          if (Array.isArray(ob?.orders)) {
            // proceed; desktop ignores only illegal empty array when delta expected
          }

          // Infer/confirm active key
          this.ensureActiveKeyFromMessage(ob);

          const mk = ob?.marketKey || this.activeKey;
          if (mk && this.activeKey && mk !== this.activeKey) return;

          if (ob.isDelta) {
            this.rawOrderbookData = this.mergeOrders(
              this.rawOrderbookData,
              ob.orders as ISpotOrder[]
            );
          } else {
            this.rawOrderbookData = ob.orders as ISpotOrder[];
          }

          this.tradeHistory = ob.history || [];
          const lastTrade = this.tradeHistory[0];

          this.currentPrice = lastTrade
            ? parseFloat(
                (lastTrade.props.amountForSale / lastTrade.props.amountDesired).toFixed(6)
              ) || 1
            : 1;

          this.onUpdate?.();
        })
    );

    // initial snapshot request
    this.socketService.send("update-orderbook", this.marketFilter);
  }

  /**
   * Unsubscribe from the raw events
   */
  endOrderbookSubscription() {
    this.socketServiceSubscriptions.forEach((sub) => sub.unsubscribe());
    this.socketServiceSubscriptions = [];
  }

  /**
   * Rebuild local buy/sell arrays from raw orderbook data
   */
  private structureOrderBook() {
    this.buyOrderbooks = this._structureOrderbook(true);
    this.sellOrderbooks = this._structureOrderbook(false);
  }

  async switchMarket(
    first_token: number,
    second_token: number,
    p?: { depth?: number; side?: Side; includeTrades?: boolean }
  ) {
    const newKey = this.normalizeKey(first_token, second_token);

    // remember previous requested key
    this._lastRequestedKey = this.activeKey;

    // leave old
    if (this.activeKey && this.activeKey !== newKey) {
      this.socketService.send("orderbook:leave", { marketKey: this.activeKey });
    }

    this.activeKey = newKey;

    // Ask server for snapshot
    this.socketService.send("update-orderbook", {
      filter: {
        type: "SPOT",
        first_token,
        second_token,
        depth: String(p?.depth ?? 50),
        side: p?.side ?? "both",
        includeTrades: String(p?.includeTrades ?? false),
      },
    });

    // Join for live deltas
    this.socketService.send("orderbook:join", { marketKey: newKey });
  }

  private _structureOrderbook(isBuy: boolean) {
    const baseId = this.selectedMarket.first_token.propertyId;   // normalized: base < quote
    const quoteId = this.selectedMarket.second_token.propertyId;
    const myKey = this.normalizeKey(baseId, quoteId);

    // BUY shows quotes for sale; SELL shows base for sale (matches desktop code behavior)
    const filteredOrderbook = (this.rawOrderbookData || []).filter(
      (o) =>
        this.normalizeKey(o?.props?.id_for_sale, o?.props?.id_desired) === myKey &&
        (isBuy ? o?.props?.id_for_sale === quoteId : o?.props?.id_for_sale === baseId)
    );

    const range = 1000;
    const result: { price: number; amount: number }[] = [];

    filteredOrderbook.forEach((o) => {
      const _price = Math.trunc(o.props.price * range);
      const existing = result.find((_o) => Math.trunc(_o.price * range) === _price);
      if (existing) {
        existing.amount += o.props.amount;
      } else {
        result.push({
          price: parseFloat(o.props.price.toFixed(4)),
          amount: o.props.amount,
        });
      }
    });

    // If it's a sell side, we keep track of 'lastPrice' from the sorted array
    if (!isBuy) {
      this.lastPrice =
        result.sort((a, b) => b.price - a.price)?.[result.length - 1]?.price ||
        this.currentPrice ||
        1;
    }

    // Return either the top 9 buys or the bottom 9 sells
    return isBuy
      ? result.sort((a, b) => b.price - a.price).slice(0, 9)
      : result.sort((a, b) => b.price - a.price).slice(Math.max(result.length - 9, 0));
  }

  private mergeOrders(current: ISpotOrder[], deltas: ISpotOrder[]): ISpotOrder[] {
    const map = new Map(current.map((o) => [o.uuid, o]));

    for (const d of deltas) {
      // normalize/guard
      d.props.amount = d.props.amount;
      if (d.props.amount === 0 || d.state === "CANCELED") {
        map.delete(d.uuid);
      } else {
        map.set(d.uuid, d);
      }
    }

    return Array.from(map.values());
  }

  set rawOrderbookData(value: ISpotOrder[]) {
    this._rawOrderbookData = value;
    this.structureOrderBook();
  }

  get relatedHistoryTrades() {
    if (!this.activeSpotAddress) return [];
    return this.tradeHistory
      .filter(
        (e) =>
          e.seller.keypair.address === this.activeSpotAddress ||
          e.buyer.keypair.address === this.activeSpotAddress
      )
      .map((t) => ({
        ...t,
        side: t.buyer.keypair.address === this.activeSpotAddress ? "BUY" : "SELL",
      })) as ISpotHistoryTrade[];
  }
}
