import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { RpcService } from "./rpc.service";
import { SocketService } from "./socket.service";
import { Socket } from 'socket.io-client';
import { TxsService } from "./txs.service";
import { LoadingService } from "./loading.service";
import { BuySwapper, SellSwapper, ITradeInfo } from "src/app/utils/swapper/"; 
import { ISpotTradeProps, IFuturesTradeProps } from "src/app/utils/swapper/common";
import { ISpotOrder } from "./spot-services/spot-orderbook.service";
import { IFuturesOrder } from "./futures-services/futures-orderbook.service";
import { ESounds, SoundsService } from "./sound.service";
import { WalletService } from 'src/app/@core/services/wallet.service';

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
        private walletService: WalletService
    ) {}

    public async onInit(swapConfig: IChannelSwapData, socket:Socket) {
                console.log('new channel '+JSON.stringify(swapConfig))
                this.loadingService.tradesLoading = false;
                const res = await this.channelSwap(swapConfig.tradeInfo, swapConfig.isBuyer, socket);
                
                if (!res || res.error || !res.data?.txid) {
                    this.toastrService.error(res?.error || 'Unknown Error', 'Trade Error');
                } else {
                    this.soundsService.playSound(ESounds.TRADE_COMPLETED);
                    this.toastrService.success('Trade Completed', res.data.txid, { timeOut: 3000 });
                }
    }

    private async channelSwap(tradeInfo: ITradeInfo<any>, isBuyer: boolean, socket:Socket) {
        const { buyer, seller, props, type } = tradeInfo;
        console.log('Inside channel swap:', JSON.stringify(tradeInfo));
        
        if (!socket) {
            throw new Error("obSocket is not connected");
        }

        if (type === "SPOT") {
            const { transfer } = props as ISpotTradeProps;

            const swapper = isBuyer
                ? new BuySwapper(type, props, buyer, seller, socket, this.txsService, this.toastrService,this.walletService)
                : new SellSwapper(type, props, seller, buyer, socket, this.txsService, this.toastrService,this.walletService);

            swapper.eventSubs$.subscribe(eventData => {
                this.toastrService.info(eventData.eventName, 'Trade Info', { timeOut: 3000 });
            });

            const res = await swapper.onReady();
            return res;
        } else if (type === "FUTURES") {
            const { transfer } = props as IFuturesTradeProps;

            const swapper = isBuyer
                ? new BuySwapper(type, props, buyer, seller, socket, this.txsService, this.toastrService,this.walletService)
                : new SellSwapper(type, props, seller, buyer, socket, this.txsService, this.toastrService,this.walletService);

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
