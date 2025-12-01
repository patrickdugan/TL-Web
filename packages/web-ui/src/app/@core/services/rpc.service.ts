import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { ApiService } from "./api.service";
import { SocketService } from "./socket.service";
import { DialogService } from "./dialogs.service";
import { LoadingService } from "./loading.service";
import { BehaviorSubject } from "rxjs";
import { IUTXO } from 'src/app/@core/services/txs.service';
import { environment } from 'src/environments/environment';


export type TNETWORK = 'BTC' | 'LTC' | 'LTCTEST' | null;
export enum ENetwork  { BTC = 'BTC', LTC = 'LTC', LTCTEST = 'LTCTEST' }

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
    wif?: string; // Add this
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
    providedIn: 'root',
})

export class RpcService {
  private _NETWORK: TNETWORK = null;
  private _stoppedByTerminated: boolean = false;

  isCoreStarted: boolean = false;
  isAbleToRpc: boolean = false;

  isTLStarted: boolean = false;
  latestTlBlock: number = 0;

  lastBlock: number = 0;
  headerBlock: number = 0;
  networkBlocks: number = 0;
  isNetworkSelected: boolean = true;

  blockSubs$: BehaviorSubject<IBlockSubsObj> = new BehaviorSubject({
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
    ) {}

    onInit() {
      const ep = environment.ENDPOINTS.LTCTEST;

  // ✅ set URLs on ApiService (that's where they live)
  this.apiService.apiUrl       = ep.relayerUrl;
  this.apiService.orderbookUrl = ep.orderbookApiUrl;

  // ✅ OB socket connect (this method exists)
  this.socketService.obSocketConnect(ep.orderbookApiUrl);

  // ❌ this.socketService.wsConnect(...)  ← remove (you don’t have that method)
  // If you later add a relayer WS, call the correct method name here.

  // ✅ set network + mark selected
  this.NETWORK = 'BTC';
  this.isNetworkSelected = true;

  // pull header / network info after URLs are set
  this.checkNetworkInfo();
      setInterval(() => this.checkNetworkInfo(), 8000);
    }

    get isSynced() {
      return true //this.headerBlock && this.lastBlock + 1 >= this.headerBlock /*&& this.latestTlBlock + 1 >= this.headerBlock;*/
    }

    get NETWORK() {
      return this._NETWORK;
    }

    set NETWORK(value: TNETWORK) {
      this.apiService.network = value;
      this.apiService.apiUrl = null;
      this.apiService.orderbookUrl = null;
      this.headerBlock = 0;
      this._NETWORK = value
      this.isNetworkSelected = true; // add this line;
    }

    get socket() {
      return //this.socketService.socket;
    }

    get mainApi() {
      return this.apiService.mainApi;
    }

    get tlApi() {
      return this.apiService.tlApi;
    }
  
    get isApiMode() {
      return true;
      // return !this.isCoreStarted || !this.isSynced || !this.lastBlock;
    }

    async startWalletNode(
      path: string,
      network: ENetwork,
      flags: { reindex: boolean, startclean: boolean },
    ) {
      return
      /*this.NETWORK = network;
      if (this.NETWORK !== network) throw new Error("Please first Change the Network");
      return await this.mainApi
        .startWalletNode(path, network, flags)
        .toPromise()
        .then(res => {
          if (res.data) {
            this.isCoreStarted = true;
            this.dialogService.closeAllDialogs();
          }
          return res;
        });*/
    }

    async createNewNode(params: { username: string, password: string, port: number, path: string }) {
      return//await this.mainApi.createNewConfFile(params).toPromise();
    }

    async checkNetworkInfo() {
      if (!this.NETWORK) return;
      if (!this.apiService.apiUrl) return;
      try {
          const infoRes = await this.tlApi.rpc('getblockchaininfo').toPromise();
          if (infoRes.error || !infoRes.data) throw new Error(infoRes.error);
          if (infoRes.data.blocks && infoRes.data.blocks !== this.networkBlocks) {
            this.networkBlocks = infoRes.data.blocks;
            const blockSubsObj: IBlockSubsObj = { type: "API", block: infoRes.data.blocks, header: infoRes.data.headers };
            this.blockSubs$.next(blockSubsObj);
            console.log(`New Network Block: ${this.networkBlocks}`);
          }
      } catch(err: any) {
          this.toastrService.error(err.message || err || 'Undefined Error', 'API Server Disconnected');
          this.apiService.apiUrl = null;
          throw(err);
      }
    }

    async terminateNode() {
      return /*await this.mainApi.stopWalletNode().toPromise()
        .then(res => {
          this.clearRpcConnection();
          this._stoppedByTerminated = true;
          return res;
        })
        .catch(err => {
          this.toastrService.error('Error with stopping Node', err?.message || err);
        });*/
    }

    private clearRpcConnection() {
      this.isAbleToRpc = false;
      this.isCoreStarted = false;
      this.lastBlock = 0;
    }

    rpc(method: string, params?: any[]) {
      //return this.mainApi.rpcCall(method, params).toPromise();;
       return this.tlApi.rpc(method, params).toPromise()//this.isApiMode
         //? 
         //: this.mainApi.rpcCall(method, params).toPromise();
    }
  }