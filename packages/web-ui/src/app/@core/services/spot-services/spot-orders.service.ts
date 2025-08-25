import { Injectable } from "@angular/core";
import { LoadingService } from "../loading.service";
import { SocketService } from "../socket.service";
import { ISpotOrder } from "./spot-orderbook.service";
import { filter } from 'rxjs/operators'; 


interface ITradeConf {
    keypair: {
        address: string;
        pubkey: string;
    };
    action: "BUY" | "SELL";
    type: "SPOT";
    isLimitOrder: boolean;
    marketName: string;
}

export interface ISpotTradeConf extends ITradeConf {
    props: {
        id_desired: number,
        id_for_sale: number,
        amount: number,
        price: number,
        transfer?: boolean; // Add this  
    };
}

@Injectable({
    providedIn: 'root',
})

export class SpotOrdersService {
    private _openedOrders: ISpotOrder[] = [];
    private _orderHistory: any[] = [];


    constructor(private socketService: SocketService, private loading: LoadingService) {
      this.socketService.events$
        .pipe(filter(({event}) => event === 'order:filled' || event === 'order:closed' || event === 'order:canceled'))
        .subscribe(({data}) => {
          const uuid = data?.uuid || data?.orderUUID || data?.order?.uuid;
          if (uuid) this.openedOrders = this._openedOrders.filter(o => o.uuid !== uuid);
        });
    }

    get openedOrders(): ISpotOrder[] {
        return this._openedOrders;
    }

    set openedOrders(value: ISpotOrder[]) {
        this._openedOrders = value;
    }

    get orderHistory() {
        return this._orderHistory;
    }

    set orderHistory(value: any[]) {
        this._orderHistory = value;
    }

    newOrder(orderConf: ISpotTradeConf) {
        console.log('inside new order '+JSON.stringify(orderConf))
        this.socketService.send('new-order', orderConf);
    }

    addLiquidity(orders: ISpotTradeConf[]) {
        this.socketService.send('many-orders', orders);
    }

    closeOpenedOrder(uuid: string) {
        this.socketService.send('close-order', { orderUUID: uuid });
    }

    closeAllOrders() {
        this._openedOrders.forEach(o => this.closeOpenedOrder(o.uuid));
    }
}