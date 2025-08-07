import { Injectable } from "@angular/core";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { SocketService } from "../socket.service";
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { AuthService } from "../auth.service";
import { FuturesMarketService } from "./futures-markets.service";
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
  private _rawOrderbookData: IFuturesOrder[] = [];
  outsidePriceHandler: Subject<number> = new Subject();
  buyOrderbooks: { amount: number; price: number }[] = [];
  sellOrderbooks: { amount: number; price: number }[] = [];
  tradeHistory: IFuturesHistoryTrade[] = [];
  currentPrice: number = 1;
  lastPrice: number = 1;

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
      ).subscribe(({ data: orderbookData }: { data: IFuturesOrderbookData }) => {
        this.rawOrderbookData = orderbookData.orders;
        this.tradeHistory = orderbookData.history;
        const lastTrade = this.tradeHistory[0];
        if (!lastTrade) {
          this.currentPrice = 1;
          return;
        }
        this.currentPrice = lastTrade?.props?.price || 1;
      })
    );

    // Manually request the latest orderbook
    this.socketService.send("update-orderbook", this.marketFilter);
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
}
