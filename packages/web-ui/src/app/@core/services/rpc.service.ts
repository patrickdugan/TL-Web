import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { SocketService } from "./socket.service";
import { DialogService } from "./dialogs.service";
import { LoadingService } from "./loading.service";
import { BehaviorSubject } from "rxjs";
import { IUTXO } from "src/app/@core/services/txs.service";
import { environment } from "src/environments/environment";

export type TNETWORK = "BTC" | "LTC" | "LTCTEST" | null;
export enum ENetwork {
  BTC = "BTC",
  LTC = "LTC",
  LTCTEST = "LTCTEST",
}

export interface IBlockSubsObj {
  type: "API" | "LOCAL";
  block: number;
  header: number;
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
  network?: TNETWORK;
}

export interface ISignPsbtConfig {
  psbtHex: string;
  redeem: string;
  network?: string;
  wif?: string;
}

export interface ISignTxConfig {
  rawtx: string;
  wif: string;
  inputs: IUTXO[];
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
  network?: TNETWORK;
}

@Injectable({
  providedIn: "root",
})
export class RpcService {
  private _NETWORK: TNETWORK = null;
  private _stoppedByTerminated = false;

  isCoreStarted = false;
  isAbleToRpc = false;
  isTLStarted = false;
  latestTlBlock = 0;

  lastBlock = 0;
  headerBlock = 0;
  networkBlocks = 0;
  isNetworkSelected = true;

  blockSubs$ = new BehaviorSubject<IBlockSubsObj>({
    type: this.isApiMode ? "API" : "LOCAL",
    block: this.isApiMode ? this.networkBlocks : this.lastBlock,
    header: this.headerBlock,
  });

  constructor(
    private apiService: ApiService,
    private socketService: SocketService,
    private dialogService: DialogService,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
  ) {
    console.log("[RpcService] instance id", Math.random());
  }

  private applyNetworkEndpoints(network: TNETWORK): void {
    const key = (network || "BTC") as keyof typeof environment.ENDPOINTS;
    const endpoint = environment.ENDPOINTS[key];
    if (!endpoint) return;
    this.apiService.network = network;
    this.apiService.apiUrl = endpoint.relayerUrl;
    this.apiService.orderbookUrl = endpoint.orderbookApiUrl;
  }

  onInit() {
    const network = this.NETWORK || "BTC";
    this.applyNetworkEndpoints(network);
    this.socketService.obSocketConnect(
      environment.ENDPOINTS[network]?.orderbookApiUrl || environment.ENDPOINTS.BTC.orderbookApiUrl,
    );
    this.isNetworkSelected = true;
    this.checkNetworkInfo();
    setInterval(() => this.checkNetworkInfo(), 8000);
  }

  get isSynced() {
    return true;
  }

  get NETWORK() {
    return this._NETWORK;
  }

  set NETWORK(value: TNETWORK) {
    const next = value || "BTC";
    this.applyNetworkEndpoints(next);
    this.headerBlock = 0;
    this._NETWORK = next;
    this.isNetworkSelected = true;
  }

  get socket() {
    return;
  }

  get mainApi() {
    return this.apiService.mainApi;
  }

  get tlApi() {
    return this.apiService.tlApi;
  }

  get isApiMode() {
    return true;
  }

  async startWalletNode(
    path: string,
    network: ENetwork,
    flags: { reindex: boolean; startclean: boolean },
  ) {
    return;
  }

  async createNewNode(params: { username: string; password: string; port: number; path: string }) {
    return;
  }

  async checkNetworkInfo() {
    if (!this.NETWORK) return;
    if (!this.apiService.apiUrl) return;
    try {
      const infoRes = await this.tlApi.rpc("getblockchaininfo").toPromise();
      if (infoRes.error || !infoRes.data) throw new Error(infoRes.error);
      if (infoRes.data.blocks && infoRes.data.blocks !== this.networkBlocks) {
        this.networkBlocks = infoRes.data.blocks;
        const blockSubsObj: IBlockSubsObj = {
          type: "API",
          block: infoRes.data.blocks,
          header: infoRes.data.headers,
        };
        this.blockSubs$.next(blockSubsObj);
        console.log(`New Network Block: ${this.networkBlocks}`);
      }
    } catch (err: any) {
      this.toastrService.error(err.message || err || "Undefined Error", "API Server Disconnected");
      this.apiService.apiUrl = null;
      throw err;
    }
  }

  async terminateNode() {
    return;
  }

  private clearRpcConnection() {
    this.isAbleToRpc = false;
    this.isCoreStarted = false;
    this.lastBlock = 0;
  }

  rpc(method: string, params?: any[]) {
    return this.tlApi.rpc(method, params).toPromise();
  }
}
