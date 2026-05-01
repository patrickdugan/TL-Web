// PATCHED WEB VERSION - futures-positions.service.ts
// Changes: Uses relayer API (https://ws.layerwallet.com/relayer/rpc/tl_getContractPosition)
// Removes: Mempool scanning (desktop-only feature)
// Keeps: Web-specific axios patterns

import { Injectable } from "@angular/core";
import { ToastrService } from "ngx-toastr";
import { AuthService } from "../auth.service";
import { RpcService } from "../rpc.service";
import { ApiService } from "../api.service";
import { Subscription } from 'rxjs';
import { RelayerWsService } from "../relayer-ws.service";

export interface IPosition {
    entry_price: string;
    position: string;
    BANKRUPTCY_PRICE: string;
    position_margin: string;
    upnl: string;
}

@Injectable({
    providedIn: 'root',
})
export class FuturesPositionsService {
    private _openedPosition: IPosition | null = null;
    private _selectedContractId: string | null = null;
    private subs$: Subscription | null = null;
    private baseUrl = "https://ws.layerwallet.com/relayer";
  	private testUrl = "https://ws.layerwallet.com/relayer"
  	private network = this.rpcService.NETWORK
  	private _pendingPositionDelta: number = 0;
	private _pendingUpnlDelta: number = 0;

	pendingPositionDeltaByContract: Record<number, number> = {};
	private get relayerUrl(): string {
	  return String(this.rpcService.NETWORK).includes("TEST")
	    ? this.testUrl
	    : this.baseUrl;
	}

    constructor(
        private rpcService: RpcService,
        private authService: AuthService,
        private toastrService: ToastrService,
        private apiService: ApiService,
        private relayerWsService: RelayerWsService,
    ) {}

    get pendingPositionDelta() {
        return this._pendingPositionDelta;
    }

    get pendingUpnlDelta() {
        return this._pendingUpnlDelta;
    }

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
          this.relayerWsService.setBaseUrl(this.relayerUrl);
	        const res = await this.relayerWsService.request<any>(`/rpc/tl_contractPosition`, {
            method: "POST",
            body: {
              params: [{
                address,
                contractId
              }]
            }
          });

	        const raw = res?.data ?? res;

	        if (raw?.error || !raw) {
	            this.toastrService.error(
	                raw?.error || 'Error getting opened position',
	                'Error'
	            );
	            this.openedPosition = null;
	            return;
	        }

	        const positionValue = Number(raw.contracts || 0);

	        if (positionValue) {
	            this.openedPosition = {
	                position: raw.contracts,
	                entry_price: raw.avgPrice,
	                BANKRUPTCY_PRICE: raw.bankruptcyPrice,
	                position_margin: raw.margin,
	                upnl: raw.unrealizedPNL,
	            };
	        } else {
	            this.openedPosition = null;
	        }
	    } catch (err) {
	        console.error('❌ RPC error in updatePositions:', err);
	        this.toastrService.error('Network error fetching position', 'Error');
	    }
	}

	async scanMempoolPending() {
 	  if (!this.activeFutureAddress || !this.selectedContractId) {
	    this.clearPending();
	    return;
	  }

	  const cid = Number(this.selectedContractId);

	  try {
      this.relayerWsService.setBaseUrl(this.relayerUrl);
	    const mempoolRes = await this.relayerWsService.request<any>(`/rpc/getrawmempool`, {
        method: "POST",
        body: { params: [true] }
      });

	    const mempool = mempoolRes?.data ?? mempoolRes;
	    const txids = Object.keys(mempool || {});

	    if (!txids.length) {
	      this.clearPending();
	      return;
	    }

	    let count = 0;
	    let checked = 0;
	    const limit = Math.min(txids.length, 80);

	    for (const txid of txids.slice(0, limit)) {
	      try {
	        const txRes = await this.relayerWsService.request<any>(`/rpc/getrawtransaction`, {
            method: "POST",
            body: { params: [txid, true] }
          });

	        checked++;

	        const tx = txRes?.data ?? txRes;
	        if (!tx) continue;

	        const channelAddress =
	          tx?.vin?.[0]?.address ??
	          tx?.vin?.[0]?.prevout?.scriptPubKey?.address;

	        if (!channelAddress) continue;

	        const side = await this.resolveChannelSide(channelAddress);
	        if (!side) continue;

	        for (const v of tx?.vout || []) {
	          const asm = v?.scriptPubKey?.asm || '';
	          if (!asm.startsWith('OP_RETURN')) continue;

	          const hex = asm.split(' ')[1];
	          if (!hex) continue;

	          let payload: string;
	          try {
	            payload = this.hexToUtf8(hex);
	          } catch {
	            continue;
	          }

	          if (!payload.startsWith('tl')) continue;

	          const comma = payload.indexOf(',');
	          if (comma === -1) continue;

	          const parsedCid = parseInt(payload.slice(3, comma), 36);
	          if (parsedCid === cid) count++;
	        }

	        if (checked >= limit) {
	          this._pendingPositionDelta = count;
	          this.pendingPositionDeltaByContract[cid] = count;
	        }
	      } catch {
	        checked++;
	        if (checked >= limit) {
	          this._pendingPositionDelta = count;
	          this.pendingPositionDeltaByContract[cid] = count;
	        }
	      }
	    }
	  } catch (err) {
	    console.error('[MP] getrawmempool failed', err);
	    this.clearPending();
	  }
	}


	private async resolveChannelSide(
	    channelAddress: string
	): Promise<'A' | 'B' | null> {
	    try {
          this.relayerWsService.setBaseUrl(this.relayerUrl);
	        const res = await this.relayerWsService.request<any>(`/rpc/tl_getChannel`, {
            method: "POST",
            query: { address: channelAddress },
            body: { params: [] },
          });

	        const channel = res?.data ?? res;
	        const participants = channel?.participants ?? channel?.data?.participants;

	        if (!participants) {
	            return null;
	        }

	        const { A, B } = participants;

	        if (A === this.activeFutureAddress) return 'A';
	        if (B === this.activeFutureAddress) return 'B';

	        return null;
	    } catch (err) {
	        console.error('[CH] resolve failed', channelAddress, err);
	        return null;
	    }
	}

	private clearPending() {
	  const cid = Number(this.selectedContractId);
	  this._pendingPositionDelta = 0;
	  this._pendingUpnlDelta = 0;
	  if (Number.isFinite(cid)) {
	    delete this.pendingPositionDeltaByContract[cid];
	  }
	}

	private hexToUtf8(hex: string): string {
	  // strip optional 0x
	  const clean = hex.startsWith('0x') ? hex.slice(2) : hex;
	  if (clean.length % 2 !== 0) throw new Error('Invalid hex length');

	  const bytes = new Uint8Array(clean.length / 2);
	  for (let i = 0; i < clean.length; i += 2) {
	    bytes[i / 2] = parseInt(clean.slice(i, i + 2), 16);
	  }

	  return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
	}


}
