import { Injectable } from "@angular/core";
import { LoadingService } from "../loading.service";
import { SocketService } from "../socket.service";
import { SpotMarketsService, IMarket } from "./spot-markets.service";

export interface ISpotTradeConf {
  keypair: { address: string; pubkey: string };
  action: "BUY" | "SELL";
  type: "SPOT";
  isLimitOrder: boolean;
  marketName: string;
  props: {
    amount: number;
    id_desired: number;
    id_for_sale: number;
    price: number;
    transfer?: boolean; // optional passthrough
  };
}

// Make amount/price/id_for_sale REQUIRED so components can safely destructure/use
export interface ISpotOrderRow {
  uuid?: string;
  props: {
    id_for_sale: number;
    id_desired?: number;
    amount: number;
    price: number;
    [k: string]: any;
  };
  [k: string]: any;
}

@Injectable({ providedIn: "root" })
export class SpotOrdersService {
  private _openedOrders: ISpotOrderRow[] = [];

  // UI reads/writes this
  public orderHistory: any[] = [];

  constructor(
    private loadingService: LoadingService,
    private socketService: SocketService,
    private spotMarketService: SpotMarketsService
  ) {}

  get openedOrders(): ISpotOrderRow[] {
    return this._openedOrders;
  }
  set openedOrders(value: ISpotOrderRow[]) {
    this._openedOrders = Array.isArray(value) ? value.slice() : [];
  }

  openedOrdersForActive(): ISpotOrderRow[] {
    const sel = (this.spotMarketService as any)?.selectedMarket as IMarket | undefined;
    if (!sel) return this._openedOrders;
    const base = Number(sel.first_token?.propertyId);
    const quote = Number(sel.second_token?.propertyId);
    return this._openedOrders.filter(o => {
      const a = Number(o?.props?.id_for_sale);
      const b = Number(o?.props?.id_desired);
      return (a === base && b === quote) || (a === quote && b === base);
    });
  }

  placeOrder(orderConf: ISpotTradeConf) {
    this.socketService.send("new-order", orderConf);
  }

  // Alias some UI calls use
  newOrder(orderConf: ISpotTradeConf) {
    this.placeOrder(orderConf);
  }

  addLiquidity(orders: ISpotTradeConf[]) {
    this.socketService.send("many-orders", orders);
  }

  closeOpenedOrder(uuid: string) {
    const found = (this._openedOrders || []).find(o => o?.uuid === uuid);
    const base =
      found?.props?.id_for_sale ??
      (this.spotMarketService as any)?.selectedMarket?.first_token?.propertyId;
    const quote =
      found?.props?.id_desired ??
      (this.spotMarketService as any)?.selectedMarket?.second_token?.propertyId;

    this.socketService.send("close-order", {
      orderUUID: uuid,
      id_for_sale: base,
      id_desired: quote
    });
  }

  closeAllOrders() {
    (this._openedOrders || []).forEach(o => this.closeOpenedOrder((o as any).uuid));
  }
}
