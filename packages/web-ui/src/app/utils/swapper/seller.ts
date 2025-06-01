import { Socket as SocketClient } from 'socket.io-client';
import { IBuildTxConfig, IUTXO, TxsService } from "src/app/@core/services/txs.service";
import { IMSChannelData, SwapEvent, IBuyerSellerInfo, TClient, IFuturesTradeProps, ISpotTradeProps, ETradeType } from "./common";
import { Swap } from "./swap";
import { ENCODER } from '../payloads/encoder';
import { ToastrService } from "ngx-toastr";
import { WalletService } from 'src/app/@core/services/wallet.service';
import { RpcService, ENetwork } from 'src/app/@core/services/rpc.service'
import { ENDPOINTS } from 'src/environments/endpoints.conf';
import BigNumber from 'bignumber.js';
import axios from 'axios';

export class SellSwapper extends Swap {
    private tradeStartTime: number;

    constructor(
        typeTrade: ETradeType,
        tradeInfo: ISpotTradeProps | IFuturesTradeProps,
        sellerInfo: IBuyerSellerInfo,
        buyerInfo: IBuyerSellerInfo,
        socket: SocketClient,
        txsService: TxsService,
        private toastrService: ToastrService,
        private walletService: WalletService,
        private rpcService: RpcService
    ) {
        super(typeTrade, tradeInfo, sellerInfo, buyerInfo, socket, txsService);
        this.handleOnEvents();
        this.tradeStartTime = Date.now();
        this.onReady();
        this.initTrade();
    }

    private logTime(stage: string) {
        const currentTime = Date.now();
        console.log(`Time taken for ${stage}: ${currentTime - this.tradeStartTime} ms`);
    }

    get relayerUrl(): string {
        const net = this.rpcService.NETWORK;
        console.log('[FMS] rpcService.NETWORK =', net, 'typeof →', typeof net);

        // 1) If they in fact passed you an object that _already_ has
        //    a relayerUrl field (e.g. ENDPOINTS.LTCTEST itself),
        //    just use that directly:
        if (net && typeof net === 'object' && 'relayerUrl' in net) {
          // @ts-ignore – we know it has relayerUrl
          const urlFromObj = (net as any).relayerUrl;
          console.log('[FMS] using relayerUrl on NETWORK object →', urlFromObj);
          return urlFromObj;
        }

        // 2) Otherwise stringify it (in case it's a number, enum, etc.)
        const key = String(net) as ENetwork;
        console.log('[FMS] coerced network key →', key);

        // 3) Compare against your enum
        if (key === ENetwork.LTCTEST) {
          const u = ENDPOINTS.LTCTEST.relayerUrl;
          console.log('[FMS] matched LTCTEST →', u);
          return u;
        }

        // 4) Default to mainnet
        const fallback = ENDPOINTS.LTC.relayerUrl;
        console.log('[FMS] defaulting to LTC →', fallback);
        return fallback;
      }

    private handleOnEvents() {
        this.removePreviuesListeners();
        const _eventName = `${this.cpInfo.socketId}::swap`;
        this.socket.on(_eventName, (eventData: SwapEvent) => {
            this.eventSubs$.next(eventData);
            const { socketId, data } = eventData;
            switch (eventData.eventName) {
                case 'TERMINATE_TRADE':
                    this.onTerminateTrade(socketId, data);
                    break;
                case 'BUYER:STEP2':
                    this.onStep2(socketId);
                    break;
                case 'BUYER:STEP4':
                    const { psbtHex, commitTxId } = data || {};
                    this.onStep4(socketId, psbtHex, commitTxId);
                    break;
                case 'BUYER:STEP6':
                    this.onStep6(socketId, data);
                    break;
            }
        });
    }

    private async initTrade() {
        try {
            let pubKeys = [this.myInfo.keypair.pubkey, this.cpInfo.keypair.pubkey];
            if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
                const { propIdDesired, propIdForSale } = this.tradeInfo;
                if (propIdDesired === 0 || propIdForSale === 0) {
                    pubKeys = [this.cpInfo.keypair.pubkey, this.myInfo.keypair.pubkey];
                }
            }
            const ms = await this.walletService.addMultisig(2, pubKeys);
            if (!ms || !ms.address || !ms.redeemScript) throw new Error('Multisig setup failed');
this.multySigChannelData = ms as IMSChannelData;
            const swapEvent = new SwapEvent('SELLER:STEP1', this.myInfo.socketId, this.multySigChannelData);
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        } catch (err: any) {
            this.terminateTrade(`InitTrade: ${err.message}`);
        }
    }

    private async onStep2(cpId: string) {
        this.logTime('Step 2 Start');
        try {
            if (!this.multySigChannelData?.address || cpId !== this.cpInfo.socketId) {
                throw new Error('Step 2: invalid channel setup or cpId mismatch');
            }

            const fromKeyPair = { address: this.myInfo.keypair.address };
            const toKeyPair = { address: this.multySigChannelData.address };
            let payload: string;

            if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
                const { propIdDesired, amountDesired, transfer = false } = this.tradeInfo;
                const isA = await this.txsService.predictColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address) === 'A';

                payload = transfer
                    ? ENCODER.encodeTransfer({ propertyId: propIdDesired, amount: amountDesired, isColumnA: isA, destinationAddr: toKeyPair.address })
                    : ENCODER.encodeCommit({ propertyId: propIdDesired, amount: amountDesired, channelAddress: toKeyPair.address });
            }else if (this.typeTrade === ETradeType.FUTURES && 'contract_id' in this.tradeInfo) {
                const { contract_id, amount, price, levarage, transfer = false } = this.tradeInfo;
                const isA = await this.txsService.predictColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address) === 'A';
                const margin = new BigNumber(amount).times(price).dividedBy(levarage).decimalPlaces(8).toNumber();

                const ctr= await axios.post(`${this.relayerUrl}/tl_listContractSeries`, { contractId: contract_id });
                const collateral = ctr?.data?.collateral;
                if (!collateral) throw new Error('No collateral propertyId in contract');

                payload = transfer
                    ? ENCODER.encodeTransfer({ propertyId: collateral, amount: margin, isColumnA: isA, destinationAddr: toKeyPair.address })
                    : ENCODER.encodeCommit({ propertyId: collateral, amount: margin, channelAddress: toKeyPair.address });
            } else {
                throw new Error('Unrecognized trade type');
            }

            const commitTx = await this.txsService.buildSignSendTxGrabUTXO({ fromKeyPair, toKeyPair, payload });
            if (commitTx.error || !commitTx.txid || !commitTx.commitUTXO) throw new Error(`Commit TX failed: ${commitTx.error}`);

            const utxo: IUTXO = {
                ...commitTx.commitUTXO,
                txid: commitTx.txid,
                scriptPubKey: this.multySigChannelData.scriptPubKey,
                redeemScript: this.multySigChannelData.redeemScript
            };

            this.socket.emit(`${this.myInfo.socketId}::swap`, new SwapEvent('SELLER:STEP3', this.myInfo.socketId, utxo));
        } catch (err: any) {
            this.terminateTrade(`Step 2: ${err.message}`);
        }
    }

    private async onStep4(cpId: string, psbtHex: string, commitTxId?: string) {
        this.logTime('Step 4 Start');
        try {
            if (cpId !== this.cpInfo.socketId) throw new Error('Step 4: p2p mismatch');
            if (!psbtHex) throw new Error('Step 4: missing PSBT');

            if (commitTxId) {
                const txRes = await axios.get(`https://api.layerwallet.com/tx/${commitTxId}?verbose=true`);
                const vins = txRes?.data?.vin || [];
                const isRbf = vins.some((vin: any) => vin.sequence < 0xfffffffe);
                if (isRbf) throw new Error('RBF-enabled commit tx detected');
            }

            const signRes = await this.txsService.signPsbt(psbtHex,true);
            if (signRes.error || !signRes.data?.psbtHex) throw new Error(`PSBT sign failed: ${signRes.error}`);

            this.socket.emit(`${this.myInfo.socketId}::swap`, new SwapEvent('SELLER:STEP5', this.myInfo.socketId, signRes.data.psbtHex));
        } catch (err: any) {
            this.terminateTrade(`Step 4: ${err.message}`);
        }
    }

    private async onStep6(cpId: string, finalTx: string) {
        this.logTime('Step 6 Start');
        if (cpId !== this.cpInfo.socketId) return this.terminateTrade('Step 6: p2p mismatch');
        this.toastrService.info(`Trade complete: ${finalTx}`);
        if (this.readyRes) this.readyRes({ data: { txid: finalTx, seller: true, trade: this.tradeInfo } });
        this.removePreviuesListeners();
    }
}
