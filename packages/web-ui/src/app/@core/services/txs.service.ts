import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { BalanceService } from "./balance.service";
import { LoadingService } from "./loading.service";
import { RpcService, TNETWORK } from "./rpc.service";
import * as bitcore from 'bitcore-lib-litecoin'; // Use the Litecoin variant of Bitcore
import axios from 'axios';

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


const litecoinTestnet = {
  name: 'ltc-testnet',
  messagePrefix: '\x19Litecoin Signed Message:\n',
  bech32: 'tltc',
  bip32: {
    public: 0x043587cf, // Testnet public key prefix
    private: 0x04358394, // Testnet private key prefix
  },
  pubKeyHash: 0x6f, // Testnet P2PKH addresses start with 'm' or 'n'
  scriptHash: 0x3a, // Testnet P2SH addresses start with '2'
  wif: 0xef, // Testnet WIF starts with '9' or 'c'
};

const ltcNetwork = {
  name: 'ltc',
  alias: 'litecoin',
  pubkeyhash: 0x30, // Litecoin P2PKH
  scripthash: 0x32, // Litecoin P2SH
  wif: 0xb0, // Litecoin WIF
};

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
  network?: TNETWORK;
}

export interface IBuildTradeConfig {
  buyerKeyPair: {
    address: string;
    pubkey?: string;
  };
  sellerKeyPair: {
    address: string;
    pubkey?: string;
  };
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
  providedIn: 'root',
})
export class TxsService {
  private baseUrl = 'https://api.layerwallet.com';

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
    return this.rpcService.rpc('dumpprivkey', [address]);
  }

  async buildLTCITTx(
    buildTxConfig: IBuildLTCITTxConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tx/tl_buildLTCITTx`, { params: [buildTxConfig] });
      return response.data;
    } catch (error: any) {
      console.error('Error in buildLTCITTx:', error.message);
      return { error: error.message };
    }
  }

  async buildTx(
    buildTxConfig: IBuildTxConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tx/tl_buildTx`, { params: [buildTxConfig] });
      return response.data;
    } catch (error: any) {
      console.error('Error in buildTx:', error.message);
      return { error: error.message };
    }
  }

  async buildTradeTx(
    buildTxConfig: IBuildTradeConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/tx/tl_buildTradeTx`, { params: [buildTxConfig] });
      return response.data;
    } catch (error: any) {
      console.error('Error in buildTx:', error.message);
      return { error: error.message };
    }
  }


 async signTransaction(rawTx: string): Promise<any> {
    try {
        const response = await window.myWallet!.sendRequest('signTransaction', {
            transaction: rawTx,
        });

        if (!response || !response.success) {
            throw new Error(response?.error || 'Failed to sign transaction');
        }

        return response.data; // Signed transaction hex
    } catch (error: any) {
        console.error('Error signing transaction:', error.message);
        throw new Error('Failed to sign transaction');
    }
}


  async signRawTxWithWallet(txHex: string): Promise<{
    data: { isValid: boolean; signedHex?: string };
    error?: string;
  }> {
    try {
      const result = await this.rpcService.rpc('signrawtransactionwithwallet', [txHex]);
      return {
        data: { isValid: result.data.complete, signedHex: result.data.hex },
      };
    } catch (error: any) {
      console.error('Error in signRawTxWithWallet:', error.message);
          return {
      data: { isValid: false }, // Default or placeholder value
      error: error.message,
    };

    }
  }

  async getChannel(address: string) {
    try {
      const response = await axios.post(`${this.baseUrl}/rpc/tl_getChannel`, { params: [address] });
      return response.data;
    } catch (error: any) {
      console.error('Error in getChannel:', error.message);
      return { data: [] };
    }
  }

  async checkMempool(txid: string) {
    try {
      const mempool = await this.rpcService.rpc('getrawmempool', []);
      return mempool.data.includes(txid);
    } catch (error: any) {
      console.error('Error checking mempool:', error.message);
      return false;
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

  async buildSignSendTx(buildTxConfig: IBuildTxConfig): Promise<{ data?: string; error?: string }> {
  try {
    this.loadingService.isLoading = true;

    // Collect parameters for the browser extension
    const transactionData = {
      fromAddress: buildTxConfig.fromKeyPair.address,
      toAddress: buildTxConfig.toKeyPair.address,
      amount: buildTxConfig.amount,
      network: buildTxConfig.network,
      payload: buildTxConfig.payload,
    };

    const tx = await axios.post(`${this.baseUrl}/tx/sendrawtransaction`, { params: [rawTx] 

    console.log('tx hex '+tx)

    // Pass the transaction data to the browser extension
    const response = await window.myWallet!.sendRequest('signTransaction', transactionData);

    if (!response || !response.success) {
      return { error: response.error || 'Failed to build, sign, or send the transaction.' };
    }

    return { data: response.data };
  } catch (error: any) {
    console.error('Error in buildSignSendTx:', error.message);
    return { error: error.message };
  } finally {
    this.loadingService.isLoading = false;
  }
}


  /*async buildSignSendTx(buildTxConfig: IBuildTxConfig): Promise<{ data?: string; error?: string }> {
    try {
      this.loadingService.isLoading = true;

      // Fetch UTXOs from the relayer
      const utxoResponse = await axios.post<IUTXO[]>(
        `${this.baseUrl}/address/utxo/${buildTxConfig.fromKeyPair.address}`
      );
      const utxos = utxoResponse.data;

      if (!utxos || utxos.length === 0) {
        return { error: 'No UTXOs available for the specified address.' };
      }

      // Select the largest UTXO
      const selectedUTXO = utxos.reduce((prev, current) => (prev.amount > current.amount ? prev : current));

      // Define Litecoin network
      const network = buildTxConfig.network === 'mainnet' ? 'livenet' : 'testnet';

      // Create the transaction
      const tx = new bitcore.Transaction()
        .from({
          txId: selectedUTXO.txid,
          outputIndex: selectedUTXO.vout,
          script: selectedUTXO.scriptPubKey,
          satoshis: Math.round(selectedUTXO.amount * 1e8),
        })
        .to(buildTxConfig.toKeyPair.address, Math.round((buildTxConfig.amount ?? 0) * 1e8))
        .fee(5000); // Approximate fee in satoshis

      // Add change output
      const change = Math.round(selectedUTXO.amount * 1e8) - Math.round((buildTxConfig.amount ?? 0) * 1e8) - 5000;
      if (change > 0) {
        tx.change(buildTxConfig.fromKeyPair.address);
      }

      const rawTx = tx.serialize();

      // Pass raw transaction to the wallet extension for signing
      const signRes = await window.myWallet!.sendRequest('signTransaction', { transaction: rawTx });

      if (!signRes || !signRes.success) {
        return { error: signRes.error || 'Failed to sign the transaction.' };
      }

      // Broadcast the transaction
      const sendRes = await axios.post(`${this.baseUrl}/rpc/sendrawtransaction`, { params: [signRes.signedTransaction] });

      if (sendRes.data.error) {
        return { error: sendRes.data.error };
      }

      return { data: sendRes.data.result }; // Transaction ID
    } catch (error: any) {
      console.error('Error during transaction creation:', error.message);
      this.toastrService.error(error.message);
      return { error: error.message };
    } finally {
      this.loadingService.isLoading = false;
    }
  }*/

  async signPsbt(signPsbtConfig: ISignPsbtConfig): Promise<{
    data?: {
      psbtHex: string;
      isValid: boolean;
      isFinished: boolean;
      finalHex?: string;
      wif?: string
    };
    error?: string;
  }> {
    try {
      if (!window.myWallet || typeof window.myWallet.sendRequest !== 'function') {
        throw new Error('Wallet extension is not available or does not support signing PSBTs.');
      }

      const response = await window.myWallet!.sendRequest('signPsbt', {
        psbtHex: signPsbtConfig.psbtHex,
        redeemKey: signPsbtConfig.redeem,
        network: signPsbtConfig.network,
      });

      if (!response || !response.success) {
        return { error: response?.error || 'Failed to sign PSBT.' };
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
      console.error('Error signing PSBT:', error.message || error);
      return { error: error.message || 'An unexpected error occurred while signing the PSBT.' };
    }
  }

  async sendTx(rawTx: string): Promise<{ data?: string; error?: string }> {
    try {
      const response = await axios.post(`${this.baseUrl}/rpc/sendrawtransaction`, { params: [rawTx] });

      if (response.data.error) {
        return { error: response.data.error };
      }

      return { data: response.data.result }; // Transaction ID
    } catch (error: any) {
      console.error('Error broadcasting transaction:', error.message);
      return { error: error.message };
    }
  }
}

  