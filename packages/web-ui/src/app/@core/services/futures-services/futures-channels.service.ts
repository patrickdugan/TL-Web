// src/app/@core/services/futures-services/futures-channels.service.ts
import { Injectable } from '@angular/core';
import axios, { AxiosResponse } from 'axios';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from 'src/app/@core/services/auth.service';
import { WalletService } from 'src/app/@core/services/wallet.service';
import { FuturesMarketService } from 'src/app/@core/services/futures-services/futures-markets.service';
import { RpcService, TNETWORK } from "../rpc.service";

// NOTE: avoid import path issues by typing as any
type FuturesMarketSvc = any;

export interface ChannelBalanceRow {
  channel: string;
  column: 'A' | 'B';
  propertyId: number;
  amount: number;
  participants?: { A?: string; B?: string };
  counterparty?: string;
  lastCommitmentBlock?: number;
}

export interface ChannelBalancesResponse {
  total: number;
  rows: ChannelBalanceRow[];
}

type FutOverride = { address?: string; contractId?: number; collateralPropertyId?: number };

@Injectable({ providedIn: 'root' })
export class FuturesChannelsService {
  public channelsCommits: ChannelBalanceRow[] = [];

  private refreshMs = 20000;
  private pollId?: any;
  private isLoading = false;
  private baseUrl = "https://api.layerwallet.com";
  private testUrl = "https://testnet-api.layerwallet.com"

  private __rows$ = new BehaviorSubject<ChannelBalanceRow[]>([]);
  private __override: FutOverride | null = null;
  private accounts: { address: string; pubkey: string }[] = [];

  constructor(
    private auth: AuthService,
    private walletService: WalletService,
    private futMarkets: FuturesMarketService,
    private rpcService: RpcService
  ) {}

  refreshFuturesChannels(): void { this.refreshNow(); }

  private get relayerUrl(): string {
    return String(this.rpcService.NETWORK).includes("TEST")
      ? this.testUrl
      : this.baseUrl;
  }

  ngOnInit() {
    this.refreshFuturesChannels()
  }

  // ---------- Polling API ----------
  startPolling(ms: number = this.refreshMs): void {
    this.stopPolling();
    this.refreshMs = Math.max(1000, ms | 0);
    this.loadOnce();
    this.pollId = setInterval(() => this.loadOnce(), this.refreshMs);
  }

  stopPolling(): void {
    if (this.pollId) clearInterval(this.pollId);
    this.pollId = undefined;
  }

  refreshNow(): void { this.loadOnce(); }

  setRefreshMs(ms: number): void {
    this.refreshMs = Math.max(1000, ms | 0);
    if (this.pollId) this.startPolling(this.refreshMs);
  }

  // ---------- Core fetch ----------
  public async loadOnce(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      console.log('[futures-channels] Network:', this.rpcService.NETWORK);
      console.log('[futures-channels] Using URL:', this.relayerUrl);
      
      // Get address using WalletService like BalanceService does
      let addr: string | undefined;
      
      if (this.__override?.address) {
        addr = this.__override.address;
      } else {
        try {
          const network = this.rpcService.NETWORK ? String(this.rpcService.NETWORK) : undefined;
          console.log('[futures-channels] Requesting accounts for network:', network);
          const accounts = await this.walletService.requestAccounts(network);
          this.accounts = accounts.map((account) => ({
            address: account.address,
            pubkey: account.pubkey || '',
          }));
          addr = this.accounts[0]?.address;
          console.log('[futures-channels] Got address:', addr);
        } catch (error) {
          console.error('[futures-channels] Failed to get accounts:', error);
          this.channelsCommits = [];
          this.__rows$.next([]);
          return;
        }
      }

      const mAny = this.futMarkets?.selectedMarket as any;

      const fromMarket = this.extractIds(mAny);
      const contractId = this.__override?.contractId ?? fromMarket.contractId;
      const collateralPropertyId = this.__override?.collateralPropertyId ?? fromMarket.collateralPropertyId;

      console.log('[futures-channels] Contract ID:', contractId, 'Collateral ID:', collateralPropertyId);

      const ok =
        !!addr &&
        contractId !== undefined && Number.isFinite(Number(contractId)) &&
        collateralPropertyId !== undefined && Number.isFinite(Number(collateralPropertyId));

      if (!ok) {
        console.log('[futures-channels] Validation failed');
        this.channelsCommits = [];
        this.__rows$.next([]);
        return;
      }

      console.log('[futures-channels] Making request to:', `${this.relayerUrl}/rpc/tl_channelBalanceForCommiter`);
      console.log('[futures-channels] With params:', [addr, collateralPropertyId]);

      const res: AxiosResponse<ChannelBalancesResponse | ChannelBalanceRow[] | any> =
        await axios.post(`${this.relayerUrl}/rpc/tl_channelBalanceForCommiter`, {
          params: [addr, collateralPropertyId],
        });

      const data = res.data;
      const rawRows: any[] = Array.isArray(data) ? data : (Array.isArray(data?.rows) ? data.rows : []);
      const rows = rawRows.map(row => this.normalizeRow(row, addr!, { collateralPropertyId }));

      this.channelsCommits = rows.slice();
      this.__rows$.next(this.channelsCommits);
      console.log('[futures-channels] Success! Loaded', rows.length, 'rows');
    } catch (err) {
      console.error('[futures-channels] load error:', err);
      this.channelsCommits = [];
      this.__rows$.next([]);
    } finally {
      this.isLoading = false;
    }
  }

  private extractIds(m: any): { contractId?: number; collateralPropertyId?: number } {
    // Your market structure uses contract_id (from logs: {contract_id: 3, collateral: {...}})
    const cid = m?.contract_id ?? m?.contractId ?? m?.id;
    
    // Collateral is an object with propertyId
    const coll = m?.collateral?.propertyId ?? m?.collateralPropertyId ?? m?.collateralId;
    
    return {
      contractId: cid !== undefined && cid !== null ? Number(cid) : undefined,
      collateralPropertyId: coll !== undefined && coll !== null ? Number(coll) : undefined,
    };
  }

  private normalizeRow(
    r: any,
    addr: string,
    defaults: { collateralPropertyId?: number }
  ): ChannelBalanceRow {
    const participants: { A?: string; B?: string } = r?.participants ?? {
      A: r?.participantA ?? r?.A ?? r?.partyA,
      B: r?.participantB ?? r?.B ?? r?.partyB,
    };

    let column: 'A' | 'B';
    if (r?.column === 'A' || r?.column === 'B') column = r.column;
    else if (participants?.A && participants.A === addr) column = 'A';
    else if (participants?.B && participants.B === addr) column = 'B';
    else column = 'A';

    const counterparty = column === 'A' ? participants?.B : participants?.A;

    const pidRaw = r?.propertyId ?? r?.collateralPropertyId;
    const propertyId =
      pidRaw !== undefined && pidRaw !== null
        ? Number(pidRaw)
        : (defaults.collateralPropertyId !== undefined ? Number(defaults.collateralPropertyId) : 0);

    const amount = Number(r?.amount ?? r?.balance ?? r?.value ?? 0);
    const lcb = Number(r?.lastCommitmentBlock ?? r?.block ?? r?.height ?? NaN);

    const channelId =
      r?.channel ?? r?.channelId ??
      (participants?.A || participants?.B ? `${participants?.A ?? ''}:${participants?.B ?? ''}` : 'unknown');

    return {
      channel: String(channelId),
      column,
      propertyId,
      amount,
      participants,
      counterparty,
      lastCommitmentBlock: Number.isFinite(lcb) ? lcb : undefined,
    };
  }

  private get __rows__() { return this.__rows$; }
}