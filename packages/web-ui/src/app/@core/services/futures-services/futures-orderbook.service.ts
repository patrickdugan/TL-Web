import { Injectable } from "@angular/core";
import { Subject } from "rxjs";
import { SocketService } from "../socket.service"; // <-- Notice we removed `obEventPrefix`
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

  /**
   *  Subscribe to raw events: "order:error", "order:saved", "update-orders-request", "orderbook-data"
   */
  subscribeForOrderbook() {
    this.endOrderbookSubscription();

    // Listen for server events directly by their raw names
    this.socketService.obSocket?.on("order:error", (message: string) => {
      this.toastrService.error(message || `Undefined Error`, "Orderbook Error");
      this.loadingService.tradesLoading = false;
    });

    this.socketService.obSocket?.on("order:saved", (data: any) => {
      //this.loadingService.tradesLoading = false;
      this.toastrService.success(`The Order is Saved in Orderbook`, "Success");
    });

    this.socketService.obSocket?.on("update-orders-request", () => {
      this.socketService.send("update-orderbook", this.marketFilter);
    });

    this.socketService.obSocket?.on("orderbook-data", (orderbookData: IFuturesOrderbookData) => {
      this.rawOrderbookData = orderbookData.orders;
      this.tradeHistory = orderbookData.history;
      const lastTrade = this.tradeHistory[0];
      if (!lastTrade) {
        this.currentPrice = 1;
        return;
      }
      this.currentPrice = lastTrade?.props?.price || 1;
    });

    // Manually request the latest orderbook
    this.socketService.send("update-orderbook", this.marketFilter);
  }

  /**
   *  Unsubscribe from the raw events
   */
  endOrderbookSubscription() {
    ["update-orders-request", "orderbook-data", "order:error", "order:saved"].forEach((evt) =>
      this.socketService.obSocket?.off(evt)
    );
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
    const filteredOrderbook = this.rawOrderbookData.filter(
      (o) => o.props.contract_id === contract_id && o.action === (isBuy ? "BUY" : "SELL")
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
    // Sort the result
    if (!isBuy) {
      this.lastPrice = result.sort((a, b) => b.price - a.price)?.[result.length - 1]?.price || this.currentPrice || 1;
    }

    return isBuy
      ? result.sort((a, b) => b.price - a.price).slice(0, 9)
      : result.sort((a, b) => b.price - a.price).slice(Math.max(result.length - 9, 0));
  }
}
