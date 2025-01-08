import { Injectable } from "@angular/core";
import { Subject } from "rxjs";
import { SpotMarketsService } from "./spot-markets.service";
import { SocketService } from "../socket.service"; // <-- Removed obEventPrefix import
import { ToastrService } from "ngx-toastr";
import { LoadingService } from "../loading.service";
import { AuthService } from "../auth.service";
import { ITradeInfo } from "src/app/utils/swapper";
import { ISpotTradeProps } from "src/app/utils/swapper/common";

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
  socket_id: string;
  timestamp: number;
  type: "SPOT";
  uuid: string;
  state?: "CANCALED" | "FILLED";
}

@Injectable({
  providedIn: "root",
})
export class SpotOrderbookService {
  private _rawOrderbookData: ISpotOrder[] = [];
  outsidePriceHandler: Subject<number> = new Subject();
  buyOrderbooks: { amount: number; price: number }[] = [];
  sellOrderbooks: { amount: number; price: number }[] = [];
  tradeHistory: ISpotHistoryTrade[] = [];
  currentPrice: number = 1;
  lastPrice: number = 1;

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

  /**
   * Subscribe to raw events:
   *  "order:error", "order:saved", "update-orders-request", "orderbook-data"
   */
  subscribeForOrderbook() {
    this.endOrderbookSubscription();

    // Now we listen to the events with their raw, server-emitted names:
    this.socketService.obSocket?.on("order:error", (message: string) => {
      this.toastrService.error(message || `Undefined Error`, "Orderbook Error");
      this.loadingService.tradesLoading = false;
    });

    this.socketService.obSocket?.on("order:saved", (data: any) => {
      this.loadingService.tradesLoading = false;
      this.toastrService.success(`The Order is Saved in Orderbook`, "Success");
    });

    this.socketService.obSocket?.on("update-orders-request", () => {
      this.socketService.obSocket?.emit("update-orderbook", this.marketFilter);
    });

    this.socketService.obSocket?.on("orderbook-data", (orderbookData: ISpotOrderbookData) => {
      this.rawOrderbookData = orderbookData.orders;
      this.tradeHistory = orderbookData.history;
      const lastTrade = this.tradeHistory[0];
      if (!lastTrade) {
        this.currentPrice = 1;
        return;
      }
      const { amountForSale, amountDesired } = lastTrade.props;
      const price = parseFloat((amountForSale / amountDesired).toFixed(6)) || 1;
      this.currentPrice = price;
    });

    // Finally, request the current orderbook
    this.socketService.obSocket?.emit("update-orderbook", this.marketFilter);
  }

  /**
   * Unsubscribe from the raw events
   */
  endOrderbookSubscription() {
    const events = ["update-orders-request", "orderbook-data", "order:error", "order:saved"];
    events.forEach((evt) => this.socketService.obSocket?.off(evt));
  }

  /**
   * Rebuild local buy/sell arrays from raw orderbook data
   */
  private structureOrderBook() {
    this.buyOrderbooks = this._structureOrderbook(true);
    this.sellOrderbooks = this._structureOrderbook(false);
  }

  private _structureOrderbook(isBuy: boolean) {
    const propIdDesired = isBuy
      ? this.selectedMarket.first_token.propertyId
      : this.selectedMarket.second_token.propertyId;
    const propIdForSale = isBuy
      ? this.selectedMarket.second_token.propertyId
      : this.selectedMarket.first_token.propertyId;
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
}
