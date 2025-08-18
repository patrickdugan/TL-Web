import { ToastrService } from "ngx-toastr";
import { AuthService } from "../auth.service";
import { BalanceService } from "../balance.service";
import { RpcService } from "../rpc.service";
import { Injectable } from '@angular/core';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';

export interface IChannelCommit {
    amount: number;
    block: number;
    channel: string;
    propertyId: number;
    sender: string;
    tokenName: string;
}


interface ChannelBalanceRow {
  channel: string;
  column: 'A' | 'B';
  propertyId: number;
  amount: number;
  participants?: { A?: string; B?: string };
  counterparty?: string;
  lastCommitmentBlock?: number;
}

interface ChannelBalancesResponse {
  total: number;
  rows: ChannelBalanceRow[];
}


@Injectable({
    providedIn: 'root',
})

export class SpotChannelsService {
    private _channelsCommits: IChannelCommit[] = [];
    private url = "https://api.layerwallet.com";

    constructor(
        private rpcService: RpcService,
        private authService: AuthService,
        private toastrService: ToastrService,
        private balanceService: BalanceService,
        private http: HttpClient
    ) { }

    get channelsCommits() {
        return this._channelsCommits;
    }

     getChannelBalances(address: string, propertyId?: number): Observable<ChannelBalancesResponse> {
    let params = new HttpParams().set('address', address);
    if (propertyId !== undefined && propertyId !== null) {
      params = params.set('propertyId', String(propertyId));
    }
  
    return this.http.post<ChannelBalancesResponse>(
   `${this.url}/rpc/tl_channelBalanceForCommiter`,{address:address,propertyId:propertyId}
    ).pipe(
      map(res => ({
        total: res?.total ?? 0,
        rows: (res?.rows ?? []).map(r => ({
          ...r,
          counterparty: r.counterparty ?? (r.column === 'A' ? r.participants?.B : r.participants?.A) ?? ''
        }))
      }))
    );
  }

    get activeSpotaddress() {
        return this.authService.activeSpotKey?.address || null;
    }

    async updateOpenChannels() {
        try {
            if (!this.activeSpotaddress) {
                this._channelsCommits = [];
                return;
            }
            const commitsRes = await this.rpcService.rpc('tl_check_commits', [this.activeSpotaddress]);
            if (commitsRes.error || !commitsRes.data) throw new Error(`tl_check_commits: ${commitsRes.error}`);
            const promiseArray = commitsRes.data.map(async (q: any) => {
                return {
                    amount: parseFloat(q.amount),
                    propertyId: parseFloat(q.propertyId),
                    block: q.block,
                    channel: q.channel,
                    sender: q.sender,
                    tokenName: await this.balanceService.getTokenNameById(parseFloat(q.propertyId)),
                };
            });
            this._channelsCommits = await Promise.all(promiseArray);
        } catch (err: any) {
            this.toastrService.warning(err.message);
        }
    }

    removeAll() {
        this._channelsCommits = [];
    }
}