// FULL BuySwapper FOR WEB (Futures + Spot, Step1 first, RBF safe)

import { Socket as SocketClient } from 'socket.io-client';
import { IBuildLTCITTxConfig, IBuildTxConfig, IBuildTradeConfig, IUTXO, TxsService } from "src/app/@core/services/txs.service";
import { IMSChannelData, SwapEvent, IBuyerSellerInfo, TClient, IFuturesTradeProps, ISpotTradeProps, ETradeType } from "./common";
import { Swap } from "./swap";
import { ENCODER } from '../payloads/encoder';
import { ToastrService } from "ngx-toastr";
import { WalletService } from 'src/app/@core/services/wallet.service';
import { RpcService, ENetwork } from 'src/app/@core/services/rpc.service'
import { ENDPOINTS } from 'src/environments/endpoints.conf';
import BigNumber from 'bignumber.js';
import axios from 'axios';

export class BuySwapper extends Swap {
    private tradeStartTime: number;

    constructor(
        typeTrade: ETradeType,
        tradeInfo: ISpotTradeProps | IFuturesTradeProps,
        buyerInfo: IBuyerSellerInfo,
        sellerInfo: IBuyerSellerInfo,
        socket: SocketClient,
        txsService: TxsService,
        private toastrService: ToastrService,
        private walletService: WalletService,
        private rpcService: RpcService
    ) {
        super(typeTrade, tradeInfo, buyerInfo, sellerInfo, socket, txsService);
        this.handleOnEvents();
        this.tradeStartTime = Date.now();
        this.onReady();
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
            const { socketId, data } = eventData;
            this.eventSubs$.next(eventData);
            switch (eventData.eventName) {
                case 'TERMINATE_TRADE':
                    this.onTerminateTrade?.bind(this)(socketId, data);
                    break;
                case 'SELLER:STEP1':
                    this.onStep1?.bind(this)(socketId, data);
                    break;
                case 'SELLER:STEP3':
                    this.onStep3?.bind(this)(socketId, data);
                    break;
                case 'SELLER:STEP5':
                    this.onStep5?.bind(this)(socketId, data);
                    break;
            }
        });
    }

    private async onStep1(cpId: string, msData: IMSChannelData) {
        try {
            if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);
            let pubKeys = [this.cpInfo.keypair.pubkey, this.myInfo.keypair.pubkey];
            if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
                const { propIdDesired, propIdForSale } = this.tradeInfo;
                if (propIdDesired === 0 || propIdForSale === 0) {
                    pubKeys = [this.myInfo.keypair.pubkey, this.cpInfo.keypair.pubkey];
                }
            }
            let amaRes = await this.walletService.addMultisig(2, pubKeys);
            if (!amaRes || amaRes.redeemScript !== msData.redeemScript) {
                amaRes = await this.walletService.addMultisig(2, pubKeys);
            }
            if (!amaRes || amaRes.redeemScript !== msData.redeemScript) {
                throw new Error('Multisig mismatch');
            }
            this.multySigChannelData = msData;
            const swapEvent = new SwapEvent('BUYER:STEP2', this.myInfo.socketId);
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        } catch (error: any) {
            this.terminateTrade(`Step 1: ${error.message}`);
        }
    }

    private async onStep3(cpId: string, commitUTXO: IUTXO) {
        this.logTime('Step 3 Start');
        try {
            if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);
            if (!this.multySigChannelData) throw new Error(`Wrong Multisig Data Provided`);

            const chainInfoRes = await this.txsService.getChainInfo();
            const chainInfo = typeof chainInfoRes === 'string' ? JSON.parse(chainInfoRes) : chainInfoRes?.data;
            if (!chainInfo?.blocks) throw new Error('Unexpected response: blocks not found');
            const bbData = parseFloat(chainInfo.blocks) + 10;

            if (this.typeTrade === ETradeType.FUTURES && 'contract_id' in this.tradeInfo) {
                const { contract_id, amount, price, levarage,collateral, transfer = false } = this.tradeInfo;
                const column = await this.txsService.predictColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address);
                const isA = column === 'A' ? 1 : 0;
                const initMargin = new BigNumber(amount).times(price).dividedBy(levarage).decimalPlaces(8).toNumber();

            console.log('collat in futures buy step 3 '+collateral)
            console.log('initMargin calc '+initMargin+' '+price+' '+levarage+' '+isA)


                const payload = transfer
                    ? ENCODER.encodeTransfer({
                        propertyId: collateral,
                        amount: initMargin,
                        isColumnA: isA === 1,
                        destinationAddr: this.multySigChannelData.address
                    })
                    : ENCODER.encodeCommit({
                        propertyId: collateral,
                        amount: initMargin,
                        channelAddress: this.multySigChannelData.address
                    });
                    console.log('about to build commit tx '+this.myInfo.keypair.address+' '+this.multySigChannelData.address+' '+payload)
                const commitRes = await this.txsService.buildSignSendTxGrabUTXO({
                    fromKeyPair: { address: this.myInfo.keypair.address },
                    toKeyPair: { address: this.multySigChannelData.address },
                    payload
                });
                console.log('commit Res '+JSON.stringify(commitRes))
                if (commitRes.error || !commitRes.data?.rawtx) throw new Error(`Build Commit TX: ${commitRes.error}`);

                const { rawtx } = commitRes.data;

                const utxoData: IUTXO = {
                   amount: commitRes.commitUTXO?.amount
                    ? new BigNumber(commitRes.commitUTXO.amount).times(1e8).integerValue(BigNumber.ROUND_DOWN).toNumber(): 0,
                    vout: commitRes.commitUTXO?.vout ||0,
                    confirmations: commitRes.commitUTXO?.confirmations||0,
                    txid: commitRes.txid||"",
                    scriptPubKey: this.multySigChannelData.scriptPubKey,
                    redeemScript: this.multySigChannelData.redeemScript
                };

                const cpcitOptions = {
                    contractId:contract_id,
                    amount,
                    expiryBlock: bbData,
                    price,
                    action: 1,
                    columnAIsSeller: column === 'A',
                    leverage: levarage,
                    insurance:false
                };
                const payload2 = ENCODER.encodeTradeContractChannel(cpcitOptions);
                const buildOptions: IBuildLTCITTxConfig = {
                    buyerKeyPair: this.myInfo.keypair,
                    sellerKeyPair: this.cpInfo.keypair,
                    commitUTXOs: [commitUTXO, utxoData],
                    payload: payload2,
                    amount: 0
                };
                console.log('about to build trade tx in step 3 '+JSON.stringify(buildOptions))
                const rawHexRes = await this.txsService.buildTradeTx(buildOptions);
                if (rawHexRes.error || !rawHexRes.data?.psbtHex) throw new Error(`Build Trade: ${rawHexRes.error}`);

                const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, {
                    psbtHex: rawHexRes.data.psbtHex,
                    commitHex: rawtx,
                    commitTxId: commitRes.data
                });
                this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
            } else {
                // Full SPOT logic begins here
                const { propIdDesired, amountDesired, amountForSale, propIdForSale, transfer } = this.tradeInfo as ISpotTradeProps;
                const column = await this.txsService.predictColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address);
                const isA = column === 'A' ? 1 : 0;

                let ltcTrade = false;
                let ltcForSale = false;
                if (propIdDesired === 0) {
                    ltcTrade = true;
                } else if (propIdForSale === 0) {
                    ltcTrade = true;
                    ltcForSale = true;
                }

                if (ltcTrade === true) {
                    const tokenId = ltcForSale ? propIdDesired : propIdForSale;
                    const tokensSold = ltcForSale ? amountDesired : amountForSale;
                    const satsPaid = ltcForSale ? amountForSale : amountDesired;

                    const payload = ENCODER.encodeTradeTokenForUTXO({
                        propertyId: tokenId,
                        amount: tokensSold,
                        columnA: isA === 1,
                        satsExpected: satsPaid,
                        tokenOutput: 1,
                        payToAddress: 0
                    });

                    const buildOptions: IBuildLTCITTxConfig = {
                        buyerKeyPair: this.myInfo.keypair,
                        sellerKeyPair: this.cpInfo.keypair,
                        commitUTXOs: [commitUTXO],
                        payload,
                        amount: satsPaid
                    };

                    const rawHexRes = await this.txsService.buildLTCITTx(buildOptions, satsPaid);
                    if (rawHexRes.error || !rawHexRes.data?.psbtHex) throw new Error(`Build Trade: ${rawHexRes.error}`);

                    const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.data.psbtHex);
                    this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
                } else {
                    const payload = transfer
                        ? ENCODER.encodeTransfer({
                            propertyId: propIdForSale,
                            amount: amountForSale,
                            isColumnA: isA === 1,
                            destinationAddr: this.multySigChannelData.address
                        })
                        : ENCODER.encodeCommit({
                            propertyId: propIdForSale,
                            amount: amountForSale,
                            channelAddress: this.multySigChannelData.address
                        });

                    const commitTxRes = await this.txsService.buildSignSendTxGrabUTXO({
                        fromKeyPair: { address: this.myInfo.keypair.address },
                        toKeyPair: { address: this.multySigChannelData.address },
                        payload
                    });
                    if (commitTxRes.error || !commitTxRes.data?.rawtx) throw new Error(`Build Commit TX: ${commitTxRes.error}`);

                    const { rawtx } = commitTxRes.data;
                    const commitTxSignRes = await this.txsService.signRawTxWithWallet(rawtx);
                    if (commitTxSignRes.error || !commitTxSignRes.data?.signedHex) throw new Error(`Sign Commit TX: ${commitTxSignRes.error}`);

                    const signedHex = commitTxSignRes.data.signedHex;
                    const commitTxSendRes = await this.txsService.sendTx(signedHex);
                    if (commitTxSendRes.error || !commitTxSendRes.data) throw new Error(`Send Commit TX: ${commitTxSendRes.error}`);

                    const drtRes = await this.txsService.decode(rawtx);
                    const decodedData = typeof drtRes.data === 'string' ? JSON.parse(drtRes.data) : drtRes.data;
                    const vout = decodedData.vout.find((o: any) => o.scriptPubKey?.addresses?.[0] === this.multySigChannelData?.address);
                    if (!vout) throw new Error(`decoderawtransaction (2): output not found`);

                    const utxoData: IUTXO = {
                        amount: commitTxRes.commitUTXO?.amount
                          ? new BigNumber(commitTxRes.commitUTXO.amount).times(1e8).integerValue(BigNumber.ROUND_DOWN).toNumber(): 0,
                        vout: vout.n,
                        confirmations: 0,
                        txid: commitTxSendRes.data,
                        scriptPubKey: this.multySigChannelData.scriptPubKey,
                        redeemScript: this.multySigChannelData.redeemScript
                    };

                    const cpitLTCOptions = {
                        propertyId1: propIdForSale,
                        propertyId2: propIdDesired,
                        amountOffered1: amountForSale,
                        amountDesired2: amountDesired,
                        columnAIsOfferer: isA,
                        expiryBlock: bbData
                    };

                    const cpitRes = { data: ENCODER.encodeTradeTokensChannel(cpitLTCOptions), error: null };
                    if (cpitRes.error || !cpitRes.data) throw new Error(`tl_createpayload_instant_trade: ${cpitRes.error}`);

                    const buildOptions: IBuildTradeConfig = {
                        buyerKeyPair: this.myInfo.keypair,
                        sellerKeyPair: this.cpInfo.keypair,
                        commitUTXOs: [commitUTXO, utxoData],
                        payload: cpitRes.data,
                        amount: 0
                    };

                    const rawHexRes = await this.txsService.buildTradeTx(buildOptions);
                    if (rawHexRes.error || !rawHexRes.data?.psbtHex) throw new Error(`Build Trade: ${rawHexRes.error}`);

                    const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.data.psbtHex);
                    this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
                }
                throw new Error('SPOT trade logic not inserted yet.');
            }
        } catch (error: any) {
            console.log('step 3 err '+error)
            this.terminateTrade(`Step 3: ${error.message || 'Unknown Error'}`);
        }
    }

    private async onStep5(cpId: string, psbtHex: string) {
        this.logTime('Step 5 Start');
        const signRes = await this.txsService.signPsbt(psbtHex, false);
        if (!signRes.data?.finalHex) return this.terminateTrade('Step 5: Signing failed');

        const txidRes = await this.txsService.sendTxWithSpecRetry(signRes.data.finalHex);
        if (!txidRes?.data) return this.terminateTrade('Step 5: Broadcast failed');

        this.toastrService.info('Trade completed: ' + txidRes.data);
        if (this.readyRes) this.readyRes({ data: { txid: txidRes.data, seller: false, trade: this.tradeInfo } });

        const swapEvent = new SwapEvent('BUYER:STEP6', this.myInfo.socketId, txidRes.data);
        this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        this.removePreviuesListeners();
    }
}
