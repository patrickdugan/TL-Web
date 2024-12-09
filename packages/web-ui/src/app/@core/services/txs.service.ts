import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { BalanceService } from "./balance.service";
import { LoadingService } from "./loading.service";
import { RpcService, TNETWORK } from "./rpc.service";

export interface IUTXO {
    amount: number;
    confirmations: number;
    scriptPubKey: string;
    redeemScript?: string;
    txid: string;
    vout: number;
}

interface IInput {
  txid: string;
  amount: number;
  confirmations: number;
  scriptPubKey: string;
  vout: number;
  redeemScript?: string;
  pubkey?: string;
}

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
    };
    toKeyPair: {
        address: string;
        pubkey?: string;
    };
    inputs?: IUTXO[];
    amount?: number;
    payload?: string;
    addPsbt?: boolean;
    network?: string; // Update to match mainAPI
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
    commitUTXOs: IUTXO[];
    network?: string; // Update to match mainAPI
}


@Injectable({
    providedIn: "root",
})
export class TxsService {
    constructor(
        private rpcService: RpcService,
        private apiService: ApiService,
        private authService: AuthService,
        private loadingService: LoadingService,
        private toastrService: ToastrService,
        private balanceService: BalanceService
    ) {}

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
        return this.rpcService.rpc("dumpprivkey", [address]);
    }

   async buildLTCITTx(
    buildTxConfig: IBuildLTCITTxConfig
): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
        // Ensure `network` is assigned and is a string
        const network = this.rpcService.NETWORK || "LTCTEST"; // Default to "LTCTEST" if undefined
        buildTxConfig.network = network; // Assign a valid string

        // Local function to convert IUTXO to IInput
        const convertUTXOToInput = (utxo: IUTXO): IInput => {
            return {
                ...utxo,
                pubkey: undefined, // Add the optional `pubkey` field
            };
        };

        // Convert `commitUTXOs` from `IUTXO[]` to `IInput[]`
        const commitUTXOsAsIInput: IInput[] = buildTxConfig.commitUTXOs.map(convertUTXOToInput);

        // Ensure `network` is explicitly assigned before passing to `mainApi`
        const result = await this.mainApi.buildLTCITTx(
            {
                ...buildTxConfig,
                commitUTXOs: commitUTXOsAsIInput,
                network: network as string, // Explicitly pass network as string
            },
            this.rpcService.isApiMode
        );

        return result;
    } catch (error: any) {
        return { error: error.message || "An error occurred while building LTCITTx." };
    }
}



    async buildTx(
        buildTxConfig: IBuildTxConfig
    ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
        try {
            console.log("Inputs in build:", JSON.stringify(buildTxConfig));

            if (!buildTxConfig.inputs || buildTxConfig.inputs.length === 0) {
                console.error("Error: No inputs available for building the transaction.");
                throw new Error("No inputs available for building the transaction.");
            }

            // Convert IUTXO[] to IInput[]
            const inputsAsIInput: IInput[] = buildTxConfig.inputs.map(utxo => ({
                ...utxo,
                pubkey: undefined, // Add pubkey as undefined for compatibility
            }));

            // Create a new buildTxConfig object with converted inputs
            const buildTxConfigForApi = {
                ...buildTxConfig,
                inputs: inputsAsIInput, // Use converted inputs
            };

            // Ensure `network` is assigned and is a string
            const network = this.rpcService.NETWORK || "LTCTEST"; // Default to "LTCTEST" if undefined
            buildTxConfigForApi.network = network; // Assign a valid string

            const isApiMode = this.rpcService.isApiMode;
            const result = await this.mainApi.buildTx(buildTxConfigForApi, isApiMode);

            // Return the original inputs (IUTXO[]) along with the result
            return {
                data: {
                    ...result.data,
                    inputs: buildTxConfig.inputs, // Return the original inputs
                },
            };
        } catch (error: any) {
            return { error: error.message || "An unexpected error occurred while building the transaction." };
        }
    }

    async buildSignSendTx(buildTxConfig: IBuildTxConfig): Promise<{ data?: string; error?: string }> {
        try {
            this.loadingService.isLoading = true;

            const buildRes = await this.buildTx(buildTxConfig);
            if (buildRes.error || !buildRes.data) {
                return { error: buildRes.error || "Failed to build the transaction." };
            }

            const { rawtx } = buildRes.data;
            const signRes = await this.signRawTxWithWallet(rawtx);

            if (signRes.error || !signRes.data) {
                return { error: signRes.error || "Failed to sign the transaction." };
            }

            const { signedHex } = signRes.data;
           const sendRes = signedHex
            ? await this.sendTx(signedHex)
            : { error: "Signed hex is undefined. Cannot send transaction." };


            if (sendRes.error || !sendRes.data) {
                return { error: sendRes.error || "Failed to broadcast the transaction." };
            }

            return { data: sendRes.data };
        } catch (error: any) {
            this.toastrService.error(error.message);
            return { error: error.message };
        } finally {
            this.loadingService.isLoading = false;
        }
    }

    async signRawTxWithWallet(txHex: string): Promise<{ data: { isValid: boolean; signedHex?: string }; error?: string }> {
        const result = await this.rpcService.rpc("signrawtransactionwithwallet", [txHex]);
        const data = { isValid: result.data.complete, signedHex: result.data.hex };
        return { data };
    }

    async sendTx(rawTx: string) {
        if (!rawTx) {
            throw new Error("rawTx is undefined");
        }
        const result = await this.rpcService.rpc('sendrawtransaction', [rawTx]);
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
            const mempool = await this.rpcService.rpc("getrawmempool", []);
            return mempool.data.includes(txid);
        } catch (error) {
            console.error("Error checking mempool:", error);
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
        const _sendTxWithRetry = async (rawTx: string, retriesLeft: number, ms: number): Promise<{ data?: string; error?: string }> => {
            const result = await this.rpcService.rpc("sendrawtransaction", [rawTx]);
            if (result.error && result.error.includes("bad-txns-inputs-missingorspent") && retriesLeft > 0) {
                await new Promise(resolve => setTimeout(resolve, ms));
                return _sendTxWithRetry(rawTx, retriesLeft - 1, ms);
            }
            return result;
        };
        return _sendTxWithRetry(rawTx, 15, 800);
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
            const result = {data: {psbtHex: '', isValid: false, isFinished: false, finalHex:''}} //await this.mainApi.signPsbt(signPsbtConfig, network).toPromise();
            return result
        } catch (error: any) {
            return { error: error.message }
        }
    }
}
