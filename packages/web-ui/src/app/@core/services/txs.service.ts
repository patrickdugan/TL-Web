import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { BalanceService } from "./balance.service";
import { LoadingService } from "./loading.service";
import { RpcService, TNETWORK } from "./rpc.service";
import axios from "axios";

export interface IUTXO {
  amount: number;
  confirmations: number;
  scriptPubKey: string;
  redeemScript?: string;
  txid: string;
  vout: number;
}

export interface ISignTxConfig {
  rawtx: string;
  wif: string;
  inputs: IUTXO[];
}

export interface ISignPsbtConfig {
  psbtHex: string;
  redeem?: string;
  network?: string;
  wif?: string;
}

export interface IBuildTxConfig {
  fromKeyPair: { address: string; pubkey?: string };
  toKeyPair: { address: string; pubkey?: string };
  inputs?: IUTXO[];
  amount?: number;
  payload?: string;
  addPsbt?: boolean;
  network?: TNETWORK;
}

export interface IBuildTradeConfig {
  buyerKeyPair: { address: string; pubkey?: string };
  sellerKeyPair: { address: string; pubkey?: string };
  commitUTXOs?: IUTXO[];
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
  inputs?: IUTXO[];
  commitUTXOs: IUTXO[];
}


@Injectable({
  providedIn: "root",
})
export class TxsService {
  private baseUrl = "https://api.layerwallet.com";

  constructor(
    private rpcService: RpcService,
    private apiService: ApiService,
    private authService: AuthService,
    private loadingService: LoadingService,
    private toastrService: ToastrService,
    private balanceService: BalanceService
  ) {}

  async buildTx(
    buildTxConfig: IBuildTxConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tx/buildTx`, { params: buildTxConfig });
      return response.data;
    } catch (error: any) {
      console.error("Error in buildTx:", error.message);
      return { error: error.message };
    }
  }

  async buildTradeTx(
    tradeConfig: IBuildTradeConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tx/buildTradeTx`, { params: tradeConfig });
      return response.data;
    } catch (error: any) {
      console.error("Error in buildTradeTx:", error.message);
      return { error: error.message };
    }
  }

  async buildLTCITTx(
    buildLTCITTxConfig: IBuildLTCITTxConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tx/buildLTCITTx`, { params: buildLTCITTxConfig });
      return response.data;
    } catch (error: any) {
      console.error("Error in buildLTCITTx:", error.message);
      return { error: error.message };
    }
  }

  async signRawTxWithWallet(
    txHex: string
  ): Promise<{ data: { isValid: boolean; signedHex?: string }; error?: string }> {
    try {
      const result = await this.rpcService.rpc("signrawtransactionwithwallet", [txHex]);
      return {
        data: { isValid: result.data.complete, signedHex: result.data.hex },
      };
    } catch (error: any) {
      console.error("Error in signRawTxWithWallet:", error.message);
      return {
        data: { isValid: false },
        error: error.message,
      };
    }
  }

  async checkMempool(txid: string): Promise<boolean> {
    try {
      const mempool = await this.rpcService.rpc("getrawmempool", []);
      return mempool.data.includes(txid);
    } catch (error: any) {
      console.error("Error checking mempool:", error.message);
      return false;
    }
  }

  async buildSignSendTx(
    buildTxConfig: IBuildTxConfig
  ): Promise<{ data?: string; error?: string }> {
    try {
      this.loadingService.isLoading = true;

      // Sign transaction using wallet
      const signResponse = await window.myWallet?.sendRequest("signTransaction", { transaction: buildTxConfig });
      if (!signResponse || !signResponse.success) {
        return { error: signResponse?.error || "Failed to sign transaction." };
      }
      console.log('sign response '+JSON.stringify(signResponse))
      const signedTx = signResponse.data;

      // Broadcast signed transaction
      const sendResponse = await this.sendTx(signedTx);
      if (sendResponse.error) {
        throw new Error(sendResponse.error);
      }

      return { data: sendResponse.data }; // Transaction ID
    } catch (error: any) {
      console.error("Error in buildSignSendTx:", error.message);
      return { error: error.message };
    } finally {
      this.loadingService.isLoading = false;
    }
  }

  async signPsbt(signPsbtConfig: ISignPsbtConfig): Promise<{
    data?: {
      psbtHex: string;
      isValid: boolean;
      isFinished: boolean;
      finalHex?: string;
    };
    error?: string;
  }> {
    try {
      if (!window.myWallet || typeof window.myWallet.sendRequest !== "function") {
        throw new Error("Wallet extension not available for signing PSBT.");
      }

      const response = await window.myWallet.sendRequest("signPsbt", {
        psbtHex: signPsbtConfig.psbtHex,
        redeemKey: signPsbtConfig.redeem,
        network: signPsbtConfig.network,
      });

      if (!response || !response.success) {
        return { error: response?.error || "Failed to sign PSBT." };
      }

      return {
        data: {
          psbtHex: response.data.psbtHex,
          isValid: response.data.isValid,
          isFinished: response.data.isFinished,
          finalHex: response.data.finalHex,
        },
      };
    } catch (error: any) {
      console.error("Error signing PSBT:", error.message);
      return { error: error.message };
    }
  }

  async sendTx(rawTx: string): Promise<{ data?: string; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/rpc/sendrawtransaction`, {
        params: [rawTx],
      });

      if (response.data.error) {
        return { error: response.data.error };
      }

      return { data: response.data.result }; // Transaction ID
    } catch (error: any) {
      console.error("Error broadcasting transaction:", error.message);
      return { error: error.message };
    }
  }

    async predictColumn(channel: string, cpAddress: string) {
      try {
        const response = await axios.post(`${this.baseUrl}/rpc/tl_getChannelColumn`, { params: [channel, cpAddress] });
        return response.data;
      } catch (error: any) {
        console.error('Error in predictColumn:', error.message);
        return false;
      }
    }

    async getWifByAddress(address: string) {
      try {
        const result = await this.rpcService.rpc('dumpprivkey', [address]);
        return result.data;
      } catch (error: any) {
        console.error('Error in getWifByAddress:', error.message);
        throw new Error(error.message);
      }
    }

    async sendTxWithSpecRetry(rawTx: string): Promise<{ data?: string; error?: string }> {
      const _sendTxWithRetry = async (
        rawTx: string,
        retriesLeft: number,
        ms: number
      ): Promise<{ data?: string; error?: string }> => {
        try {
          const result = await axios.post(`${this.baseUrl}/tx/sendrawtransaction`, { params: [rawTx] });
          return result.data;
        } catch (error: any) {
          if (retriesLeft > 0 && error.message.includes('bad-txns-inputs-missingorspent')) {
            await new Promise((resolve) => setTimeout(resolve, ms));
            return _sendTxWithRetry(rawTx, retriesLeft - 1, ms);
          }
          return { error: error.message };
        }
      };

      return _sendTxWithRetry(rawTx, 15, 800);
    }

}
