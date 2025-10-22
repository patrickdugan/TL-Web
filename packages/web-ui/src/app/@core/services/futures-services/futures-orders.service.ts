import { Injectable } from "@angular/core";
import { LoadingService } from "../loading.service";
import { SocketService } from "../socket.service";
import { FuturesMarketService } from "./futures-markets.service";

export interface IFuturesTradeConf {
  keypair: { address: string; pubkey: string };
  action: "BUY" | "SELL";
  type: "FUTURES";
  isLimitOrder: boolean;
  marketName: string;
  props: {
    amount: number;
    contract_id: number;
    price: number;
    collateral: number;
    leverage?: number;   // optional to match caller
    margin?: number;     // optional to match caller
    transfer?: boolean;  // optional passthrough
  };
}

// Make amount/price/collateral REQUIRED so components can safely do amount*price
export interface IFuturesOrderRow {
  uuid?: string;
  props: {
    contract_id?: number;
    amount: number;
    price: number;
    collateral?: number;
    [k: string]: any;
  };
  [k: string]: any;
}

@Injectable({ providedIn: "root" })
export class FuturesOrdersService {
  private _openedOrders: IFuturesOrderRow[] = [];

  // UI reads/writes this
  public orderHistory: any[] = [];

  constructor(
    private loadingService: LoadingService,
    private socketService: SocketService,
    private futuresMarketService: FuturesMarketService
  ) {}

  get openedOrders(): IFuturesOrderRow[] {
    return this._openedOrders;
  }
  set openedOrders(value: IFuturesOrderRow[]) {
    this._openedOrders = Array.isArray(value) ? value.slice() : [];
  }

  openedOrdersForActive(): IFuturesOrderRow[] {
    const sel = (this.futuresMarketService as any)?.selectedMarket;
    if (!sel) return this._openedOrders;
    const cid = Number(sel.contract_id);
    return this._openedOrders.filter(o => Number(o?.props?.contract_id) === cid);
  }

  placeOrder(orderConf: IFuturesTradeConf) {
    this.socketService.send("new-order", orderConf);
  }

  // Alias some UI calls use
  newOrder(orderConf: IFuturesTradeConf) {
    this.placeOrder(orderConf);
  }

  addLiquidity(orders: IFuturesTradeConf[]) {
    this.socketService.send("many-orders", orders);
  }

  closeOpenedOrder(uuid: string) {
    const sel = (this.futuresMarketService as any)?.selectedMarket;
    const ctx = sel ? { contract_id: sel.contract_id } : {};
    this.socketService.send("close-order", { orderUUID: uuid, ...ctx });
  }

  closeAllOrders() {
    (this._openedOrders || []).forEach(o => this.closeOpenedOrder((o as any).uuid));
  }
}
