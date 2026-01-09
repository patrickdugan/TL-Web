import { Injectable, OnDestroy } from "@angular/core";
import { Subject, Subscription } from "rxjs";
import { filter, auditTime, takeUntil } from "rxjs/operators";
import { SpotMarketsService, IMarket } from "./spot-markets.service";
import { SocketService } from "../socket.service";
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { AuthService } from "../auth.service";
import { ITradeInfo } from "src/app/utils/swapper";
import { ISpotTradeProps } from "src/app/utils/swapper/common";
import { wrangleObMessageInPlace } from "src/app/@core/utils/ob-normalize";
import { RpcService } from "../rpc.service"

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
  socketService_id: string;
  timestamp: number;
  type: "SPOT";
  uuid: string;
  state?: "CANCELED" | "FILLED";
}

/** Simplified row for internal orderbook display */
interface NormalizedOrderRow {
  price: number;
  amount: number;
  sell: boolean;
}

@Injectable({
  providedIn: "root",
})
export class SpotOrderbookService implements OnDestroy {
  // Internal storage - uses simplified normalized rows (like futures)
  private _normalizedOrders: NormalizedOrderRow[] = [];
  
  // Legacy accessor for compatibility
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

  // For rxjs event subscriptions
  private socketServiceSubscriptions: Subscription[] = [];
  
  // === Proper lifecycle management ===
  private destroy$ = new Subject<void>();
  
  // === Throttled update trigger ===
  private updateTrigger$ = new Subject<void>();

  constructor(
    private socketService: SocketService,
    private spotMarkertService: SpotMarketsService,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private authService: AuthService,
    private rpcService: RpcService
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
        side:
          t.buyer.keypair.address === this.activeSpotAddress
            ? "BUY"
            : "SELL",
      })) as ISpotHistoryTrade[];
  }

  set rawOrderbookData(value: ISpotOrder[]) {
    this._rawOrderbookData = value;
    // Don't call structureOrderBook here - we handle it separately for normalized data
  }

  get marketFilter() {
    return this.spotMarkertService.marketFilter;
  }

  private normalizeKey(p1: number, p2: number): string {
    return p1 < p2 ? `${p1}-${p2}` : `${p2}-${p1}`;
  }

  /**
   * Subscribe to raw events:
   *  "order:error", "order:saved", "update-orders-request", "orderbook-data"
   */
  subscribeForOrderbook() {
    this.endOrderbookSubscription();

    // RxJS: "order:error"
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

    // RxJS: "order:saved"
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "order:saved"),
          takeUntil(this.destroy$)
        )
        .subscribe(({ data }) => {
          this.loadingService.tradesLoading = false;
          this.toastrService.success(`The Order is Saved in Orderbook`, "Success");
        })
    );

    // RxJS: "update-orders-request"
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "update-orders-request"),
          takeUntil(this.destroy$)
        )
        .subscribe(() => {
          const net = this.rpcService.NETWORK
          this.socketService.send("update-orderbook", {...this.marketFilter, network: net})
        })
    );

    // RxJS: "orderbook-data"
    this.socketServiceSubscriptions.push(
      this.socketService.events$
        .pipe(
          filter(({ event }) => event === "orderbook-data"),
          takeUntil(this.destroy$)
        )
        .subscribe(({ data }: { data: any }) => {
          const msg = wrangleObMessageInPlace(data);
          console.log('spot ob msg ' + JSON.stringify(msg));
          if (msg.event !== "orderbook-data") return;

          // wrangleObMessageInPlace puts bids/asks at top level (not in ordersObj like futures)
          // It also creates a flat `orders` array with side:"BUY"/"SELL"
          const bids: Array<{ price: number; amount?: number; quantity?: number }> =
            Array.isArray(msg.bids) ? msg.bids : [];
          
          const asks: Array<{ price: number; amount?: number; quantity?: number }> =
            Array.isArray(msg.asks) ? msg.asks : [];

          console.log('spot parsed - bids:', bids.length, 'asks:', asks.length);

          // Store as normalized rows (same pattern as futures)
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
          const rawHistory = msg.history;
          this.tradeHistory = Array.isArray(rawHistory) ? rawHistory : [];

          // Price from best ask, fallback to best bid
          if (asks.length > 0) {
            this.currentPrice = parseFloat(Number(asks[0].price).toFixed(6));
          } else if (bids.length > 0) {
            this.currentPrice = parseFloat(Number(bids[0].price).toFixed(6));
          } else {
            const lastTrade = this.tradeHistory[0];
            if (lastTrade?.props) {
              const { amountForSale, amountDesired } = lastTrade.props;
              this.currentPrice =
                parseFloat((amountForSale / amountDesired).toFixed(6)) || 1;
            }
          }

          // Trigger UI update
          this.updateTrigger$.next();
        })
    );

    // Finally, request the current orderbook
    const net = this.rpcService.NETWORK
    this.socketService.send("update-orderbook", {...this.marketFilter, network: net});
  }

  /**
   * Unsubscribe from the raw events
   */
  endOrderbookSubscription() {
    this.socketServiceSubscriptions.forEach(sub => sub.unsubscribe());
    this.socketServiceSubscriptions = [];
  }

  /**
   * Rebuild local buy/sell arrays from raw orderbook data
   */
  private structureOrderBook() {
    this.buyOrderbooks = this._structureOrderbook(false);   // bids (sell=false)
    this.sellOrderbooks = this._structureOrderbook(true);   // asks (sell=true)
    console.log('spot structured - buys:', this.buyOrderbooks.length, 'sells:', this.sellOrderbooks.length);
  }

  async switchMarket(
    first_token: number, second_token: number,
    p?: { depth?: number; side?: 'bids' | 'asks' | 'both'; includeTrades?: boolean }
  ) {
    const newKey = this.normalizeKey(first_token, second_token);
    this._lastRequestedKey = this.activeKey;
    const net = this.rpcService.NETWORK
    if (this.activeKey && this.activeKey !== newKey) {
      this.socketService.send('orderbook:leave', { marketKey: this.activeKey, network: net });
    }

    // HARD RESET on market switch
    this._normalizedOrders = [];
    this._rawOrderbookData = [];
    this.buyOrderbooks = [];
    this.sellOrderbooks = [];
    this.tradeHistory = [];
    this.updateTrigger$.next();

    this.activeKey = newKey;

    this.socketService.send(
      'update-orderbook',
      {
        filter: {
          type: 'SPOT',
          first_token,
          second_token,
          depth: String(p?.depth ?? 50),
          side: p?.side ?? 'both',
          includeTrades: String(p?.includeTrades ?? false),
          network: net 
        }
      },
    );

    this.socketService.send('orderbook:join', { marketKey: newKey, network: net });
  }

  private _structureOrderbook(isSell: boolean) {
    // Filter normalized orders by side (same pattern as futures)
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
}
