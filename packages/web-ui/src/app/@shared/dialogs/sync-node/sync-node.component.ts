import { Component, NgZone, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { ApiService } from 'src/app/@core/services/api.service';
import { AuthService } from 'src/app/@core/services/auth.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
//import { ElectronService } from 'src/app/@core/services/electron.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { ENetwork, RpcService } from 'src/app/@core/services/rpc.service';

@Component({
  selector: 'sync-node-dialog',
  templateUrl: './sync-node.component.html',
  styleUrls: ['./sync-node.component.scss']
})
export class SyncNodeDialog implements OnInit, OnDestroy {
    readyPercent: number = 0;
    readyPercentTl: number = 0;

    message: string = '';
    tlMessage: string = '';

    eta: string = 'Calculating Remaining Time ...';

    prevEtaData: {
        stamp: number;
        blocks: number;
    } = {
        stamp: 0,
        blocks: 0,
    };

    private checkIntervalFunc: any;

    // Add this variable to prevent multiple sync processes from running simultaneously
    private isCheckingSync: boolean = false;


    constructor(
        private rpcService: RpcService,
        private apiService: ApiService,
        private loadingService: LoadingService,
        //private electronService: ElectronService,
        private zone: NgZone,
        private dialogService: DialogService,
        private router: Router,
        private toastrService: ToastrService,
        private authService: AuthService,
    ) {}

    get coreStarted() {
        return this.rpcService.isCoreStarted;
    }

    get isSynced() {
        return this.rpcService.isSynced;
    }

    get nodeBlock() {
        return this.rpcService.lastBlock;
    }

    get networkBlocks() {
        return this.rpcService.networkBlocks;
    }

    get isAbleToRpc() {
        return this.rpcService.isAbleToRpc;
    }

    get headerBlock() {
        return this.rpcService.headerBlock;
    }

    get tlStarted() {
        return this.rpcService.isTLStarted;
    }

    get tlBlock() {
        return this.rpcService.latestTlBlock;
    }

    ngOnInit() { }

      private async checkSyncThrottled(): Promise<void> {
       if (this.isCheckingSync) {
           console.log('Sync check already in progress, skipping...');
           return;
       }

       this.isCheckingSync = true; // Lock the function
       try {
           console.log('Starting sync process...'); // Your console log to track sync start
           await this.checkSync(); // Actual sync logic
           console.log('Sync process completed successfully.'); // Log after the sync completes
       } catch (error) {
           console.error('Error during sync process:', error); // In case there is an error
       } finally {
           this.isCheckingSync = false; // Unlock the function after the sync is done
       }
    }

    private checFunction() {
        this.checkSyncThrottled(); // First run
        this.checkIntervalFunc = setInterval(() => this.checkSyncThrottled(), 5000); // Continue at intervals
    }

    private countETA(etaData: { stamp: number; blocks: number; }) {
        const prevStamp = this.prevEtaData.stamp;
        const prevBlocks = this.prevEtaData.blocks;
        const currentStamp = etaData.stamp;
        const currentBlocks = etaData.blocks;
        this.prevEtaData = etaData;
        if (!prevBlocks || !prevStamp || !currentStamp || !currentBlocks) return;
        const blocksInterval = currentBlocks - prevBlocks;
        const stampInterval = currentStamp - prevStamp;
        const msPerBlock = Math.round(stampInterval / blocksInterval);
        const remainingBlocks = this.networkBlocks - currentBlocks;
        const remainingms = msPerBlock * remainingBlocks;
        const minutes = Math.floor((remainingms / (1000 * 60)) % 60);
        const hours = Math.floor((remainingms / (1000 * 60 * 60)));
        if (remainingms > 0 && remainingms < 604800000 ) {
            const message =  hours > 0 ? `${hours} hours ${minutes} minutes` : `${minutes} minutes`;
            this.eta = `Remaining ~ ${message}`;
        } else {
            this.eta = 'Calculating Remaining Time ...';
        }
    }

    private async checkTradelayerSync() {
        /*console.log('checking tl flag this sync '+this.rpcService.isTLStarted)
        console.log(Boolean(!this.rpcService.isTLStarted&&this.rpcService.isAbleToRpc == true))
        try {
            if (!this.isAbleToRpc || !this.nodeBlock) return;
            if (!this.rpcService.isTLStarted&&this.rpcService.isAbleToRpc == true){
                const result = await this.apiService.mainApi.initTradeLayer().toPromise();
                console.log('TL Wallet Listener init result: '+JSON.stringify(result))
                 // Adding a delay of 10 seconds between initTradeLayer and the next call
                await new Promise(resolve => setTimeout(resolve, 3000));  // 3-second delay

                if (result &&result.result==true&&!this.rpcService.isTLStarted) {
                    console.log('Initialization of listener succeeded');
                        const initRes = await this.apiService.newTlApi.rpc('init').toPromise();
                        if (initRes.error || !initRes.data) {
                            console.log('issue with init resolution '+JSON.stringify(initRes))
                            throw new Error(initRes.error || 'Undefined Error');
                        }
                        this.rpcService.isTLStarted = true;
                }
               
            }
            
            const blockHeightRes = await this.apiService.newTlApi.rpc('getMaxParsedHeight').toPromise();
            if (blockHeightRes.error) {
                throw new Error(blockHeightRes.error || 'Undefined Error');
            }

            this.rpcService.latestTlBlock = blockHeightRes.data;
            this.readyPercentTl = parseFloat((this.tlBlock / this.headerBlock).toFixed(2)) * 100;
            this.tlMessage = "Parsing TradeLayer transactions"
            return
        } catch (error: any) {
           console.log('error calling init '+JSON.stringify(error))
            const errorMessage = error?.message || error || "Undefined Error";
            //this.tlMessage = errorMessage;
        }*/
        return null
    }

    private async checkIsAbleToRpcLoop() {
        let attempts = 0;
        const maxAttempts = 50; // You can increase this if you need a longer wait

        while (!this.isAbleToRpc && attempts < maxAttempts) {
            attempts++;
            console.log(`Checking RPC connection, attempt ${attempts}`);
            await this.checkIsAbleToRpc(); // Attempt to set the RPC flag

            if (!this.isAbleToRpc) {
                await new Promise(resolve => setTimeout(resolve, 5000)); // Wait 2 seconds before retrying
            }
        }

        if (!this.isAbleToRpc) {
            throw new Error("Unable to establish RPC connection after multiple attempts.");
        }
    }


    private async checkSync() {
        await this.checkIsAbleToRpcLoop(); // Keep checking until RPC is ready
        this.countETA({ stamp: Date.now(), blocks: this.nodeBlock });
        this.readyPercent = parseFloat((this.nodeBlock / this.headerBlock).toFixed(2)) * 100;

        await this.checkTradelayerSync();
    }

    private async checkIsAbleToRpc() {
        /*try {
            if (this.isAbleToRpc || !this.coreStarted) return;
            const res = await this.apiService.mainApi.rpcCall('getblockchaininfo').toPromise();
            if (res.error) this.message = res.error;
            if (!res.error && res.data) {
                this.rpcService.isAbleToRpc = true;
                this.message = '';
            }
        } catch (error: any) {
            const errrorMessage = error?.message || error || "Undefined Error";
            this.message = errrorMessage;
        }*/

        return null
    }

    async terminate() {
        if (this.authService.isLoggedIn) {
            this.toastrService.warning('Please first logout');
            return;
        }
        if (!this.isAbleToRpc) return;
        this.loadingService.isLoading = true;
        const terminateRes = await this.rpcService.terminateNode();
        clearInterval(this.checkIntervalFunc);
        this.message = ' ';
    }

    ngOnDestroy() {
        clearInterval(this.checkIntervalFunc);
    }

    // ------
    public _defaultDirectoryCheckbox: boolean = true;
    public directory: string = '';
    public reindex: boolean = false;
    public startclean: boolean = false;
    public showAdvanced: boolean = false;
    public network: ENetwork = this.rpcService.NETWORK as ENetwork;

    get defaultDirectoryCheckbox() {
        return this._defaultDirectoryCheckbox;
    }

    set defaultDirectoryCheckbox(value: boolean) {
        this.directory = '';
        this._defaultDirectoryCheckbox = value;
    }

    openDirSelectDialog() {
        //this.electronService.emitEvent('open-dir-dialog');
        /*this.electronService.ipcRenderer.once('angular-electron-message', (_: any, message: any) => {
            const { event, data } = message;
            if (event !== 'selected-dir' || !data ) return;
            this.zone.run(() => this.directory = data || '');
        });*/
    }

    toggleAdvanced() {
        this.showAdvanced = !this.showAdvanced;
        if (!this.showAdvanced) {
        this.reindex = false;
        this.startclean = false;
        }    
    }

    async startWalletNode() {
        return null
        /*const network = this.network;
        if (!network) return;
        const path = this.defaultDirectoryCheckbox ? '' : this.directory;
        const { reindex, startclean } = this;
        const flags = { reindex, startclean };
        this.loadingService.isLoading = true;
        await this.rpcService.startWalletNode(path, ENetwork[network], flags)
        .then(async res => {
            if (res.error || !res.data) {
            const configError = res.error.includes("Config file") && res.error.includes("doesn't exist in");
            if (configError) {
                this.dialogService.openDialog(DialogTypes.NEW_NODE, { data: { path }});
            } else {
                this.toastrService.error(res.error || 'Undefined Error', 'Starting Node Error');
            }
            } else {

                this.router.navigateByUrl('/');
                await this.checkIsAbleToRpc();
            }
        })
        .catch(error => {
            this.toastrService.error(error.message || 'Undefined Error', 'Error request');
        })
        .finally(() => {
            this.checFunction();
            this.loadingService.isLoading = false;
            this.eta = 'Calculating Remaining Time ...';
        });
        */
    }
}
