import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { AuthService } from "../auth.service";
import { RpcService } from "../rpc.service";
import { ApiService } from "../api.service";
import { Subscription } from 'rxjs';
import axios from 'axios';

export interface IPosition {
    "entry_price": string;
    "position": string;
    "BANKRUPTCY_PRICE": string;
    "position_margin": string;
    "upnl": string;
}

@Injectable({
    providedIn: 'root',
})

export class FuturesPositionsService {
    private _openedPosition: IPosition | null = null;
    private _selectedContractId: string | null = null;
    private subs$: Subscription | null = null;

    constructor(
        private rpcService: RpcService,
        private authService: AuthService,
        private toastrService: ToastrService,
        private apiService: ApiService,
    ) {}

    get selectedContractId(): string | null {
        return this._selectedContractId;
    }

    set selectedContractId(value: string | null) {
        this._selectedContractId = value;
    }

    get activeFutureAddress(): string | undefined {
                return this.authService.walletAddresses[0];
    }

    get tlApi() {
        return this.apiService.newTlApi;
    }

    get openedPosition(): IPosition | null {
        return this._openedPosition;
    }

    set openedPosition(value: IPosition | null) {
        this._openedPosition = value;
    }

    onInit() {
        if (this.subs$) return;

        this.subs$ = this.rpcService.blockSubs$.subscribe(block => {
            if (!this.activeFutureAddress || !this.selectedContractId) return;
            this.updatePositions();
        });
    }

async updatePositions() {
  if (!this.activeFutureAddress || !this.selectedContractId) return;

  const address = this.activeFutureAddress;
  const contractId = this.selectedContractId;

  try {
    const res = await axios.post('https://api.layerwallet.com/rpc/tl_getContractPosition', {
      params: [address, contractId]
    });

    console.log('position update ' + JSON.stringify(res.data));

    if (res.data?.error || !res.data?.data) {
      this.toastrService.error(res.data?.error || 'Error getting opened position', 'Error');
      this.openedPosition = null;
      return;
    }

    const raw = res.data;

    const positionValue = parseFloat(raw.contracts || "0");
            if (positionValue){
                this.openedPosition = {
                    position: raw.contracts,
                    entry_price: raw.avgPrice,
                    BANKRUPTCY_PRICE: raw.bankruptcyPrice,
                    position_margin: raw.margin,
                    upnl: raw.unrealizedPNL,
                };
            }else {
                this.openedPosition = null;
            }
  } catch (err) {
    console.error('❌ RPC error in updatePositions:', err);
    this.toastrService.error('Network error fetching position', 'Error');
  }
}

}
