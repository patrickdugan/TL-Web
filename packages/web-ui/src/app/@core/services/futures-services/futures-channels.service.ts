import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { WalletService } from 'src/app/@core/services/wallet.service';
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

type FutOverride = { address?: string; contractId?: number; collateralPropertyId?: number };

@Injectable({ providedIn: 'root' })
export class FuturesChannelsService {
  /** UI binds to this */
  public channelsCommits: ChannelBalanceRow[] = [];

  /** polling */
  private refreshMs = 20000;
  private pollId?: any;
  private isLoading = false;

  /** endpoints */
  private readonly baseUrl = 'https://api.layerwallet.com';
  private readonly testUrl = 'https://testnet-api.layerwallet.com';

  private __rows$ = new BehaviorSubject<ChannelBalanceRow[]>([]);
  public readonly rows$: Observable<ChannelBalanceRow[]> = this.__rows$.asObservable();

  private __override: FutOverride | null = null;
  private accounts: { address: string; pubkey: string }[] = [];

  constructor(
    private walletService: WalletService,
    private futMarkets: FuturesMarketService,
    private rpcService: RpcService
  ) {}

  refreshFuturesChannels(): void {
    this.refreshNow();
  }

  /** Choose base/test URL based on CURRENT network (do not cache on field init) */
  private get relayerUrl(): string {
    const net = String((this.rpcService as any)?.NETWORK ?? '');
    return /TEST/i.test(net) ? this.testUrl : this.baseUrl;
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

  refreshNow(): void {
    this.loadOnce();
  }

  setRefreshMs(ms: number): void {
    this.refreshMs = Math.max(1000, ms | 0);
    if (this.pollId) this.startPolling(this.refreshMs);
  }

  // ---------- Core fetch ----------
  public async loadOnce(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const url = `${this.relayerUrl}/rpc/tl_channelBalanceForCommiter`;

      // --- address ---
      let addr: string | undefined = this.__override?.address;
      if (!addr) {
        const net = (this.rpcService as any)?.NETWORK ? String((this.rpcService as any).NETWORK) : undefined;
        const accounts = await this.walletService.requestAccounts(net);
        this.accounts = (accounts || []).map((a: any) => ({ address: a.address, pubkey: a.pubkey || '' }));
        addr = this.accounts[0]?.address;
      }

      // --- market ids ---
      const mAny = this.futMarkets?.selectedMarket as any;
      const fromMarket = this.extractIds(mAny);

      const contractId = this.__override?.contractId ?? fromMarket.contractId;
      const collateralPropertyId =
        this.__override?.collateralPropertyId ?? fromMarket.collateralPropertyId;

      const ok =
        !!addr &&
        contractId !== undefined &&
        Number.isFinite(Number(contractId)) &&
        collateralPropertyId !== undefined &&
        Number.isFinite(Number(collateralPropertyId));

      if (!ok) {
        this.channelsCommits = [];
        this.__rows$.next([]);
        return;
      }

      // NOTE: fetch POST is proven working in-browser for this endpoint
      const body = { params: [addr, Number(collateralPropertyId)] };

      const r = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!r.ok) {
        const text = await r.text().catch(() => '');
        throw new Error(`HTTP ${r.status} ${r.statusText} ${text}`);
      }

      const data: ChannelBalancesResponse | ChannelBalanceRow[] | any = await r.json();

      const rawRows: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];

      const rows = rawRows.map((row) =>
        this.normalizeRow(row, addr!, { collateralPropertyId: Number(collateralPropertyId) })
      );

      this.channelsCommits = rows.slice();
      this.__rows$.next(this.channelsCommits);
    } catch (err) {
      console.error('[futures-channels] load error:', err);
      this.channelsCommits = [];
      this.__rows$.next([]);
    } finally {
      this.isLoading = false;
    }
  }

  /**
   * FuturesMarketService selectedMarket shape (per your file):
   *   contract_id: number
   *   collateral: { propertyId: number }
   */
  private extractIds(m: any): { contractId?: number; collateralPropertyId?: number } {
    const cidRaw =
      m?.contract_id ??                   // ✅ canonical in your futures markets
      m?.contractId ??
      m?.contract?.id ??
      m?.contract?.contract_id ??
      m?.id;

    const collRaw =
      m?.collateral?.propertyId ??        // ✅ canonical in your futures markets
      m?.collateralPropertyId ??
      m?.collateral_id ??
      m?.collateralId ??
      m?.marginAsset?.propertyId;

    return {
      contractId: cidRaw !== undefined && cidRaw !== null ? Number(cidRaw) : undefined,
      collateralPropertyId: collRaw !== undefined && collRaw !== null ? Number(collRaw) : undefined,
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

  public setOverride(ov: FutOverride | null): void {
    this.__override = ov;
  }
}
