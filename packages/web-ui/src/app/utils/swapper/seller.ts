import { Socket as SocketClient } from 'socket.io-client';
import { IBuildTxConfig, IUTXO, TxsService } from "src/app/@core/services/txs.service";
import { IMSChannelData, SwapEvent, IBuyerSellerInfo, TClient, IFuturesTradeProps, ISpotTradeProps, ETradeType } from "./common";
import { Swap } from "./swap";
import { ENCODER } from '../payloads/encoder';
import { ToastrService } from "ngx-toastr";
import { WalletService } from 'src/app/@core/services/wallet.service';
import axios from 'axios';

export class SellSwapper extends Swap {
        private tradeStartTime: number; // Add this declaration for tradeStartTime
    constructor(
        typeTrade: ETradeType,
        tradeInfo: ISpotTradeProps, // IFuturesTradeProps can be added if needed for futures
        sellerInfo: IBuyerSellerInfo,
        buyerInfo: IBuyerSellerInfo,
        socket: SocketClient,
        txsService: TxsService,
        private toastrService: ToastrService,
        private walletService: WalletService
    ) {
        super(typeTrade, tradeInfo, sellerInfo, buyerInfo, socket, txsService);
        this.handleOnEvents();
        this.tradeStartTime = Date.now(); // Start time of the trade
        this.onReady();
        this.initTrade();
    }

    
    private logTime(stage: string) {
        const currentTime = Date.now();
        console.log(`Time taken for ${stage}: ${currentTime - this.tradeStartTime} ms`);
    }

    private handleOnEvents() {
        this.removePreviuesListeners();
        const _eventName = `${this.cpInfo.socketId}::swap`;
        console.log(_eventName)
        this.socket.on(_eventName, (eventData: SwapEvent) => {
            this.eventSubs$.next(eventData);
            const { socketId, data } = eventData;
            console.log('event data '+JSON.stringify(eventData))
            switch (eventData.eventName){
                case 'TERMINATE_TRADE':
                    this.onTerminateTrade.bind(this)(socketId, data);
                    break;
                case 'BUYER:STEP2':
                    this.onStep2.bind(this)(socketId);
                    break;
                case 'BUYER:STEP4':
                    this.onStep4.bind(this)(socketId, data);
                    break;
                case 'BUYER:STEP6':
                    this.onStep6.bind(this)(socketId, data);
                    break;
                default:
                    break;
            }
        });
    }

    private async initTrade() {
        try {
             let pubKeys = [this.myInfo.keypair.pubkey, this.cpInfo.keypair.pubkey]
        if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
            let { propIdDesired, propIdForSale} = this.tradeInfo
            if(propIdDesired==0||propIdForSale==0){
                pubKeys = [this.cpInfo.keypair.pubkey,this.myInfo.keypair.pubkey]
            }
        }
            console.log('showing pubkeys before adding multisig '+JSON.stringify(pubKeys))
            let amaRes = await this.walletService.addMultisig(2, pubKeys)
            if(!amaRes||amaRes==undefined){
                amaRes = await this.walletService.addMultisig(2, pubKeys)
            }
            this.multySigChannelData = amaRes as IMSChannelData;
            console.log('amaRes '+JSON.stringify(amaRes))
            console.log('multisig object '+JSON.stringify(this.multySigChannelData))

            const swapEvent = new SwapEvent(`SELLER:STEP1`, this.myInfo.socketId, this.multySigChannelData);
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        } catch (error: any) {
            const errorMessage = error.message || 'Undefined Error';
            this.terminateTrade(`InitTrade: ${errorMessage}`);
        }
    }

    private async onStep2(cpId: string) {
            this.logTime('Step 2 Start');
        try {
            if (!this.multySigChannelData?.address) throw new Error(`Error with finding Multisig Address`);
            console.log('cpId '+cpId+' '+'this.cpInfo.socketId '+this.cpInfo.socketId)
            if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);

            const fromKeyPair = { address: this.myInfo.keypair.address };
            const toKeyPair = { address: this.multySigChannelData.address };
            const amount = 0.0000546
            const commitTxConfig: IBuildTxConfig = { fromKeyPair, toKeyPair, amount };

            let propIdDesired: number = 0;
            let amountDesired: number = 0;
            let transfer = false;

            const ctcpParams = [];
            if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
                ({ propIdDesired, amountDesired, transfer = false } = this.tradeInfo as ISpotTradeProps);
                console.log('imported transfer', transfer);
                ctcpParams.push(propIdDesired, amountDesired.toString());
            }

              // Check if `propIdDesired` and `amountDesired` are assigned before usage
                if (propIdDesired === undefined || amountDesired === undefined) {
                    throw new Error('propIdDesired or amountDesired is undefined');
                }

            const column = 'A' //since only one side has a token on the channel and we use converse keys for LTC trades this function is redundant, also buggy and laggy... await this.txsService.predictColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address);
            
            const isColumnA = column === 'A';

            let payload;
            /*if (transfer) {
                console.log('Using channel balance for transfer');

                payload = ENCODER.encodeTransfer({
                    propertyId: propIdDesired,
                    amount: amountDesired,
                    isColumnA: isColumnA,
                    destinationAddr: this.multySigChannelData.address,
                });
            } else {*/
                console.log('Using available balance for trade');

                payload = ENCODER.encodeCommit({
                    amount: amountDesired,
                    propertyId: propIdDesired,
                    channelAddress: this.multySigChannelData.address,
                });
            //}

            commitTxConfig.payload = payload;

            const commitTxRes = await this.txsService.buildSignSendTxGrabUTXO(commitTxConfig);
            if (commitTxRes.error || !commitTxRes.txid) throw new Error(`Build Commit TX: ${commitTxRes.error}`);

            let commitUTXO = commitTxRes.commitUTXO;
            

            const utxoData = {
                amount: commitUTXO?.amount || 0,
                vout: commitUTXO?.vout || 0,
                txid: commitTxRes.txid,
                scriptPubKey: this.multySigChannelData.scriptPubKey,
                redeemScript: this.multySigChannelData.redeemScript,
            } as IUTXO;
            console.log('commit utxoData to pass to buyer '+JSON.stringify(utxoData))
            const swapEvent = new SwapEvent(`SELLER:STEP3`, this.myInfo.socketId, utxoData);
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        } catch (error: any) {
            const errorMessage = error.message || 'Undefined Error';
            this.terminateTrade(`Step 2: ${errorMessage}`);
        }
    }


    private async onStep4(cpId: string, psbtHex: string) {
            this.logTime('Step 4 Start');
       try{
            const signRes = await this.txsService.signPsbt(psbtHex, true);

            if (signRes.error || !signRes.data?.finalHex) return console.log(`Sign Tx: ${signRes.error}`);
            console.log('sign res '+JSON.stringify(signRes))
            const swapEvent = new SwapEvent(`SELLER:STEP5`, this.myInfo.socketId, signRes.data.finalHex);
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent); 
        } catch (error: any) {
            const errorMessage = error.message || 'Undefined Error';
            this.terminateTrade(`Step 4: ${errorMessage}`);
        }
    }

    private async onStep6(cpId: string, finalTx: string) {
            this.logTime('Step 6 Start');
             const currentTime = Date.now();
            this.toastrService.info(`Signed! ${currentTime - this.tradeStartTime} ms`);

        //try {
            if (cpId !== this.cpInfo.socketId) /*throw new Error*/{console.log(`Error with p2p connection`)};

            const data = { txid: finalTx, seller: true, trade: this.tradeInfo };
            this.readyRes({ data });
            this.removePreviuesListeners();
        //} catch (error: any) {
        //    const errorMessage = error.message || 'Undefined Error';
        //    this.terminateTrade(`Step 6: ${errorMessage}`);
        //}
    }
}
