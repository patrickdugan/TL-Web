import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { BalanceService } from "./balance.service";
import { LoadingService } from "./loading.service";
import { RpcService, TNETWORK } from "./rpc.service";
import {WalletService} from "./wallet.service"
import { RelayerWsService } from "./relayer-ws.service";
import { ENCODER } from "src/app/utils/payloads/encoder";
import { ProceduralReceiptConfig } from "../constants/procedural.constants";
import { MainApiService } from "../apis/main-api.service";

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
  private baseUrl = "https://ws.layerwallet.com/relayer";
  private testUrl = "https://ws.layerwallet.com/relayer"
  private network = this.rpcService.NETWORK

  constructor(
    private rpcService: RpcService,
    private apiService: ApiService,
    private authService: AuthService,
    private loadingService: LoadingService,
    private toastrService: ToastrService,
    private balanceService: BalanceService,
    private walletService: WalletService,
    private relayerWsService: RelayerWsService,
    private mainApi: MainApiService
  ) {}

  private get relayerUrl(): string {
  return String(this.balanceService.NETWORK).includes("TEST")
    ? this.testUrl
    : this.baseUrl;
  }

  private async requestTradeLayer(method: string, params?: any): Promise<any> {
    const provider = this.walletService.getTradeLayerProvider();
    if (!provider) {
      throw new Error("TradeLayer extension not available.");
    }
    return provider.request({ method, params });
  }

  private normalizeTradeLayerPsbtResult(response: any): {
    psbtHex: string;
    isValid: boolean;
    isFinished: boolean;
    rawTx?: string;
  } {
    const result = response?.data ?? response;
    if (!result) {
      throw new Error("TradeLayer wallet returned an empty PSBT result.");
    }

    const psbtHex = result.psbtHex || result.psbt || result.rawTx;
    if (!psbtHex) {
      throw new Error("TradeLayer wallet did not return a PSBT or final transaction hex.");
    }

    return {
      psbtHex,
      isValid: result.isValid ?? true,
      isFinished: result.isFinished ?? !!result.rawTx,
      rawTx: result.rawTx,
    };
  }

  async getContractInfo(contractId: number) {
    this.relayerWsService.setBaseUrl(this.relayerUrl);
    return this.relayerWsService.request(`/rpc/tl_getContractInfo`, {
      method: "POST",
      body: { params: [{ contractId }] },
    });
  }

  async getInitMarginPerContract(contractId: number, price: number) {
    this.relayerWsService.setBaseUrl(this.relayerUrl);
    const res = await this.relayerWsService.request(`/rpc/tl_getInitMargin`, {
      method: "POST",
      body: { params: [{ contractId, price }] },
    });
    return Number(res);
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
      this.relayerWsService.setBaseUrl(url);
      const response = await this.relayerWsService.request(`${'/tx/buildTradeTx'}`, {
        method: "POST",
        body: tradeConfig,
      });
      console.log("trade build response " + JSON.stringify(response));
      return response as any;
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
            this.baseUrl = 'https://ws.layerwallet.com/relayer'
            console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
      }
      const uri = this.baseUrl+'/tx/buildLTCTradeTx'
      this.relayerWsService.setBaseUrl(this.baseUrl);
      const response = await this.relayerWsService.request(uri.replace(this.baseUrl, ''), {
        method: "POST",
        body: { buildLTCITTxConfig },
      });
      console.log('utxo build response '+JSON.stringify(response))
      return response as any;
    } catch (error: any) {
      console.error("Error in buildLTCITTx:", error.message);
      return { error: error.message };
    }
  }

  async fetchUTXOs(address: string, pubkey:string): Promise<{ data?: string; error?: string }>{
      if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://ws.layerwallet.com/relayer'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
      }
      const uri = this.baseUrl+'/address/utxo/'+address 
      console.log(uri)
      try {
        this.relayerWsService.setBaseUrl(this.baseUrl);
        const response = await this.relayerWsService.request(uri.replace(this.baseUrl, ''), {
          method: "POST",
          body: { pubkey },
        });
        return response as any;
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
      const providerKind = this.walletService.getConnectedOrPreferredProviderKind();
      const isPhantom = providerKind === "phantom-btc";

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

        const customSigned = await this.signPsbt(base64ToHex(unsignedRes.data.psbtBase64), false);
        if (customSigned.error || !customSigned.data?.finalHex) {
          return { error: customSigned.error || "Failed to finalize custom PSBT." };
        }

        finalHex = customSigned.data.finalHex;
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

      const providerKind = this.walletService.getConnectedOrPreferredProviderKind();
      const isPhantom = providerKind === "phantom-btc";

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

        const customSigned = await this.signPsbt(base64ToHex(unsignedRes.data.psbtBase64), false);
        if (customSigned.error || !customSigned.data?.finalHex) {
          return { error: customSigned.error || "Failed to finalize custom PSBT." };
        }

        finalHex = customSigned.data.finalHex;
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

  async sendToken(params: {
    fromAddress: string;
    toAddress: string;
    amount: number | string;
    propertyId: number;
  }): Promise<{ data?: string; error?: string }> {
    const payload = ENCODER.encodeSend({
      sendAll: false,
      address: params.toAddress,
      propertyId: params.propertyId,
      amount: Number(params.amount),
    });

    return this.buildSignSendTx({
      fromKeyPair: { address: params.fromAddress },
      toKeyPair: { address: params.toAddress },
      payload,
    });
  }

  async sendNativeCoin(params: {
    fromAddress: string;
    toAddress: string;
    amount: number | string;
  }): Promise<{ data?: string; error?: string }> {
    return this.buildSignSendTx({
      fromKeyPair: { address: params.fromAddress },
      toKeyPair: { address: params.toAddress },
      amount: Number(params.amount),
    });
  }

  async mintProceduralReceipt(params: {
    recipientAddress: string;
    amount: number | string;
  }): Promise<{ data?: string; error?: string }> {
    const res = await this.mainApi.bitvmProceduralMint({
      recipientAddress: params.recipientAddress,
      amount: params.amount,
    });
    if (res?.error || !res?.data?.mintTxid) {
      return { error: res?.error || 'Failed to mint procedural receipt.' };
    }
    return { data: res.data.mintTxid };
  }

  async redeemProceduralReceipt(params: {
    holderAddress: string;
    propertyId: number;
    amount: number | string;
    dlcTemplateId?: string;
    dlcContractId?: string;
    settlementState?: string;
  }): Promise<{ data?: string; error?: string }> {
    const payload = ENCODER.encodeRedeemManagedToken({
      propertyId: params.propertyId,
      amountDestroyed: params.amount,
      dlcTemplateId: params.dlcTemplateId,
      dlcContractId: params.dlcContractId,
      settlementState: params.settlementState,
    });

    return this.buildSignSendTx({
      fromKeyPair: { address: params.holderAddress },
      toKeyPair: { address: params.holderAddress },
      payload,
    });
  }

  async tokenizeProceduralReceipt(params: {
    depositorAddress: string;
    amount: number | string;
    config: ProceduralReceiptConfig;
  }): Promise<{ data?: { depositTxid: string; mintTxid: string }; error?: string }> {
    const expectations = this.requireProceduralExecutionContext(params.config);
    const receiptPropertyId = Number(params.config.receiptPropertyId || 0);
    if (!receiptPropertyId) {
      return { error: 'Receipt property is not configured.' };
    }
    if (!params.config.fundingTxid) {
      return { error: 'Canonical funding txid is missing for procedural mint.' };
    }
    if (!params.config.fundedAmountLtc) {
      return { error: 'Canonical funded amount is missing for procedural mint.' };
    }

    const requestedAmount = Number(params.amount);
    const canonicalAmount = Number(params.config.fundedAmountLtc);
    if (!Number.isFinite(requestedAmount) || !Number.isFinite(canonicalAmount) || requestedAmount <= 0 || canonicalAmount <= 0) {
      return { error: 'Canonical procedural mint amount is invalid.' };
    }
    if (requestedAmount.toFixed(8) !== canonicalAmount.toFixed(8)) {
      return { error: `Procedural mint amount must match canonical funded amount ${canonicalAmount.toFixed(8)} LTC.` };
    }

    const mintRes = await this.mainApi.bitvmProceduralMint({
      recipientAddress: params.depositorAddress,
      amount: canonicalAmount,
      depositTxid: params.config.fundingTxid,
      ...expectations,
    });
    if (mintRes?.error || !mintRes?.data?.mintTxid) {
      return { error: mintRes.error || 'Failed to mint receipt token.' };
    }

    return { data: { depositTxid: params.config.fundingTxid, mintTxid: mintRes.data.mintTxid } };
  }

  async redeemProceduralReceiptWithRelease(params: {
    holderAddress: string;
    amount: number | string;
    config: ProceduralReceiptConfig;
    recipientAddress?: string;
  }): Promise<{ data?: { redeemTxid: string; releaseTxid: string }; error?: string }> {
    const expectations = this.requireProceduralExecutionContext(params.config);
    const receiptPropertyId = Number(params.config.receiptPropertyId || 0);
    if (!receiptPropertyId) {
      return { error: 'Receipt property is not configured.' };
    }
    if (params.config.releaseReady !== true) {
      return {
        error: params.config.contextErrors?.[0]
          || params.config.contextWarnings?.[0]
          || 'Canonical BitVM release is disabled for the current execution context.',
      };
    }

    const redeemRes = await this.redeemProceduralReceipt({
      holderAddress: params.holderAddress,
      propertyId: receiptPropertyId,
      amount: params.amount,
      dlcTemplateId: params.config.templateId,
      dlcContractId: params.config.contractId,
      settlementState: params.config.redeemSettlementState,
    });
    if (redeemRes.error || !redeemRes.data) {
      return { error: redeemRes.error || 'Failed to redeem receipt token.' };
    }

    const releaseRes = await this.mainApi.bitvmProceduralRelease({
      recipientAddress: params.recipientAddress || params.holderAddress,
      amount: params.amount,
      redeemTxid: redeemRes.data,
      ...expectations,
    });
    if (releaseRes?.error || !releaseRes?.data?.releaseTxid) {
      return { error: releaseRes?.error || 'Failed to release native collateral.' };
    }

    return { data: { redeemTxid: redeemRes.data, releaseTxid: releaseRes.data.releaseTxid } };
  }

  private requireProceduralExecutionContext(config: ProceduralReceiptConfig): {
    expectedExecutionContextId: string;
    expectedExecutionContextHash: string;
    expectedFundingTxid: string;
    expectedSelectedPathId: string;
    expectedTemplateId: string;
    expectedContractId: string;
  } {
    if (config.executionContextReady !== true || config.ready === false) {
      throw new Error(
        config.contextErrors?.[0]
          || config.contextWarnings?.[0]
          || 'Procedural execution context is not ready.'
      );
    }
    if (!config.executionContextId || !config.executionContextHash) {
      throw new Error('Procedural execution context identifiers are missing.');
    }
    if (!config.fundingTxid || !config.selectedPathId) {
      throw new Error('Procedural funding or selected-path references are missing.');
    }
    if (!config.templateId || !config.contractId) {
      throw new Error('Procedural template or contract references are missing.');
    }
    if (!config.vaultAddress) {
      throw new Error('Procedural deposit address is missing.');
    }

    return {
      expectedExecutionContextId: config.executionContextId,
      expectedExecutionContextHash: config.executionContextHash,
      expectedFundingTxid: config.fundingTxid,
      expectedSelectedPathId: config.selectedPathId,
      expectedTemplateId: config.templateId,
      expectedContractId: config.contractId,
    };
  }

  async signPsbt(psbtHex: string, sellerFlag: boolean, redeemScript?: string): Promise<{
      data?: {
        psbtHex: string;
        isValid: boolean;
        isFinished: boolean;
        finalHex?: string;
      };
      error?: string;
    }> {
      try {
        const providerKind = this.walletService.getConnectedOrPreferredProviderKind();
        const isPhantom = providerKind === "phantom-btc";
        const isCustom = providerKind === "custom";

        if (!providerKind) {
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
        let finalHex: string | undefined = undefined;
        let isFinished = false;

        if (isPhantom) {
          // Determine signing indexes: seller signs vIn 0 only, buyer signs the rest
          const signingIndexes = sellerFlag
            ? [0]
            : Array.from({ length: this.getPsbtInputCount(psbtHex) - 1 }, (_, i) => i + 1);

          console.log("Signing PSBT via Phantom", psbtBase64, "signingIndexes", signingIndexes);

          const res = await this.walletService.signPsbt(psbtBase64!, {
            autoFinalize: false,
            broadcast: false,
            signingIndexes,
          });

          signedPsbtBase64 = res;
          signedPsbtHex = base64ToHex(res);

        } else if (isCustom) {
          console.log("Signing PSBT via custom extension", psbtHex);

          const response = await this.requestTradeLayer("signPsbt", {
            psbtHex,
            network: this.balanceService.NETWORK,
            sellerFlag,
            redeemScript,
          });
          const normalized = this.normalizeTradeLayerPsbtResult(response);

          signedPsbtHex = normalized.psbtHex;
          finalHex = normalized.rawTx;
          isFinished = normalized.isFinished;
        }

        if (!signedPsbtHex) {
          return { error: "PSBT signing failed (null signedPsbtHex)" };
        }

        //-----------------------------------------------------------
        // 2. FINALIZATION (Phantom needs relayer; custom already handled above)
        //-----------------------------------------------------------
        if (isPhantom) {
          if (!sellerFlag) {
            this.relayerWsService.setBaseUrl(this.relayerUrl);
            const finalizeRes = await this.relayerWsService.request<any>(
              `/tx/finalizePsbt`,
              {
                method: "POST",
                body: { psbt: signedPsbtBase64 },
              }
            );

            if (!finalizeRes?.success) {
              return {
                error:
                  finalizeRes?.error ||
                  "Relayer failed to finalize Phantom PSBT.",
              };
            }

            finalHex = finalizeRes.finalHex;
            isFinished = true;
          } else {
            finalHex = undefined;
            isFinished = false;
          }
        }

        //-----------------------------------------------------------
        // 3. Return structure
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

    async signPsbtWithCustom(psbtHex: string, sellerFlag: boolean, redeemScript?: string): Promise<{
      data?: {
        psbtHex: string;
        isValid: boolean;
        isFinished: boolean;
        finalHex?: string;
      };
      error?: string;
    }> {
      try {
        if (!this.walletService.getTradeLayerProvider()) {
          throw new Error("Wallet extension not available for signing PSBT.");
        }

        console.log('about to call sign Psbt in tx service '+psbtHex+' '+this.balanceService.NETWORK);
        
        const response = await this.requestTradeLayer("signPsbt", {
          psbtHex: psbtHex,
          network: this.balanceService.NETWORK,
          sellerFlag: sellerFlag,
          redeemScript: redeemScript  // ← ADDED: Pass redeemScript to extension
        });
        
        console.log('response in sign PSBT '+JSON.stringify(response));
        
        const normalized = this.normalizeTradeLayerPsbtResult(response);

        return {
          data: {
            psbtHex: normalized.psbtHex,
            isValid: normalized.isValid,
            isFinished: normalized.isFinished,
            finalHex: normalized.rawTx,
          },
        };
      } catch (error: any) {
        console.error("Error signing PSBT:", error.message);
        return { error: error.message };
      }
    }

    async decode(rawTx:string): Promise<{ data?: string; error?: string }>{
        if(this.balanceService.NETWORK=="LTCTEST"){
              this.baseUrl = 'https://ws.layerwallet.com/relayer'
              console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
          }

          try {
            this.relayerWsService.setBaseUrl(this.baseUrl);
			const response = await this.relayerWsService.request(`/tx/decode`, {
        method: "POST",
        body: { rawtx: rawTx },
      });
            return response as any;
          } catch (error: any) {
            console.error('Error in decode:', error.message);
            return error;
          }
    }

    async getTx(txid: string): Promise<{ data?: any; error?: string }> {
      if (this.balanceService.NETWORK == "LTCTEST") {
        this.baseUrl = "https://ws.layerwallet.com/relayer";
      }
      try {
        this.relayerWsService.setBaseUrl(this.baseUrl);
        const response = await this.relayerWsService.request<any>(`/tx/${txid}`, {
          method: "GET",
        });
        return response;
      } catch (error: any) {
        console.error("Error in getTx:", error.message);
        return { error: error.message };
      }
    }

    async sendTx(rawTx: string): Promise<{ data?: string; error?: string }> {
        if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://ws.layerwallet.com/relayer'
          console.log('network in txservice '+this.rpcService.NETWORK+' '+this.baseUrl)
        }
      try {
        this.relayerWsService.setBaseUrl(this.baseUrl);
        const response = await this.relayerWsService.request<any>(`/tx/sendTx`, {
          method: "POST",
          body: { rawTx },
        });
        console.log('send response:', JSON.stringify(response));

        if (response.error) {
          return { error: response.error };
        }

        const txid = response.txid?.data;

        return { data: txid }; // Ensure the returned type matches the Promise<{ data?: string; error?: string }>
      } catch (error: any) {
        console.error("Error broadcasting transaction:", error.message);
        return { error: error.message };
      }
    }

    async getChainInfo(): Promise<{ data?: string; error?: string }>{
          if(this.balanceService.NETWORK=="LTCTEST"){
              this.baseUrl = 'https://ws.layerwallet.com/relayer'
              console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
          }

          try {
            this.relayerWsService.setBaseUrl(this.baseUrl);
            const response = await this.relayerWsService.request(`/chain/info`, { method: "GET" });
            return response as any;
          } catch (error: any) {
            console.error('Error in getChainInfo:', error.message);
            return error;
          }
    }

    async predictColumn(channelAddress: string, myAddress: string, cpAddress: string): Promise<{ data?: string; error?: string }>{
        if(this.balanceService.NETWORK=="LTCTEST"){
          this.baseUrl = 'https://ws.layerwallet.com/relayer'
          console.log('network in txservice '+this.balanceService.NETWORK+' '+this.baseUrl)
        }
        try {
          this.relayerWsService.setBaseUrl(this.baseUrl);
          const response = await this.relayerWsService.request(`/rpc/tl_getChannelColumn`, {
            method: "POST",
            body: { channelAddress, myAddress, cpAddress },
          });
          return response as any;
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
        this.baseUrl = 'https://ws.layerwallet.com/relayer'
        console.log('network in txservice '+this.rpcService.NETWORK+' '+this.baseUrl)
      }
        try {
          this.relayerWsService.setBaseUrl(this.baseUrl);
          const result = await this.relayerWsService.request<any>(`/tx/sendTx`, {
            method: "POST",
            body: { rawTx },
          });
          console.log('result in send tx 0'+JSON.stringify(result))
          return result.txid;
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

    /** Parse PSBT hex to get the number of inputs in the unsigned tx. */
    private getPsbtInputCount(psbtHex: string): number {
      try {
        const bytes = new Uint8Array(
          psbtHex.match(/.{1,2}/g)!.map(b => parseInt(b, 16))
        );
        // PSBT: magic(4) + 0xff(1) + global key-value pairs
        let offset = 5;
        while (offset < bytes.length) {
          const keyLen = this.readVarInt(bytes, offset);
          offset += this.varIntSize(keyLen);
          if (keyLen === 0) break; // separator
          const keyType = bytes[offset];
          offset += keyLen; // skip entire key
          const valLen = this.readVarInt(bytes, offset);
          offset += this.varIntSize(valLen);
          if (keyType === 0x00) {
            // Value is the unsigned tx: version(4) + varint(inputCount)
            return this.readVarInt(bytes, offset + 4);
          }
          offset += valLen;
        }
      } catch (e) {
        console.warn("[getPsbtInputCount] parse error, defaulting to 4", e);
      }
      return 4;
    }

    private readVarInt(bytes: Uint8Array, offset: number): number {
      const first = bytes[offset];
      if (first < 0xfd) return first;
      if (first === 0xfd) return bytes[offset + 1] | (bytes[offset + 2] << 8);
      if (first === 0xfe)
        return bytes[offset + 1] | (bytes[offset + 2] << 8) |
               (bytes[offset + 3] << 16) | (bytes[offset + 4] << 24);
      return bytes[offset + 1] | (bytes[offset + 2] << 8); // 0xff, truncated
    }

    private varIntSize(value: number): number {
      if (value < 0xfd) return 1;
      if (value <= 0xffff) return 3;
      if (value <= 0xffffffff) return 5;
      return 9;
    }
}
