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

@Injectable({
  providedIn: "root",
})
export class SpotOrderbookService implements OnDestroy {
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
  
  // === NEW: Proper lifecycle management ===
  private destroy$ = new Subject<void>();
  
  // === NEW: Throttled update trigger ===
  private updateTrigger$ = new Subject<void>();

  constructor(
    private socketService: SocketService,
    private spotMarkertService: SpotMarketsService,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private authService: AuthService,
    private rpcService: RpcService
  ) {
    // === NEW: Throttled updates at ~30fps max ===
    this.updateTrigger$.pipe(
      auditTime(32), // ~30fps max, prevents CD storms
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
    this.structureOrderBook();
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

          // === UPDATED: Use ordersObj like futures service ===
          // wrangleObMessageInPlace normalizes to ordersObj.bids / ordersObj.asks
          const snap = msg.ordersObj;
          
          const bids: Array<{ price: number; amount?: number; quantity?: number }> =
            Array.isArray(snap?.bids) ? snap.bids : [];
          
          const asks: Array<{ price: number; amount?: number; quantity?: number }> =
            Array.isArray(snap?.asks) ? snap.asks : [];

          // Build UI rows - convert to ISpotOrder-compatible shape
          // Note: These are simplified rows for display, not full ISpotOrder objects
          this._rawOrderbookData = [
            ...bids.map((b) => ({
              action: "BUY" as const,
              props: {
                price: Number(b.price),
                amount: Number(b.amount ?? b.quantity ?? 0),
                id_desired: this.selectedMarket?.first_token?.propertyId ?? 0,
                id_for_sale: this.selectedMarket?.second_token?.propertyId ?? 0,
              },
              type: "SPOT" as const,
              uuid: '',
              keypair: { address: '', pubkey: '' },
              lock: false,
              socketService_id: '',
              timestamp: Date.now(),
            })),
            ...asks.map((a) => ({
              action: "SELL" as const,
              props: {
                price: Number(a.price),
                amount: Number(a.amount ?? a.quantity ?? 0),
                id_desired: this.selectedMarket?.second_token?.propertyId ?? 0,
                id_for_sale: this.selectedMarket?.first_token?.propertyId ?? 0,
              },
              type: "SPOT" as const,
              uuid: '',
              keypair: { address: '', pubkey: '' },
              lock: false,
              socketService_id: '',
              timestamp: Date.now(),
            })),
          ] as ISpotOrder[];

          // Trigger structure rebuild
          this.structureOrderBook();

          // History
          const rawHistory = msg.history;
          this.tradeHistory = Array.isArray(rawHistory) ? rawHistory : [];

          // Price derivation
          if (asks.length > 0 || bids.length > 0) {
            const bestBid = bids[0]?.price;
            const bestAsk = asks[0]?.price;

            if (typeof bestAsk === "number") {
              this.currentPrice = parseFloat(Number(bestAsk).toFixed(6));
            } else if (typeof bestBid === "number") {
              this.currentPrice = parseFloat(Number(bestBid).toFixed(6));
            } else {
              const lastTrade = this.tradeHistory[0];
              if (lastTrade?.props) {
                const { amountForSale, amountDesired } = lastTrade.props;
                this.currentPrice =
                  parseFloat((amountForSale / amountDesired).toFixed(6)) || 1;
              }
            }
          }

          // === FIX: Use throttled trigger instead of direct onUpdate ===
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
    this.buyOrderbooks = this._structureOrderbook(true);
    this.sellOrderbooks = this._structureOrderbook(false);
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

    // HARD RESET on market switch (matches futures semantics)
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

  private _structureOrderbook(isBuy: boolean) {
    const propIdDesired = isBuy
      ? this.selectedMarket?.first_token?.propertyId
      : this.selectedMarket?.second_token?.propertyId;
    const propIdForSale = isBuy
      ? this.selectedMarket?.second_token?.propertyId
      : this.selectedMarket?.first_token?.propertyId;
    
    if (propIdDesired === undefined || propIdForSale === undefined) {
      return [];
    }

    const filteredOrderbook = this._rawOrderbookData.filter(
      (o) => o.props.id_desired === propIdDesired && o.props.id_for_sale === propIdForSale
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
    if (!isBuy) {
      this.lastPrice =
        result.sort((a, b) => b.price - a.price)?.[result.length - 1]?.price ||
        this.currentPrice ||
        1;
    }

    return isBuy
      ? result.sort((a, b) => b.price - a.price).slice(0, 9)
      : result.sort((a, b) => b.price - a.price).slice(Math.max(result.length - 9, 0));
  }
}
