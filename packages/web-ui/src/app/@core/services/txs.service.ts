import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { BalanceService } from "./balance.service";
import { LoadingService } from "./loading.service";
import { RpcService, TNETWORK } from "./rpc.service";
import {WalletService} from "./wallet.service"
import axios from "axios";

export interface IUTXO {
  amount: number;
  confirmations: number;
  scriptPubKey: string;
  redeemScript?: string;
  txid: string;
  vout: number;
  pubkey?: string;
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
  private network = this.rpcService.NETWORK

  constructor(
    private rpcService: RpcService,
    private apiService: ApiService,
    private authService: AuthService,
    private loadingService: LoadingService,
    private toastrService: ToastrService,
    private balanceService: BalanceService,
    private walletService: WalletService
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
  buildLTCITTxConfig: IBuildLTCITTxConfig, satsPaid: number
): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
  try {
    // Fetch account details from balanceService
    const allAccounts = this.balanceService.allAccounts; // Assuming this returns an array of accounts with `address` and `pubkey`
    console.log('before checking for pubkey '+buildLTCITTxConfig.buyerKeyPair.pubkey)
    // Match the address and find the corresponding pubkey if available
    const matchingAccount = allAccounts.find(
      (account) => account.address === buildLTCITTxConfig.buyerKeyPair.address
    );

    // Use the pubkey from the matched account or fallback to the one in the config
    const pubkey = matchingAccount?.pubkey || buildLTCITTxConfig.buyerKeyPair.pubkey || '';
    console.log('about to call for utxo in build ltc trade '+buildLTCITTxConfig.buyerKeyPair.address+' '+pubkey )
    // Fetch UTXOs
    //const utxos = await this.fetchUTXOs(buildLTCITTxConfig.buyerKeyPair.address, pubkey);

    // Send the buildUTXOTrade request
    /*const response = await window.myWallet?.sendRequest("buildUTXOTrade", {
      config: buildLTCITTxConfig,
      outputs: utxos,
      network: this.balanceService.NETWORK,
      satsPaid: satsPaid
    });*/

    if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://testnet-api.layerwallet.com'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
    }
    const uri = this.baseUrl+'/tx/buildLTCTradeTx'
    const response = await axios.post(uri,{buildLTCITTxConfig});
    console.log('utxo build response '+JSON.stringify(response))
    return response.data;
  } catch (error: any) {
    console.error("Error in buildLTCITTx:", error.message);
    return { error: error.message };
  }
}


  async fetchUTXOs(address: string, pubkey:string): Promise<{ data?: string; error?: string }>{
      if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://testnet-api.layerwallet.com'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
      }
      const uri = this.baseUrl+'/address/utxo/'+address 
      console.log(uri)
      try {
        const response = await axios.post(uri,{pubkey});
        return response.data;
      } catch (error: any) {
        console.error('Error in fetch UTXOs:', error.message);
        return error;
      }  
  }

  async signRawTxWithWallet(
    txHex: string
  ): Promise<{ data: { isValid: boolean; signedHex?: string }; error?: string }> {
    try {
      const result = await this.walletService.signTransaction(txHex,this.balanceService.NETWORK);
      const parsed = JSON.parse(result)
      return {
        data: { isValid: parsed.data.complete, signedHex: parsed.data.hex },
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
      const signResponse = await window.myWallet?.sendRequest("signTransaction", { transaction: buildTxConfig, network: this.balanceService.NETWORK });
      if (!signResponse || !signResponse.success) {
        return { error: signResponse?.error || "Failed to sign transaction." };
      }
      console.log('sign response '+JSON.stringify(signResponse))
      const signedTx = signResponse.data.rawTx;
      console.log('signed tx'+signedTx)
      // Broadcast signed transaction
     const sendResponse = await this.sendTx(signedTx);
    if (sendResponse.error) {
      return { error: sendResponse.error };
    }
    console.log('Transaction ID:', sendResponse.data);

    return { data: sendResponse.data }; // Pass only the `txid`
    } catch (error: any) {
      console.error("Error in buildSignSendTx:", error.message);
      return { error: error.message };
    } finally {
      this.loadingService.isLoading = false;
    }
  }

  async signPsbt(psbtHex: string): Promise<{
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

      console.log('about to call sign Psbt in tx service '+psbtHex+' '+this.balanceService.NETWORK)
      const response = await window.myWallet.sendRequest("signPsbt", {
        psbtHex: psbtHex,
        network: this.balanceService.NETWORK,
      });
      console.log('response in sign PSBT '+JSON.stringify(response))
      if (!response || !response.success) {
        return { error: response?.error || "Failed to sign PSBT." };
      }

      return {
        data: {
          psbtHex: response.data.psbtHex,
          isValid: response.data.isValid,
          isFinished: response.data.isFinished,
          finalHex: response.data.rawTx,
        },
      };
    } catch (error: any) {
      console.error("Error signing PSBT:", error.message);
      return { error: error.message };
    }
  }

async decode(rawTx:string): Promise<{ data?: string; error?: string }>{
    if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://testnet-api.layerwallet.com'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
      }

      try {
        const response = await axios.post('${this.baseUrl}/tx/decode',{rawTx});
        return response.data;
      } catch (error: any) {
        console.error('Error in decode:', error.message);
        return error;
      }
}

async sendTx(rawTx: string): Promise<{ data?: string; error?: string }> {
    if(this.balanceService.NETWORK=="LTCTEST"){
      this.baseUrl = 'https://testnet-api.layerwallet.com'
      console.log('network in txservice '+this.rpcService.NETWORK+' '+this.baseUrl)
    }
  try {
    const response = await axios.post(`${this.baseUrl}/tx/sendTx`, { rawTx });
    console.log('send response:', JSON.stringify(response));

    if (response.data.error) {
      return { error: response.data.error };
    }

    const txid = response.data.txid?.data;

    return { data: txid }; // Ensure the returned type matches the Promise<{ data?: string; error?: string }>
  } catch (error: any) {
    console.error("Error broadcasting transaction:", error.message);
    return { error: error.message };
  }
}

async getChainInfo(): Promise<{ data?: string; error?: string }>{
      if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://testnet-api.layerwallet.com'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
      }

      try {
        const response = await axios.get(`${this.baseUrl}/chain/info`);
        return response.data;
      } catch (error: any) {
        console.error('Error in getChainInfo:', error.message);
        return error;
      }
}


    async predictColumn(myAddress: string, cpAddress: string): Promise<{ data?: string; error?: string }>{
      if(this.balanceService.NETWORK=="LTCTEST"){
        this.baseUrl = 'https://testnet-api.layerwallet.com'
        console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
      }
      try {
        const response = await axios.post(`${this.baseUrl}/rpc/tl_getChannelColumn`, { myAddress, cpAddress });
        return response.data;
      } catch (error: any) {
        console.error('Error in predictColumn:', error.message);
        return error;
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
      if(this.balanceService.NETWORK=="LTCTEST"){
        this.baseUrl = 'https://testnet-api.layerwallet.com'
        console.log('network in txservice '+this.rpcService.NETWORK+' '+this.baseUrl)
      }
        try {
          const result = await axios.post(`${this.baseUrl}/tx/sendTx`, {rawTx});
          return result.data.txid.data;
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
