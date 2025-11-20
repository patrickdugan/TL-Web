import { Injectable } from "@angular/core";
import { LoadingService } from "../loading.service";
import { SocketService } from "../socket.service";
import { FuturesMarketService } from "./futures-markets.service";
import { RpcService } from "../rpc.service"

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
    private futuresMarketService: FuturesMarketService,
    private rpcService: RpcService,
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
        const net = this.rpcService.NETWORK
        const msg = { ...orderConf, network: net }

        this.socketService.send('new-order', msg);
  }

  // Alias some UI calls use
  newOrder(orderConf: IFuturesTradeConf) {
    this.placeOrder(orderConf);
  }

  addLiquidity(orders: IFuturesTradeConf[]) {
    const net = this.rpcService.NETWORK
    this.socketService.send("many-orders", {orders,network:net});
  }

  closeOpenedOrder(uuid: string) {
    const sel = (this.futuresMarketService as any)?.selectedMarket;
    const ctx = sel ? { contract_id: sel.contract_id } : {};
    const net = this.rpcService.NETWORK
    this.socketService.send("close-order", { orderUUID: uuid, ...ctx, network: net});
  }

  closeAllOrders() {
    (this._openedOrders || []).forEach(o => this.closeOpenedOrder((o as any).uuid));
  }
}
