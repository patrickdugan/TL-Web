import { HttpClient } from "@angular/common/http";
import { Injectable } from "@angular/core";
//import { buildPsbt, signRawTransction } from "../services/utils/crypto.util";
import { safeNumber } from "../services/utils/common.util";

const minFeeLtcPerKb = 0.0001;

interface IInput {
  txid: string;
  amount: number;
  confirmations: number;
  scriptPubKey: string;
  vout: number;
  redeemScript?: string;
  pubkey?: string;
}

interface IBuildTxConfig {
  fromKeyPair: {
    address: string;
    pubkey?: string;
  };
  toKeyPair: {
    address: string;
    pubkey?: string;
  };
  amount?: number;
  payload?: string;
  inputs?: IInput[];
  addPsbt?: boolean;
  network?: string;
}

interface IBuildLTCITTxConfig {
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
  commitUTXOs: IInput[];
  network: string;
}

@Injectable({
  providedIn: "root",
})
export class MainApiService {
  constructor(private http: HttpClient) {}

  private get apiUrl() {
    return "/api/";
  }

  setApiUrl(apiUrl: string | null) {
        return this.http.post(this.apiUrl + 'set-api-url', { apiUrl });
    }

  async rpcCall(method: string, params?: any[]): Promise<any> {
    return this.http
      .post<any>(`${this.apiUrl}${method}`, { params })
      .toPromise()
      .catch((error) => {
        throw new Error(`RPC call failed: ${error.message}`);
      });
  }

  async buildTx(buildTxConfig: IBuildTxConfig, isApiMode: boolean): Promise<any> {
    try {
      const { fromKeyPair, toKeyPair, amount = 0, payload, inputs, addPsbt, network } = buildTxConfig;
      const fromAddress = fromKeyPair.address;
      const toAddress = toKeyPair.address;

      // Validate Addresses
      const vaRes1 = await this.rpcCall("validateaddress", [fromAddress]);
      if (vaRes1.error || !vaRes1.data?.isvalid) throw new Error(`Invalid address: ${fromAddress}`);

      const vaRes2 = await this.rpcCall("validateaddress", [toAddress]);
      if (vaRes2.error || !vaRes2.data?.isvalid) throw new Error(`Invalid address: ${toAddress}`);

      // List Unspent UTXOs
      const luRes = await this.rpcCall("listunspent", [0, 9999999, [fromAddress]]);
      if (luRes.error || !luRes.data) throw new Error(`Error listing UTXOs: ${luRes.error}`);
      const utxos = [...(inputs || []), ...luRes.data];

      // Determine Minimum Output Amount
      const minAmount = 0.0000546; // Mocked value for simplicity
      if (amount < minAmount && !payload) throw new Error(`Minimum amount required: ${minAmount}`);

      // Gather Inputs
      const { finalInputs, fee } = this.getEnoughInputs(utxos, amount);
      const inputsSum = safeNumber(finalInputs.reduce((sum, input) => sum + input.amount, 0));
      const change = safeNumber(inputsSum - amount - fee);

      if (inputsSum < safeNumber(fee + amount + change)) throw new Error("Insufficient funds.");

      // Build Raw Transaction
      const insForRawTx = finalInputs.map(({ txid, vout }) => ({ txid, vout }));
      const outsForRawTx: Record<string, number> = { [toAddress]: amount };
      if (change > 0) outsForRawTx[fromAddress] = change;

      const crtRes = await this.rpcCall("createrawtransaction", [insForRawTx, outsForRawTx]);
      if (crtRes.error || !crtRes.data) throw new Error(`Error creating raw transaction: ${crtRes.error}`);

      let finalTx = crtRes.data;
      if (payload) {
        const crtxoprRes = await this.rpcCall("tl_createrawtx_opreturn", [finalTx, payload]);
        if (crtxoprRes.error || !crtxoprRes.data) throw new Error(`Error adding OP_RETURN: ${crtxoprRes.error}`);
        finalTx = crtxoprRes.data;
      }

      const result: any = { rawtx: finalTx, inputs: finalInputs };
      if (addPsbt) {
        const psbtRes = { data: "" }; // Mocked
        //if (psbtRes.error || !psbtRes.data) throw new Error(`Error building PSBT: ${psbtRes.error}`);
        result.psbtHex = psbtRes.data;
      }

      return { data: result };
    } catch (error) {
      return { error: error.message || "Unknown error in buildTx" };
    }
  }

  async buildLTCITTx(buildTxConfig: IBuildLTCITTxConfig, isApiMode: boolean): Promise<any> {
    try {
      const { buyerKeyPair, sellerKeyPair, amount, payload, commitUTXOs, network } = buildTxConfig;
      const buyerAddress = buyerKeyPair.address;
      const sellerAddress = sellerKeyPair.address;

      // Validate Addresses
      const vaRes1 = await this.rpcCall("validateaddress", [buyerAddress]);
      if (vaRes1.error || !vaRes1.data?.isvalid) throw new Error(`Invalid address: ${buyerAddress}`);

      const vaRes2 = await this.rpcCall("validateaddress", [sellerAddress]);
      if (vaRes2.error || !vaRes2.data?.isvalid) throw new Error(`Invalid address: ${sellerAddress}`);

      // List Unspent
      const luRes = await this.rpcCall("listunspent", [0, 9999999, [buyerAddress]]);
      if (luRes.error || !luRes.data) throw new Error(`Error listing UTXOs: ${luRes.error}`);
      const utxos = [...commitUTXOs, ...luRes.data];

      // Calculate Inputs and Outputs
      const buyerLtcAmount = 0.0000546; // Mock value
      const sellerLtcAmount = Math.max(amount, buyerLtcAmount);
      const { finalInputs, fee } = this.getEnoughInputs2(utxos, buyerLtcAmount + sellerLtcAmount);
      const inputsSum = safeNumber(finalInputs.reduce((sum, input) => sum + input.amount, 0));
      const change = safeNumber(inputsSum - sellerLtcAmount - fee);

      if (inputsSum < safeNumber(fee + sellerLtcAmount + change)) throw new Error("Insufficient funds.");

      // Create Raw Transaction
      const insForRawTx = finalInputs.map(({ txid, vout }) => ({ txid, vout }));
      const outsForRawTx: Record<string, number> = {
        [buyerAddress]: change,
        [sellerAddress]: sellerLtcAmount,
      };

      const crtRes = await this.rpcCall("createrawtransaction", [insForRawTx, outsForRawTx]);
      if (crtRes.error || !crtRes.data) throw new Error(`Error creating raw transaction: ${crtRes.error}`);

      const crtxoprRes = await this.rpcCall("tl_createrawtx_opreturn", [crtRes.data, payload]);
      if (crtxoprRes.error || !crtxoprRes.data) throw new Error(`Error adding OP_RETURN: ${crtxoprRes.error}`);

      const psbtRes = { data: "" }; // Mocked
      return { data: { rawtx: crtxoprRes.data, psbtHex: psbtRes.data, inputs: finalInputs } };
    } catch (error) {
      return { error: error.message || "Unknown error in buildLTCITTx" };
    }
  }

  private getEnoughInputs(utxos: IInput[], amount: number) {
    const finalInputs: IInput[] = [];
    let total = 0;

    for (const utxo of utxos) {
      if (total >= amount) break;
      finalInputs.push(utxo);
      total += utxo.amount;
    }

    const fee = safeNumber(0.2 * minFeeLtcPerKb * finalInputs.length);
    return { finalInputs, fee };
  }

  private getEnoughInputs2(utxos: IInput[], amount: number) {
    const finalInputs: IInput[] = [];
    let total = 0;

    for (const utxo of utxos) {
      if (total >= amount) break;
      finalInputs.push(utxo);
      total += utxo.amount;
    }

    const fee = safeNumber(0.2 * minFeeLtcPerKb * finalInputs.length);
    return { finalInputs, fee };
  }

  //async signPBST()
}
