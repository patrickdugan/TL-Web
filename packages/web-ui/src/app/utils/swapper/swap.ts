import { TxsService } from "src/app/@core/services/txs.service";
import { ETradeType, IBuyerSellerInfo, IFuturesTradeProps, IMSChannelData, ISpotTradeProps, SwapEvent, TClient } from "./common";
import { Subject, Subscription } from "rxjs";
import { filter } from "rxjs/operators";
import { Observable } from "rxjs";
import { SocketService } from "../../@core/services/socket.service";

export abstract class Swap {
    readyRes: (value: { data?: any, error?: any }) => void = () => {};
    eventSubs$: Subject<SwapEvent> = new Subject();
    multySigChannelData: IMSChannelData | null = null;
    // ADD:
    protected swapSub?: Subscription;
    protected socket!: Observable<any>; // Up top, outside constructor

    constructor(
        public typeTrade: ETradeType,
        public tradeInfo: ISpotTradeProps|IFuturesTradeProps, 
        public myInfo: IBuyerSellerInfo,
        public cpInfo: IBuyerSellerInfo,
        socket: Observable<any>,                 // <--- plain param
        public txsService: TxsService,
        protected socketService: SocketService,
        protected tradeUUID: string
    ) {
        this.socket = socket;                    // <--- explicit assignment
    }


    onReady() {
        return new Promise<{ data?: any, error?: any }>((res) => {
            this.readyRes = res;
            setTimeout(() => this.terminateTrade('Undefined Error code 1'), 60000);
        });
    }

    terminateTrade(reason: string = 'No info'): void {
        const eventData = new SwapEvent('TERMINATE_TRADE', this.myInfo.socketId, reason);
        this.socketService?.send(`${this.myInfo.socketId}::swap`, eventData);
        this.onTerminateTrade('', reason);
    }

    onTerminateTrade(cpId: string, reason: string = 'Undefined Reason') {
        if (this.readyRes) this.readyRes({ error: reason });
        this.removePreviuesListeners();
    }

    // PATCH: Remove listener using RxJS pattern
    removePreviuesListeners() {
        if (this.swapSub) {
            this.swapSub.unsubscribe();
            this.swapSub = undefined;
        }
    }
}
