import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { RpcService } from "./rpc.service";
import { SocketService } from "./socket.service";
import { TxsService } from "./txs.service";
import { LoadingService } from "./loading.service";
import { BuySwapper, SellSwapper, ITradeInfo } from "src/app/utils/swapper/"; 
import { ISpotTradeProps, IFuturesTradeProps } from "src/app/utils/swapper/common";
import { ISpotOrder } from "./spot-services/spot-orderbook.service";
import { IFuturesOrder } from "./futures-services/futures-orderbook.service";
import { ESounds, SoundsService } from "./sound.service";

interface IChannelSwapData {
    tradeInfo: ITradeInfo<any>; 
    unfilled: ISpotOrder | IFuturesOrder; 
    isBuyer: boolean;
}

@Injectable({
    providedIn: 'root',
})
export class SwapService {
    constructor(
        private socketService: SocketService,
        private rpcService: RpcService,
        private txsService: TxsService,
        private toastrService: ToastrService,
        private loadingService: LoadingService,
        private soundsService: SoundsService,
    ) {}

    private retrySocketConnection() {
        if (!this.socketService.obSocket?.connected) {
            console.log('Attempting to reconnect to obSocket...');
            this.socketService.obSocketConnect('https://your-socket-url'); // Replace with actual URL
        }
    }

    public onInit() {
        const socket = this.socketService.obSocket;

        if (!socket) {
            console.warn('obSocket is not connected. Retrying...');
            this.retrySocketConnection();
            return;
        }

        socket.on(`new-channel`, async (swapConfig: IChannelSwapData) => {
            this.loadingService.tradesLoading = false;
            const res = await this.channelSwap(swapConfig.tradeInfo, swapConfig.isBuyer);
            
            if (!res || res.error || !res.data?.txid) {
                this.toastrService.error(res?.error || 'Unknown Error', 'Trade Error');
            } else {
                this.soundsService.playSound(ESounds.TRADE_COMPLETED);
                this.toastrService.success('Trade Completed', res.data.txid, { timeOut: 3000 });
            }
        });
    }

    private async channelSwap(tradeInfo: ITradeInfo<any>, isBuyer: boolean) {
        const { buyer, seller, props, type } = tradeInfo;
        console.log('Inside channel swap:', JSON.stringify(tradeInfo));
        const socket = this.socketService.obSocket;

        if (!socket) {
            throw new Error("obSocket is not connected");
        }

        if (type === "SPOT") {
            const { transfer } = props as ISpotTradeProps;

            const swapper = isBuyer
                ? new BuySwapper(type, props, buyer, seller, this.rpcService.rpc.bind(this.rpcService), socket, this.txsService, this.toastrService)
                : new SellSwapper(type, props, seller, buyer, this.rpcService.rpc.bind(this.rpcService), socket, this.txsService, this.toastrService);

            swapper.eventSubs$.subscribe(eventData => {
                this.toastrService.info(eventData.eventName, 'Trade Info', { timeOut: 3000 });
            });

            const res = await swapper.onReady();
            return res;
        } else if (type === "FUTURES") {
            const { transfer } = props as IFuturesTradeProps;

            const swapper = isBuyer
                ? new BuySwapper(type, props, buyer, seller, this.rpcService.rpc.bind(this.rpcService), socket, this.txsService, this.toastrService)
                : new SellSwapper(type, props, seller, buyer, this.rpcService.rpc.bind(this.rpcService), socket, this.txsService, this.toastrService);

            swapper.eventSubs$.subscribe(eventData => {
                this.toastrService.info(eventData.eventName, 'Trade Info', { timeOut: 3000 });
            });

            const res = await swapper.onReady();
            return res;
        } else {
            throw new Error(`Unsupported trade type: ${type}`);
        }
    }
}
