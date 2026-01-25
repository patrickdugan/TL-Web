// src/app/@core/services/futures-services/futures-channels.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { AuthService } from 'src/app/@core/services/auth.service';
import { FuturesMarketService } from 'src/app/@core/services/futures-services/futures-markets.service';
import { RpcService } from '../rpc.service';

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

type FutOverride = {
  address?: string;
  contractId?: number;
  collateralPropertyId?: number;
};

@Injectable({ providedIn: 'root' })
export class FuturesChannelsService {
  public channelsCommits: ChannelBalanceRow[] = [];

  private refreshMs = 20000;
  private pollId?: any;
  private isLoading = false;

  private baseUrl = 'https://api.layerwallet.com';
  private testUrl = 'https://testnet-api.layerwallet.com';

  private __rows$ = new BehaviorSubject<ChannelBalanceRow[]>([]);
  private __override: FutOverride | null = null;

  private abort?: AbortController;

  constructor(
    private authService: AuthService,
    private futMarkets: FuturesMarketService,
    private rpcService: RpcService
  ) {}

  /* ---------------- helpers ---------------- */

  private get relayerUrl(): string {
    return String(this.rpcService.NETWORK).includes('TEST')
      ? this.testUrl
      : this.baseUrl;
  }

  private get __rows__() {
    return this.__rows$;
  }

  /* ---------------- polling ---------------- */

  refreshFuturesChannels(): void {
    this.refreshNow();
  }

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

  refreshNow(): void {
    this.loadOnce();
  }

  setRefreshMs(ms: number): void {
    this.refreshMs = Math.max(1000, ms | 0);
    if (this.pollId) this.startPolling(this.refreshMs);
  }

  /* ---------------- core fetch ---------------- */

  public async loadOnce(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      // cancel any in-flight request
      this.abort?.abort();
      this.abort = new AbortController();

      const addr =
        this.__override?.address ??
        this.authService.walletAddresses?.[0];

      const mAny = this.futMarkets?.selectedMarket as any;
      const { collateralPropertyId } = this.extractIds(mAny);

      if (!addr || collateralPropertyId == null) {
        this.channelsCommits = [];
        this.__rows__.next([]);
        return;
      }

      const url = `${this.relayerUrl}/rpc/tl_channelBalanceForCommiter`;
      const body = { params: [addr, Number(collateralPropertyId)] };

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: this.abort.signal,
      });

      if (!r.ok) throw new Error(`HTTP ${r.status}`);

      const data: ChannelBalancesResponse = await r.json();
      const rawRows = Array.isArray(data?.rows) ? data.rows : [];

      const rows = rawRows.map((row: any) =>
        this.normalizeRow(row, addr, { collateralPropertyId })
      );

      this.channelsCommits = rows.slice();
      this.__rows__.next(this.channelsCommits);
    } catch (err: any) {
      if (err?.name !== 'AbortError') {
        console.error('[futures-channels] load error:', err);
        this.channelsCommits = [];
        this.__rows__.next([]);
      }
    } finally {
      this.isLoading = false;
    }
  }

  /* ---------------- utils ---------------- */

  private extractIds(m: any): {
    contractId?: number;
    collateralPropertyId?: number;
  } {
    const contractId =
      m?.contractId ??
      m?.contract?.id ??
      m?.contract?.propertyId ??
      m?.propertyId ??
      m?.id;

    const collateralPropertyId =
      m?.collateralPropertyId ??
      m?.collateral?.propertyId ??
      m?.marginAsset?.propertyId ??
      m?.collateralId;

    return {
      contractId:
        contractId !== undefined && contractId !== null
          ? Number(contractId)
          : undefined,
      collateralPropertyId:
        collateralPropertyId !== undefined && collateralPropertyId !== null
          ? Number(collateralPropertyId)
          : undefined,
    };
  }

  private normalizeRow(
    r: any,
    addr: string,
    defaults: { collateralPropertyId?: number }
  ): ChannelBalanceRow {
    const participants: { A?: string; B?: string } =
      r?.participants ?? {
        A: r?.participantA ?? r?.A ?? r?.partyA,
        B: r?.participantB ?? r?.B ?? r?.partyB,
      };

    let column: 'A' | 'B';
    if (r?.column === 'A' || r?.column === 'B') column = r.column;
    else if (participants?.A === addr) column = 'A';
    else if (participants?.B === addr) column = 'B';
    else column = 'A';

    const counterparty = column === 'A'
      ? participants?.B
      : participants?.A;

    const pidRaw = r?.propertyId ?? r?.collateralPropertyId;
    const propertyId =
      pidRaw !== undefined && pidRaw !== null
        ? Number(pidRaw)
        : defaults.collateralPropertyId ?? 0;

    const amount = Number(r?.amount ?? r?.balance ?? r?.value ?? 0);
    const lcb = Number(
      r?.lastCommitmentBlock ?? r?.block ?? r?.height ?? NaN
    );

    const channelId =
      r?.channel ??
      r?.channelId ??
      (participants?.A || participants?.B
        ? `${participants?.A ?? ''}:${participants?.B ?? ''}`
        : 'unknown');

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
}
