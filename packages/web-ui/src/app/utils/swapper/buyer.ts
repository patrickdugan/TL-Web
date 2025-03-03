import { Socket as SocketClient } from 'socket.io-client';
import { IBuildLTCITTxConfig, IBuildTxConfig, IBuildTradeConfig, IUTXO, TxsService } from "src/app/@core/services/txs.service";
import { IMSChannelData, SwapEvent, IBuyerSellerInfo, TClient, IFuturesTradeProps, ISpotTradeProps, ETradeType } from "./common";
import { Swap } from "./swap";
import { ENCODER } from '../payloads/encoder';
import { ToastrService } from "ngx-toastr";
import { WalletService } from 'src/app/@core/services/wallet.service';
import axios from 'axios';

export class BuySwapper extends Swap {
    private tradeStartTime: number; // Add this declaration for tradeStartTime
    constructor(
        typeTrade: ETradeType,
        tradeInfo: ISpotTradeProps,//IFuturesTradeProps |, 
        buyerInfo: IBuyerSellerInfo,
        sellerInfo: IBuyerSellerInfo,
        socket: SocketClient,
        txsService: TxsService,
        private toastrService: ToastrService,
        private walletService: WalletService
    ) {
        super(typeTrade, tradeInfo, buyerInfo, sellerInfo, socket, txsService);
        this.handleOnEvents();
        this.tradeStartTime = Date.now(); // Start time of the trade
        this.onReady();
    }

    private logTime(stage: string) {
        const currentTime = Date.now();
        console.log(`Time taken for ${stage}: ${currentTime - this.tradeStartTime} ms`);
    }

    private handleOnEvents() {
        this.removePreviuesListeners();
        const _eventName = `${this.cpInfo.socketId}::swap`;
        this.socket.on(_eventName, (eventData: SwapEvent) => {
            const { socketId, data } = eventData;
            this.eventSubs$.next(eventData);
            switch (eventData.eventName) {
                case 'TERMINATE_TRADE':
                    this.onTerminateTrade.bind(this)(socketId, data);
                    break;
                case 'SELLER:STEP1':
                    this.onStep1.bind(this)(socketId, data);
                    break;
                case 'SELLER:STEP3':
                    this.onStep3.bind(this)(socketId, data);
                    break;
                case 'SELLER:STEP5':
                    this.onStep5.bind(this)(socketId, data);
                    break;
                default:
                    break;
            }
        });
    }

    private async onStep1(cpId: string, msData: IMSChannelData) {
        try {
            if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);
            let pubKeys = [this.cpInfo.keypair.pubkey, this.myInfo.keypair.pubkey];
        if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
            let { propIdDesired, propIdForSale} = this.tradeInfo
            if(propIdDesired==0||propIdForSale==0){
                pubKeys = [this.myInfo.keypair.pubkey,this.cpInfo.keypair.pubkey]
            }
        }
        
            let amaRes = await this.walletService.addMultisig(2, pubKeys)
            if(!amaRes||amaRes==undefined){
                amaRes = await this.walletService.addMultisig(2, pubKeys)
            }
            console.log('adding multisig from wallet '+JSON.stringify(amaRes))
            console.log('matching redeem keys '+amaRes.redeemScript + ' '+msData.redeemScript)
                if (amaRes.redeemScript !== msData.redeemScript) throw new Error(`redeemScript of Multysig is not matching`);
            
            this.multySigChannelData = msData;
            const swapEvent = new SwapEvent('BUYER:STEP2', this.myInfo.socketId);
            console.log('swap event in step 1 '+swapEvent)
            this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        } catch (error: any) {
            const errorMessge = error.message || 'Undefined Error';
            this.terminateTrade(`Step 1: ${errorMessge}`);
        }
    }

       private async onStep3(cpId: string, commitUTXO: IUTXO) {
            this.logTime('Step 3 Start');
        try {
            if (cpId !== this.cpInfo.socketId) throw new Error(`Error with p2p connection`);
            if (!this.multySigChannelData) throw new Error(`Wrong Multisig Data Provided`);

            const gbcRes = await this.txsService.getChainInfo();
            let chainInfo;

            if (typeof gbcRes === 'string') {
                // Parse the string response
                chainInfo = JSON.parse(gbcRes);
            } else if (typeof gbcRes === 'object' && gbcRes.data) {
                // Handle Axios-style response with `data`
                chainInfo = gbcRes.data;
            } else {
                throw new Error('Unexpected response structure');
            }

            if (typeof chainInfo.blocks === 'undefined') {
                throw new Error('Unexpected response: blocks not found');
            }

            console.log('chain info call in step 3', chainInfo);
            const bbData = parseFloat(chainInfo.blocks) + 10;
            console.log('examing this.tradeInfo object '+JSON.stringify(this.tradeInfo))
            // Preserve the ctcpParams logic based on trade type
            if (this.typeTrade === ETradeType.SPOT && 'propIdDesired' in this.tradeInfo) {
                let { propIdDesired, amountDesired, amountForSale, propIdForSale, transfer } = this.tradeInfo
                
                const column = await this.txsService.predictColumn(this.myInfo.keypair.address, this.cpInfo.keypair.address);
                        let isA = column === 'A' ? 1 : 0;

                //let { transfer } = this.tradeInfo as ITradeInfo<ISpotTradeProps>;
                console.log('importing transfer '+transfer)
                if (transfer == undefined) {
                    transfer=false
                }

                let ltcTrade = false;
                let ltcForSale = false;
                if (propIdDesired === 0) {
                    ltcTrade = true;
                } else if (propIdForSale === 0) {
                    ltcTrade = true;
                    ltcForSale = false;
                }

                // Handle Litecoin-based trades
                if (ltcTrade === true) {
                        const cpitLTCOptions = [propIdDesired, amountDesired.toString(), amountForSale.toString(), bbData];
                        let tokenId = ltcForSale ? propIdForSale : propIdDesired;
                        let tokensSold = ltcForSale ? amountForSale : amountDesired;
                        let satsPaid = ltcForSale ? amountDesired : amountForSale;

                    const payload = ENCODER.encodeTradeTokenForUTXO({
                        propertyId: tokenId,
                        amount: tokensSold,
                        columnA: isA === 1,
                        satsExpected: satsPaid,
                        tokenOutput: 1,
                        payToAddress: 0
                    });

                    console.log('ltc trade payload '+JSON.stringify(payload))
                    const buildOptions: IBuildLTCITTxConfig = {
                        buyerKeyPair: this.myInfo.keypair,
                        sellerKeyPair: this.cpInfo.keypair,
                        commitUTXOs: [commitUTXO],
                        payload: payload,
                        amount: satsPaid,
                    };
                    console.log('build config before querying for LTC tx build '+JSON.stringify(buildOptions))
                    const rawHexRes = await this.txsService.buildLTCITTx(buildOptions,satsPaid);

                    console.log('build ltc trade in step 3 '+JSON.stringify(rawHexRes))
                    if (rawHexRes.error || !rawHexRes.data?.psbtHex) throw new Error(`Build Trade: ${rawHexRes.error}`);
                    const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.data?.psbtHex);
                    this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
                } else {
                    let payload;
                    /*if (transfer) {
                        payload = ENCODER.encodeTransfer({
                            propertyId: propIdForSale,
                            amount: amountForSale,
                            columnA: isA? 1:0,  // Assume Column A, adjust based on context
                            destinationAddr: this.multySigChannelData.address,
                        });
                    } else{*/
                        payload = ENCODER.encodeCommit({
                            amount: amountForSale,
                            propertyId: propIdForSale,
                            channelAddress: this.multySigChannelData.address,
                        });
                    //}

                    const commitTxConfig: IBuildTxConfig = {
                        fromKeyPair: { address: this.myInfo.keypair.address },
                        toKeyPair: { address: this.multySigChannelData.address },
                        payload: payload
                    };

                    const commitTxRes = await this.txsService.buildTx(commitTxConfig);
                    if (commitTxRes.error || !commitTxRes.data) throw new Error(`Build Commit TX: ${commitTxRes.error}`);

                      const { rawtx } = commitTxRes.data;
                        const commitTxSignRes = await this.txsService.signRawTxWithWallet(rawtx);
                        if (commitTxSignRes.error || !commitTxSignRes.data) throw new Error(`Sign Commit TX: ${commitTxSignRes.error}`);

                        const signedHex = commitTxSignRes.data?.signedHex;
                        if (!signedHex) throw new Error(`Failed to sign transaction`);

                        const commitTxSendRes = await this.txsService.sendTx(signedHex);
                        if (commitTxSendRes.error || !commitTxSendRes.data) throw new Error(`Failed to send transaction`);

                        // Handle UTXO creation for the next step
                        const drtRes = await this.txsService.decode(rawtx);

                        // Parse the raw JSON string into an object
                        const decodedData = typeof drtRes.data === 'string' ? JSON.parse(drtRes.data) : drtRes.data;

                        if (!decodedData?.vout) {
                          throw new Error(`decoderawtransaction failed`);
                        }

                        const vout = decodedData.vout.find(
                          (o: any) => o.scriptPubKey?.addresses?.[0] === this.multySigChannelData?.address
                        );

                        if (!vout) {
                          throw new Error(`decoderawtransaction (2) failed`);
                        }

                        const utxoData = {
                            amount: vout.value,
                            vout: vout.n,
                            txid: commitTxSendRes.data,
                            scriptPubKey: this.multySigChannelData.scriptPubKey,
                            redeemScript: this.multySigChannelData.redeemScript,
                        } as IUTXO;

                        const cpitLTCOptions = {
                            propertyId1: propIdForSale,
                            propertyId2: propIdDesired,
                            amountOffered1: amountForSale,
                            amountDesired2: amountDesired,
                            columnAIsOfferer: isA,
                            expiryBlock: bbData,
                        }
                        const cpitRes = { data: ENCODER.encodeTradeTokensChannel(cpitLTCOptions), error: null };
                        if (cpitRes.error || !cpitRes.data) throw new Error(`tl_createpayload_instant_trade: ${cpitRes.error}`);
                        const buildOptions: IBuildTradeConfig = {
                            buyerKeyPair: this.myInfo.keypair,
                            sellerKeyPair: this.cpInfo.keypair,
                            commitUTXOs: [commitUTXO, utxoData],
                            payload: cpitRes.data,
                            amount: 0,
                        };
                        const rawHexRes = await this.txsService.buildTradeTx(buildOptions);
                        if (rawHexRes.error || !rawHexRes.data?.psbtHex) throw new Error(`Build Trade: ${rawHexRes.error}`);

                        const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.data.psbtHex);
                        this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
                }

            } else if (this.typeTrade === ETradeType.FUTURES && 'contract_id' in this.tradeInfo) {
                throw new Error(`Futures is not supported for now`);

                // Preserved commented-out code related to futures
                
                        // The following is the commented-out block related to futures that is preserved as is
                        /*
                        // const { contract_id, amount, price, } = this.tradeInfo;
                        // const ctcpParams = [contract_id, (amount).toString()];
                        // const cpctcRes = await this.client('tl_createpayload_commit_tochannel', ctcpParams);
                        // if (cpctcRes.error || !cpctcRes.data) throw new Error(`tl_createpayload_commit_tochannel: ${cpctcRes.error}`);
                        
                        // const fromKeyPair = { address: this.myInfo.keypair.address };
                        // const toKeyPair = { address: this.multySigChannelData.address };
                        // const payload = cpctcRes.data;
                        // const commitTxConfig: IBuildTxConfig = { fromKeyPair, toKeyPair, payload };
                
                        // // build Commit Tx
                        // const commitTxRes = await this.txsService.buildTx(commitTxConfig);
                        // if (commitTxRes.error || !commitTxRes.data) throw new Error(`Build Commit TX: ${commitTxRes.error}`);
                        // const { inputs, rawtx } = commitTxRes.data;
                        // const wif = this.txsService.getWifByAddress(this.myInfo.keypair.address);
                        // if (!wif) throw new Error(`WIF not found: ${this.myInfo.keypair.address}`);
                        
                        // // sign Commit Tx
                        // const cimmitTxSignRes = await this.txsService.signTx({ rawtx, inputs, wif });
                        // if (cimmitTxSignRes.error || !cimmitTxSignRes.data) throw new Error(`Sign Commit TX: ${cimmitTxSignRes.error}`);
                        // const { isValid, signedHex } = cimmitTxSignRes.data;
                        // if (!isValid || !signedHex) throw new Error(`Sign Commit TX (2): ${cimmitTxSignRes.error}`);

                        // // send Commit Tx
                        // const commiTxSendRes = await this.txsService.sendTx(signedHex);
                        // if (commiTxSendRes.error || !commiTxSendRes.data) throw new Error(`Send Commit TX: ${commiTxSendRes.error}`);

                        // //
                        // const drtRes = await this.client("decoderawtransaction", [rawtx]);
                        // if (drtRes.error || !drtRes.data?.vout) throw new Error(`decoderawtransaction: ${drtRes.error}`);
                        // const vout = drtRes.data.vout.find((o: any) => o.scriptPubKey?.addresses?.[0] === this.multySigChannelData?.address);
                        // if (!vout) throw new Error(`decoderawtransaction (2): ${drtRes.error}`);
                        // const utxoData = {
                        //     amount: vout.value,
                        //     vout: vout.n,
                        //     txid: commiTxSendRes.data,
                        //     scriptPubKey: this.multySigChannelData.scriptPubKey,
                        //     redeemScript: this.multySigChannelData.redeemScript,
                        // } as IUTXO;
                        // // contractid, amount, height, price, action(buy), leverage
                        // const cpcitOptions = [ contract_id, (amount).toString(), bbData, (price).toString(), 1, "1" ];
                        // const cpcitRes = await this.client('tl_createpayload_contract_instant_trade', cpcitOptions);
                        // if (cpcitRes.error || !cpcitRes.data) throw new Error(`tl_createpayload_contract_instant_trade: ${cpcitRes.error}`);
                        // const buildOptions: IBuildLTCITTxConfig = {
                        //     buyerKeyPair: this.myInfo.keypair,
                        //     sellerKeyPair: this.cpInfo.keypair,
                        //     commitUTXOs: [commitUTXO, utxoData],
                        //     payload: cpcitRes.data,
                        //     amount: 0,
                        // };
                        // const rawHexRes = await this.txsService.buildLTCITTx(buildOptions);
                        // if (rawHexRes.error || !rawHexRes.data?.psbtHex) throw new Error(`Build Trade: ${rawHexRes.error}`);
                        // const swapEvent = new SwapEvent('BUYER:STEP4', this.myInfo.socketId, rawHexRes.data.psbtHex);
                        // this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
                        */
            } else {
                throw new Error(`Unrecognized Trade Type: ${this.typeTrade}`);
            }
        } catch (error: any) {
            const errorMessage = error.message || 'Undefined Error';
            this.terminateTrade(`Step 3: ${errorMessage}`);
        }
    }

    private async onStep5(cpId: string, psbtHex: string) {
        this.logTime('Step 5 Start');
        if (cpId !== this.cpInfo.socketId) return this.terminateTrade('Step 5: Error with p2p connection: code 4');
        if (!psbtHex) return this.terminateTrade('Step 5: PsbtHex Not Provided');
        
        
        const signRes = await this.txsService.signPsbt(psbtHex,false);
        console.log('sign res in step 5 '+JSON.stringify(signRes))
        if (!signRes.data?.finalHex) return this.terminateTrade(`Step 5: Transaction not Fully Synced`);
         const currentTime = Date.now();
        // Notify user that signing is done and the process will wait for UTXOs to appear in mempool
        this.toastrService.info(`Signed! ${currentTime - this.tradeStartTime} ms`);

        const maxAttempts = 100;  // Maximum number of checks before timeout
        const delayBetweenChecks = 1000;  // 1 seconds delay between checks
        let attempts = 0;
        let isInMempool = false;
        await new Promise(resolve => setTimeout(resolve, delayBetweenChecks));
        

        //if (!isInMempool) return this.terminateTrade('Step 5: UTXOs not found in mempool after multiple attempts.');

        const finalTxIdRes = await this.txsService.sendTxWithSpecRetry(signRes.data.finalHex);
        console.log('send result '+JSON.stringify(finalTxIdRes))
        if (finalTxIdRes?.error || !finalTxIdRes?.data) return this.terminateTrade(`Step 5: sendRawTransaction: ${finalTxIdRes.error}` || `Error with sending Raw Tx`);
        
        if (this.readyRes) this.readyRes({ data: { txid: finalTxIdRes.data, seller: false, trade: this.tradeInfo } });
                
        const swapEvent = new SwapEvent('BUYER:STEP6', this.myInfo.socketId, finalTxIdRes.data);

        this.toastrService.info('Trade completed: '+finalTxIdRes.data);

        this.socket.emit(`${this.myInfo.socketId}::swap`, swapEvent);
        
        this.removePreviuesListeners();
    }

}
