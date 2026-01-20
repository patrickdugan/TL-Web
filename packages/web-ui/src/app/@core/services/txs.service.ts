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
  scriptPubKey?: string;
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

function isHex(str: string): boolean {
  return /^[0-9a-fA-F]+$/.test(str) && str.length % 2 === 0;
}

function hexToBase64(hex: string): string {
  const bytes = hex.match(/.{1,2}/g)!.map(b => parseInt(b, 16));
  let bin = "";
  for (const byte of bytes) bin += String.fromCharCode(byte);
  return btoa(bin);
}

function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let hex = "";
  for (let i = 0; i < bin.length; i++) {
    hex += bin.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}


@Injectable({
  providedIn: "root",
})
export class TxsService {
  private baseUrl = "https://api.layerwallet.com";
  private testUrl = "https://testnet-api.layerwallet.com"
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

  private get relayerUrl(): string {
  return String(this.balanceService.NETWORK).includes("TEST")
    ? this.testUrl
    : this.baseUrl;
  }

async getContractInfo(contractId: number) {
  const res = await axios.post(
    `${this.relayerUrl}/rpc/tl_getContractInfo`,
    { params: [{ contractId }] }
  );
  return res.data;
}

async getInitMarginPerContract(contractId: number, price: number) {
  const res = await axios.post(
    `${this.relayerUrl}/rpc/tl_getInitMargin`,
    { params: [{ contractId, price }] }
  );
  return Number(res.data);
}


// Add this helper function for computing margins
async computeMargin(
  contractId: number,
  amount: number,
  price: number
) {
  const [contractInfo, perContractMargin] = await Promise.all([
    this.getContractInfo(contractId),
    this.getInitMarginPerContract(contractId, price),
  ]);

  if (!contractInfo || !perContractMargin) {
    throw new Error('Failed to compute futures margin');
  }

  const initMargin = perContractMargin * amount;
  const collateral = contractInfo.collateralPropertyId;

  if (!collateral || initMargin <= 0) {
    throw new Error('Invalid futures margin parameters');
  }

  return {
    collateral,
    initMargin,
    perContractMargin,
    inverse: contractInfo.inverse,
    leverage: contractInfo.leverage,
  };
}

  async buildTradeTx(
    tradeConfig: IBuildTradeConfig
  ): Promise<{ data?: { rawtx: string; inputs: IUTXO[]; psbtHex?: string }; error?: string }> {
    try {
      const url =
        this.balanceService.NETWORK === "LTCTEST"
          ? this.testUrl
          : this.baseUrl;

          console.log('build trade url '+url)
      const response = await axios.post(`${url}/tx/buildTradeTx`, tradeConfig);
      console.log("trade build response " + JSON.stringify(response));
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


  getEnoughInputs2(
    utxos: IUTXO[],
    amount: number
  ): { finalInputs: IUTXO[]; fee: number }{
    const sortedUtxos = [...utxos].sort((a, b) => b.amount - a.amount); // Sort by amount (largest first)
    const finalInputs: IUTXO[] = [];
    let total = 0;

    for (const utxo of sortedUtxos) {
      finalInputs.push(utxo);
      total += utxo.amount;
      if (total >= amount) break;
    }

    if (total < amount) {
      throw new Error('Not enough UTXOs to cover the required amount');
    }

    const fee = 0.00001; // Example static fee, adjust dynamically if needed
    return { finalInputs, fee };
  };
  
  async buildSignSendTxGrabUTXO(
    buildTxConfig: IBuildTxConfig
  ): Promise<{ txid?: string; commitUTXO?: IUTXO; error?: string; data?: any }> {
    try {
      //this.loadingService.isLoading = true;

      const UTXOs =
        this.balanceService.allBalances[buildTxConfig.fromKeyPair.address]
          ?.coinBalance?.utxos || [];

      const biggestInput = this.getEnoughInputs2(UTXOs, 0.0000546);
      buildTxConfig.inputs = biggestInput.finalInputs;

      console.log("buildTxConfig " + JSON.stringify(buildTxConfig));

      // ────────────────────────────────────────────
      //  PHANTOM MODE? → PSBT SIGNING FLOW
      // ────────────────────────────────────────────
      const provider = this.walletService.provider$.value || this.walletService["pick"]();
      const isPhantom = provider?.kind === "phantom-btc";

      let finalHex: string;

      if (isPhantom) {
        console.log("[phantom] building unsigned PSBT");
        
        // 1) Get unsigned PSBT from relayer
        const unsignedRes = await fetch(`${this.walletService.baseUrl}/tx/buildUnsigned`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txConfig: buildTxConfig,
            network: this.balanceService.NETWORK
          })
        }).then(r => r.json());

        if (!unsignedRes.success) {
          return { error: unsignedRes.error || "Failed to build unsigned PSBT" };
        }

        const psbtBase64 = unsignedRes.data.psbtBase64;

        // 2) Phantom signs PSBT
        console.log("[phantom] signing PSBT");
        const signedBase64 = await this.walletService.signPsbt(psbtBase64, {
          autoFinalize: true,
          broadcast: false
        });

        // Wrap Phantom output in object shape
        const phantomSigned = {
          psbtBase64: signedBase64,
          psbtHex: base64ToHex(signedBase64),
          rawTx: undefined,
          finalHex: undefined
        };

        // 3) Finalize at relayer (Phantom cannot finalize multisig)
        const finalizeRes = await fetch(`${this.walletService.baseUrl}/tx/finalizePsbt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psbt: signedBase64 })
        }).then(r => r.json());

        if (!finalizeRes.success) {
          return { error: finalizeRes.error || "Failed to finalize Phantom PSBT" };
        }

        phantomSigned.finalHex = finalizeRes.finalHex;

        // Return a valid finalHex into the flow
        finalHex = phantomSigned.finalHex!;

      } else {
        // ────────────────────────────────────────────
        //  CUSTOM EXTENSION? → existing direct-sign flow
        // ────────────────────────────────────────────
        const signResponse = await window.myWallet?.sendRequest("signTransaction", {
          transaction: buildTxConfig,
          network: this.balanceService.NETWORK,
        });

        if (!signResponse || !signResponse.success) {
          return { error: signResponse?.error || "Failed to sign transaction." };
        }

        finalHex = signResponse.data.rawTx;
      }

      console.log("signed tx:", finalHex);

      // ────────────────────────────────────────────
      //  BROADCAST FINAL HEX
      // ────────────────────────────────────────────
      const sendResponse = await this.sendTx(finalHex);
      if (sendResponse.error) return { error: sendResponse.error };

      if (!sendResponse.data) {
        return { error: "Broadcast returned no txid" };
      }
      const txid = sendResponse.data || ''
      const commitUTXO: IUTXO = {
        amount: 0.0000546,
        confirmations: 0,
        vout: 0,
        txid,
      };

      return {
        txid,
        commitUTXO,
        data: { rawtx: finalHex }
      };

    } catch (err: any) {
      console.error("Error in buildSignSendTxGrabUTXO:", err.message);
      return { error: err.message };
    } finally {
      this.loadingService.isLoading = false;
    }
  }

  async buildSignSendTx(
    buildTxConfig: IBuildTxConfig
  ): Promise<{ data?: string; error?: string }> {
    try {
      //this.loadingService.isLoading = true;

      const provider = this.walletService.provider$.value || this.walletService["pick"]();
      const isPhantom = provider?.kind === "phantom-btc";

      let finalHex: string;

      if (isPhantom) {
        // 1) Build PSBT server-side
        const unsignedRes = await fetch(`${this.walletService.baseUrl}/tx/buildUnsigned`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            txConfig: buildTxConfig,
            network: this.balanceService.NETWORK
          })
        }).then(r => r.json());

        if (!unsignedRes.success) {
          return { error: unsignedRes.error || "Failed to build unsigned PSBT" };
        }

        const psbtBase64 = unsignedRes.data.psbtBase64;

        // 2) Phantom signs it
        const signedBase64 = await this.walletService.signPsbt(psbtBase64, {
          autoFinalize: true,
          broadcast: false
        });

        const phantomSigned = {
          psbtBase64: signedBase64,
          psbtHex: base64ToHex(signedBase64),
          rawTx: undefined,
          finalHex: undefined,
        };

        const finalizeRes = await fetch(`${this.walletService.baseUrl}/tx/finalizePsbt`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ psbt: signedBase64 })
        }).then(r => r.json());

        if (!finalizeRes.success) {
          return { error: finalizeRes.error || "Failed to finalize Phantom PSBT" };
        }

        phantomSigned.finalHex = finalizeRes.finalHex;

        finalHex = phantomSigned.finalHex!;


      } else {
        // EXTENSION legacy flow
        const signResponse = await window.myWallet?.sendRequest("signTransaction", {
          transaction: buildTxConfig,
          network: this.balanceService.NETWORK,
        });

        if (!signResponse || !signResponse.success) {
          return { error: signResponse?.error || "Failed to sign transaction." };
        }

        finalHex = signResponse.data.rawTx;
      }

      // 3) Broadcast
      const sendResponse = await this.sendTx(finalHex);
      if (sendResponse.error) return { error: sendResponse.error };

      return { data: sendResponse.data };

    } catch (error: any) {
      console.error("Error in buildSignSendTx:", error.message);
      return { error: error.message };
    } finally {
      this.loadingService.isLoading = false;
    }
  }


  async signPsbt(psbtHex: string, sellerFlag: boolean): Promise<{
    data?: {
      psbtHex: string;
      isValid: boolean;
      isFinished: boolean;
      finalHex?: string;
    };
    error?: string;
  }> {
    try {
      const provider = this.walletService.provider$.value || this.walletService["pick"]?.();
      const isPhantom = provider?.kind === "phantom-btc";
      const isCustom = provider?.kind === "custom";

      if (!provider) {
        return { error: "No wallet provider connected." };
      }

      //-----------------------------------------------------------
      // Convert PSBT to base64 for Phantom (Phantom requires base64)
      //-----------------------------------------------------------
      const psbtBase64 = isPhantom ? hexToBase64(psbtHex) : null;

      //-----------------------------------------------------------
      // 1. SIGNING (Provider-dependent)
      //-----------------------------------------------------------
      let signedPsbtHex: string | undefined;
      let signedPsbtBase64: string | undefined;

      if (isPhantom) {
        console.log("Signing PSBT via Phantom", psbtBase64);

        const res = await provider.signPsbt(psbtBase64!, {
          autoFinalize: false,
          broadcast: false,
        });

        // res is a base64 PSBT coming back
        signedPsbtBase64 = res;
        signedPsbtHex = base64ToHex(res);

      } else if (isCustom) {
        console.log("Signing PSBT via custom extension", psbtHex);

        const response = await window.myWallet!.sendRequest("signPsbt", {
          psbtHex,
          network: this.balanceService.NETWORK,
          sellerFlag,
        });

        if (!response || !response.success) {
          return { error: response?.error || "Failed to sign PSBT." };
        }

        signedPsbtHex = response.data.psbtHex;
      }

      if (!signedPsbtHex) {
        return { error: "PSBT signing failed (null signedPsbtHex)" };
      }

      //-----------------------------------------------------------
      // 2. FINALIZATION (Phantom needs relayer; custom may already be final)
      //-----------------------------------------------------------
      let finalHex: string | undefined = undefined;
      let isFinished = false;

      if (isPhantom) {
        // DON'T finalize during Step 4 (seller)
        if (!sellerFlag) {
          const finalizeRes = await axios.post(
            `${this.relayerUrl}/tx/finalizePsbt`,
            { psbt: signedPsbtBase64 },
            { headers: { "Content-Type": "application/json" } }
          );

          if (!finalizeRes?.data?.success) {
            return {
              error:
                finalizeRes?.data?.error ||
                "Relayer failed to finalize Phantom PSBT.",
            };
          }

          finalHex = finalizeRes.data.finalHex;
          isFinished = true;
        } else {
          // Step 4: Return half-signed PSBT only
          finalHex = undefined;
          isFinished = false;
        }
      }else if (isCustom) {
        // custom extension already gives finalHex when finished
        const response = await window.myWallet!.sendRequest("signPsbt", {
          psbtHex,
          network: this.balanceService.NETWORK,
          sellerFlag,
        });

        finalHex = response.data?.rawTx;
        isFinished = response.data?.isFinished ?? !!finalHex;
      }

      //-----------------------------------------------------------
      // 3. Return EXACT original structure
      //-----------------------------------------------------------
      return {
        data: {
          psbtHex: signedPsbtHex,
          isValid: true,
          isFinished,
          finalHex,
        },
      };
    } catch (err: any) {
      console.error("Error in signPsbt:", err);
      return { error: err.message };
    }
  }

  async signPsbtWithCustom(psbtHex: string, sellerFlag: boolean): Promise<{
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
        sellerFlag: sellerFlag,
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

    async predictColumn(channelAddress: string, myAddress: string, cpAddress: string): Promise<{ data?: string; error?: string }>{
        if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://testnet-api.layerwallet.com'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
        }
        try {
          const response = await axios.post(`${this.baseUrl}/rpc/tl_getChannelColumn`, {channelAddress, myAddress, cpAddress });
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
          console.log('result in send tx 0'+JSON.stringify(result))
          return result.data.txid;
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
