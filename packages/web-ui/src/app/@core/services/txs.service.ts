import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { BalanceService } from "./balance.service";
import { LoadingService } from "./loading.service";
import { RpcService, TNETWORK } from "./rpc.service";
import * as bitcoin from './bitcoinjs-lib'; // Assuming bitcoinjs-lib is available

export interface IUTXO {
    amount: number;
    confirmations: number;
    scriptPubKey: string;
    redeemScript?: string;
    txid: string;
    vout: number;
};

export interface ISignTxConfig {
    rawtx: string;
    wif: string;
    inputs: IUTXO[];
}

export interface ISignPsbtConfig {
    wif: string;
    psbtHex: string;
}

export interface IBuildTxConfig {
    fromKeyPair: {
        address: string;
        pubkey?: string;
    },
    toKeyPair: {
        address: string;
        pubkey?: string;
    },
    inputs?: IUTXO[];
    amount?: number;
    payload?: string;
    addPsbt?: boolean;
    network?: TNETWORK;
}

export interface IBuildLTCITTxConfig {
    buyerKeyPair: {
        address: string;
        pubkey?: string;
    };
    sellerKeyPair: {
        address: string;
        pubkey?: string;
    };
    amount: number;
    payload: string;
    commitUTXOs: IUTXO[],
    network?: TNETWORK;
}

@Injectable({
    providedIn: 'root',
})

export class TxsService {
    constructor(
        private rpcService: RpcService,
        private apiService: ApiService,
        private authService: AuthService,
        private loadingService: LoadingService,
        private toastrService: ToastrService,
        private balanceService: BalanceService,
    ) { }

    get rpc() {
        return this.rpcService.rpc.bind(this);
    }

    get mainApi() {
        return this.apiService.mainApi;
    }

    get tlApi() {
        return this.apiService.tlApi;
    }

    async getWifByAddress(address: string) {
        return this.rpcService.rpc('dumpprivkey', [address]);
    }

    async buildLTCITTx(
        buildTxConfig: IBuildLTCITTxConfig,
    ): Promise<{ data?: { rawtx: string; inputs: IUTXO[], psbtHex?: string }, error?: string }> {
        try {
            const network = this.rpcService.NETWORK;
            buildTxConfig.network = network;
            const isApiMode = this.rpcService.isApiMode;
            let result = await this.mainApi.buildLTCITTx(buildTxConfig, isApiMode).toPromise();
            return result;
        } catch (error: any) {
            return { error: error.message }
        }
    }

   /*async buildTx(
        buildTxConfig: IBuildTxConfig
    ): Promise<{ data?: { rawtx: string; inputs: IUTXO[], psbtHex?: string }, error?: string }> {
        try {
            console.log('Inputs in build:', JSON.stringify(buildTxConfig));
            if (!buildTxConfig.inputs || buildTxConfig.inputs.length === 0) {
                console.log('error: No inputs available for building the transaction. Please ensure your address has UTXOs.');
            }

            const network = this.rpcService.NETWORK;
            buildTxConfig.network = network;
            const isApiMode = this.rpcService.isApiMode;
            let result = await this.mainApi.buildTx(buildTxConfig, isApiMode).toPromise();
            return result;
        } catch (error: any) {
            return { error: error.message || 'An unexpected error occurred while building the transaction.' }
        }
    }*/

async buildSignSendTx(
    buildTxConfig: IBuildTxConfig,
): Promise<{ data?: string, error?: string }> {
    try {
        this.loadingService.isLoading = true;
          console.log('Inputs in build:', JSON.stringify(buildTxConfig));
        // Fetch UTXOs for the sender's address
        const { fromKeyPair } = buildTxConfig;
        const { data: utxos } = await axios.post(`api.layerwallet.com/address/utxo/${fromKeyPair.address}`);
        if (!utxos || utxos.length === 0) {
            return { error: 'No UTXOs available for the specified address.' };
        }

        // Select UTXOs (use largest first)
        const selectedUTXO = utxos.reduce((prev, current) => (prev.amount > current.amount ? prev : current), utxos[0]);

        // Define Litecoin network
        const network = this.rpcService.NETWORK === 'mainnet' ? {
            messagePrefix: '\x19Litecoin Signed Message:\n',
            bech32: 'ltc',
            bip32: { public: 0x019da462, private: 0x019d9cfe },
            pubKeyHash: 0x30,
            scriptHash: 0x32,
            wif: 0xb0,
        } : {
            messagePrefix: '\x19Litecoin Signed Message:\n',
            bech32: 'tltc',
            bip32: { public: 0x043587cf, private: 0x04358394 },
            pubKeyHash: 0x6f,
            scriptHash: 0x3a,
            wif: 0xef,
        };

        // Build the transaction using bitcoinjs-lib
        const txb = new bitcoin.TransactionBuilder(network);

        // Add input (UTXO)
        txb.addInput(selectedUTXO.txid, selectedUTXO.vout);

        // Add output (destination address and amount)
        const amountInSatoshis = Math.round(buildTxConfig.amount * 1e8); // Convert amount to satoshis
        txb.addOutput(buildTxConfig.toKeyPair.address, amountInSatoshis);

        // Add change output (if applicable)
        const fee = 5000; // Approximate fee in satoshis
        const change = Math.round(selectedUTXO.amount * 1e8) - amountInSatoshis - fee;
        if (change > 0) {
            txb.addOutput(fromKeyPair.address, change);
        }

        // Get the raw transaction hex
        const rawTx = txb.buildIncomplete().toHex();

        // Pass raw transaction to the wallet extension for signing
        const signRes = await window.myWallet.sendRequest('signTransaction', { transaction: rawTx });

        if (!signRes || !signRes.success) {
            return { error: signRes.error || 'Failed to sign the transaction.' };
        }

        // Broadcast the signed transaction
        const sendRes = await this.sendTx(signRes.signedTransaction);
        if (sendRes.error || !sendRes.data) {
            return { error: sendRes.error || 'Failed to broadcast the transaction.' };
        }

        return { data: sendRes.data };
    } catch (error: any) {
        console.error('Error during transaction creation:', error.message);
        this.toastrService.error(error.message);
        return { error: error.message };
    } finally {
        this.loadingService.isLoading = false;
    }
}

    async signTx(signTxConfig: ISignTxConfig): Promise<{
        data?: {
            isValid: boolean,
            signedHex?: string,
            psbtHex?: string,
        },
        error?: string,
    }> {
        try {
            const network = this.rpcService.NETWORK;
            const result = await this.mainApi.signTx(signTxConfig, network).toPromise();
            return result;
        } catch (error: any) {
            return { error: error.message }
        }
    }

    async signRawTxWithWallet(txHex: string): Promise<{
        data: { isValid: boolean, signedHex?: string },
        error?: string
    }> {
        const result = await this.rpcService.rpc('signrawtransactionwithwallet', [txHex]);
        const data = { isValid: result.data.complete, signedHex: result.data.hex }
        return { data };
    }

    async signPsbt(signPsbtConfig: ISignPsbtConfig): Promise<{
        data?: {
            psbtHex: string;
            isValid: boolean;
            isFinished: boolean;
            finalHex?: string;
        },
        error?: string,
    }> {
        try {
            const network = this.rpcService.NETWORK;
            const result = await this.mainApi.signPsbt(signPsbtConfig, network).toPromise();
            return result
        } catch (error: any) {
            return { error: error.message }
        }
    }

    async sendTx(rawTx: string) {
        const result = await this.rpcService.rpc('sendrawtransaction', [rawTx]);
        //if(typeof this.balanceService.updateBalances==='function'){ 
        //console.log('checking balance service obj ' +JSON.stringify(this.balanceService)); // Check if balanceService is available
        
        
        //this.balanceService.updateBalances();
        //}else{
        // console.log('update balances not found on balanceService')
        //}
        return result;
    }

    async getChannel(address: string) {
        const channelRes = await this.tlApi.rpc('getChannel', [address]).toPromise();  // Pass address as an array
        console.log('channel fetch in tx service ' + JSON.stringify(channelRes))
        if (!channelRes.data || channelRes.error) return { data: [] };

        return channelRes.data;
    }


    async checkMempool(txid: string) {
        try {
            const mempool = await this.rpcService.rpc('getrawmempool', []);
            const isInMempool = mempool.data.includes(txid);


            return isInMempool;
        } catch (error) {
            console.error('Error checking mempool:', error);
            return false;
        }
    }

    async predictColumn(channel: string, cpAddress: string) {
        try {
            const column = await this.tlApi.rpc('getChannelColumn', [channel, cpAddress]).toPromise();  // Pass parameters as an array
            console.log('column prediction fetch in tx service ' + JSON.stringify(column))

            return column.data;
        } catch (error) {
            console.error('Error checking column:', error);
            return false;
        }
    }


    async sendTxWithSpecRetry(rawTx: string) {
        const _sendTxWithRetry = async (rawTx: string, retriesLeft: number, ms: number): Promise<{
            data?: string,
            error?: string,
        }> => {
            const result = await this.rpcService.rpc('sendrawtransaction', [rawTx]);
            if (result.error && result.error.includes('bad-txns-inputs-missingorspent') && retriesLeft > 0) {
                await new Promise(resolve => setTimeout(resolve, ms));
                return _sendTxWithRetry(rawTx, retriesLeft - 1, ms);
            }
            return result;
        }
        return _sendTxWithRetry(rawTx, 15, 800);
    }
}

  