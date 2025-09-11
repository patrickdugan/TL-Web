import { Injectable } from "@angular/core";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { SocketService } from "../socket.service";
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { AuthService } from "../auth.service";
import { FuturesMarketService, IFutureMarket } from "./futures-markets.service";
import { ITradeInfo } from "src/app/utils/swapper";
import { IFuturesTradeProps } from "src/app/utils/swapper/common";

interface IFuturesOrderbookData {
  orders: IFuturesOrder[];
  history: IFuturesHistoryTrade[];

}

export interface IFuturesHistoryTrade extends ITradeInfo<IFuturesTradeProps> {
  txid: string;
  side?: "SELL" | "BUY";
}

export interface IFuturesOrder {
  action: "SELL" | "BUY";
  keypair: {
    address: string;
    pubkey: string;
  };
  lock: boolean;
  props: {
    amount: number;
    contract_id: number;
    price: number;
    leverage: 10;
    collateral: number;
  };
  socket_id: string;
  timestamp: number;
  type: "FUTURES";
  uuid: string;
  state?: "CANCALED" | "FILLED";
}

@Injectable({
  providedIn: "root",
})
export class FuturesOrderbookService {
  private activeKey: string | null = null;
  private _rawOrderbookData: IFuturesOrder[] = [];
  private subs: Subscription[] = [];
  outsidePriceHandler: Subject<number> = new Subject();
  private books: Record<string, IFuturesOrderbookData> = {};
  buyOrderbooks: { amount: number; price: number }[] = [];
  sellOrderbooks: { amount: number; price: number }[] = [];
  tradeHistory: IFuturesHistoryTrade[] = [];
  currentPrice: number = 1;
  lastPrice: number = 1;
  private key(type: string, id: number|string) { return `${type}:${id}`; }
  private _lastRequestedKey: string | null = null;
  private bound = false;
  onUpdate?: () => void;

  // Subscriptions for RxJS event streams
  private orderbookSubs: Subscription[] = [];

  constructor(
    private socketService: SocketService,
    private futuresMarketService: FuturesMarketService,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private authService: AuthService
  ) {}

  get activeFuturesKey() {
    return this.authService.activeFuturesKey;
  }

  get activeFuturesAddress() {
    return this.activeFuturesKey?.address;
  }

  private get socket() {
        return this.socketService.ws;
  }

  get selectedMarket() {
    return this.futuresMarketService.selectedMarket;
  }

  get rawOrderbookData() {
    return this._rawOrderbookData;
  }

  get relatedHistoryTrades() {
    if (!this.activeFuturesAddress) return [];
    return this.tradeHistory
      .filter(
        (e) =>
          e.seller.keypair.address === this.activeFuturesAddress ||
          e.buyer.keypair.address === this.activeFuturesAddress
      )
      .map((t) => ({
        ...t,
        side: t.buyer.keypair.address === this.activeFuturesAddress ? "BUY" : "SELL",
      })) as IFuturesHistoryTrade[];
  }

  set rawOrderbookData(value: IFuturesOrder[]) {
    this._rawOrderbookData = value;
    this.structureOrderBook();
  }

  get marketFilter() {
    return this.futuresMarketService.marketFilter;
  }

   getContractMeta(contract_id: number) {
        // Use FuturesMarketService.getMarketByContractId()
        const market = this.futuresMarketService.getMarketByContractId(contract_id);
        if (!market) return { contractSize: 1, isInverse: false };
        // Note: Derive contractSize, isInverse from your market model
        return {
            contractSize: market.notional || 1,           // <-- Use .notional for contract size
            isInverse: !!market.inverse                   // <-- Use .inverse for inverse contracts
        };
    }

  /**
   *  Subscribe to orderbook-related events from the SocketService
   */
  subscribeForOrderbook() {
    this.endOrderbookSubscription();

    this.orderbookSubs.push(
      this.socketService.events$.pipe(
        filter(({ event }) => event === "order:error")
      ).subscribe(({ data: message }) => {
        this.toastrService.error(message || `Undefined Error`, "Orderbook Error");
        this.loadingService.tradesLoading = false;
      }),

      this.socketService.events$.pipe(
        filter(({ event }) => event === "order:saved")
      ).subscribe(({ data }) => {
        this.toastrService.success(`The Order is Saved in Orderbook`, "Success");
      }),

      this.socketService.events$.pipe(
        filter(({ event }) => event === "update-orders-request")
      ).subscribe(() => {
        this.socketService.send("update-orderbook", this.marketFilter);
      }),

      this.socketService.events$.pipe(
        filter(({ event }) => event === "orderbook-data")
      ).subscribe(({ data: orderbookData }: { data: any }) => {
        console.log('[Futures OB] update ' + JSON.stringify(orderbookData));

          const mk = orderbookData?.marketKey || this.activeKey;
          if (mk && this.activeKey && mk !== this.activeKey) return;

          if (Array.isArray(orderbookData.orders)) {
              this.rawOrderbookData = orderbookData.orders as IFuturesOrder[];
          }

            this.tradeHistory = orderbookData.history || [];
            const lastTrade = this.tradeHistory[0];

          if (!lastTrade) {
            this.currentPrice = 1;
          } else {
            const { price } = lastTrade.props;
            this.currentPrice =price || 1;
          }

            this.currentPrice = lastTrade?.props?.price || 1;
          if (this.onUpdate) {
              try {
                this.onUpdate();
              } catch {}
            }
          }

        // Manually request the latest orderbook
        this.socketService.send("update-orderbook", this.marketFilter);
      )
  }

  /**
   *  Unsubscribe from all event streams
   */
  endOrderbookSubscription() {
    this.orderbookSubs.forEach(sub => sub.unsubscribe());
    this.orderbookSubs = [];
  }

  /**
   *  Rebuild the local buy/sell arrays
   */
  private structureOrderBook() {
    this.buyOrderbooks = this._structureOrderbook(true);
    this.sellOrderbooks = this._structureOrderbook(false);
  }

   private bindOnce() {
     if (this.bound) return; 
     this.bound = true;
     this.subs.push(
       this.socketService.events$
         .pipe(filter(ev => ev.event === 'ORDERBOOK_DATA'))
         .subscribe(ev => {
           const msg = ev.data;
           if (!msg?.marketKey || msg.marketKey !== this.activeKey) return;
           this.books[msg.marketKey] = { orders: msg.orders, history: msg.history };
           this.onUpdate?.();
         })
     );
   }

    async switchMarket(
      type: 'FUTURES' | 'SPOT',
      contract_id: number,
      p?: { depth?: number; side?: 'bids' | 'asks' | 'both'; includeTrades?: boolean }
    ) {
      this.bindOnce();
      const newKey = this.key(type, contract_id);

      if (this.activeKey && this.activeKey !== newKey) {
        this.socketService.send('orderbook:leave',this.activeKey)
      }
      this.activeKey = newKey;
      this._lastRequestedKey = newKey;

      // 1. Ask server for a fresh snapshot (WS)
      this.socketService.send('update-orderbook',{
              type,
              contract_id,
              depth: String(p?.depth ?? 50),
              side: p?.side ?? 'both',
              includeTrades: String(p?.includeTrades ?? false),
            })

      // 2. Join the market room for live deltas
      this.socketService.send('orderbook:join', newKey)
    }

  private _structureOrderbook(isBuy: boolean) {
    const contract_id = this.selectedMarket.contract_id;
      const { contractSize, isInverse } = this.getContractMeta(contract_id);
    const filteredOrderbook = this.rawOrderbookData.filter(
      (o) => o.props.contract_id === contract_id && o.action === (isBuy ? "BUY" : "SELL")
    );
    const range = 1000;
    const result: { price: number; amount: number }[] = [];
    filteredOrderbook.forEach((o) => {
      const _price = Math.trunc(o.props.price * range);

        const normalizedAmount = isInverse
          ? parseFloat((o.props.amount * o.props.price * contractSize).toFixed(8))
          : parseFloat((o.props.amount * contractSize).toFixed(8));

      const existing = result.find((_o) => Math.trunc(_o.price * range) === _price);
      if (existing) {
        existing.amount += normalizedAmount;
      } else {
        result.push({
          price: parseFloat(o.props.price.toFixed(4)),
          amount: normalizedAmount,
        });
      }
    });
    // Sort the result
    if (!isBuy) {
      this.lastPrice = result.sort((a, b) => b.price - a.price)?.[result.length - 1]?.price || this.currentPrice || 1;
    }

    return isBuy
      ? result.sort((a, b) => b.price - a.price).slice(0, 9)
      : result.sort((a, b) => b.price - a.price).slice(Math.max(result.length - 9, 0));
  }

   switchFuturesMarket(contract_id: number, opts?: { depth?: number; side?:'bids'|'asks'|'both'; includeTrades?: boolean }) {
        return this.switchMarket('FUTURES', contract_id, opts);
    }
}
