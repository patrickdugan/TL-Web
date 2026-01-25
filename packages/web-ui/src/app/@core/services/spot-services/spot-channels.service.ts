import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable } from 'rxjs';
import { AuthService } from 'src/app/@core/services/auth.service';
import { WalletService } from 'src/app/@core/services/wallet.service';
import { SpotMarketsService } from 'src/app/@core/services/spot-services/spot-markets.service';
import { RpcService } from 'src/app/@core/services/rpc.service';

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

@Injectable({ providedIn: 'root' })
export class SpotChannelsService {
  /** UI binds to this */
  public channelsCommits: ChannelBalanceRow[] = [];

  /** polling */
  private refreshMs = 20000;
  private pollId?: any;
  private isLoading = false;

  /** relayer endpoints */
  private readonly baseUrl = 'https://api.layerwallet.com';
  private readonly testUrl = 'https://testnet-api.layerwallet.com';

  /** Store accounts like BalanceService */
  private accounts: { address: string; pubkey: string }[] = [];

  private __rows$ = new BehaviorSubject<ChannelBalanceRow[]>([]);
  public readonly rows$: Observable<ChannelBalanceRow[]> = this.__rows$.asObservable();

  constructor(
    private authService: AuthService,
    private walletService: WalletService,
    private spotMarkets: SpotMarketsService,
    private rpcService: RpcService
  ) {
    this.authService.updateAddressesSubs$?.subscribe(() => this.refreshNow());
    (this.spotMarkets as any).selectedMarket$?.subscribe?.(() => this.refreshNow());
    (this.spotMarkets as any).marketChange$?.subscribe?.(() => this.refreshNow());
  }

  /** relayer selector (mirrors FuturesChannelsService) */
  private get relayerUrl(): string {
    const net = String((this.rpcService as any)?.NETWORK ?? '');
    return /TEST/i.test(net) ? this.testUrl : this.baseUrl;
  }

  /** Start (or restart) polling */
  startPolling(ms: number = this.refreshMs): void {
    this.stopPolling();
    this.refreshMs = Math.max(1000, ms | 0);
    this.loadOnce();
    this.pollId = setInterval(() => this.loadOnce(), this.refreshMs);
  }

  /** Stop polling */
  stopPolling(): void {
    if (this.pollId) clearInterval(this.pollId);
    this.pollId = undefined;
  }

  /** Manual refresh */
  refreshNow(): void {
    this.loadOnce();
  }

  /** Change cadence */
  setRefreshMs(ms: number): void {
    this.refreshMs = Math.max(1000, ms | 0);
    if (this.pollId) this.startPolling(this.refreshMs);
  }

  private normalizeRow(
    r: any,
    addr: string,
    defaults: { propertyId?: number }
  ): ChannelBalanceRow {
    const participants: { A?: string; B?: string } = r?.participants ?? {
      A: r?.participantA ?? r?.A ?? r?.partyA,
      B: r?.participantB ?? r?.B ?? r?.partyB,
    };

    let column: 'A' | 'B';
    if (r?.column === 'A' || r?.column === 'B') column = r.column;
    else if (participants?.A && addr && participants.A === addr) column = 'A';
    else if (participants?.B && addr && participants.B === addr) column = 'B';
    else column = 'A';

    const counterparty = column === 'A' ? participants?.B : participants?.A;

    const pidRaw = r?.propertyId;
    const propertyId =
      pidRaw !== undefined && pidRaw !== null
        ? Number(pidRaw)
        : defaults.propertyId !== undefined
          ? Number(defaults.propertyId)
          : 0;

    const amount = Number(r?.amount ?? r?.balance ?? r?.value ?? 0);

    const lastCommitmentBlock = Number(
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
      lastCommitmentBlock: Number.isFinite(lastCommitmentBlock) ? lastCommitmentBlock : undefined,
    };
  }

  public async loadOnce(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      const url = `${this.relayerUrl}/rpc/tl_channelBalanceForCommiter`;

      // address via WalletService
      const net = (this.rpcService as any)?.NETWORK ? String((this.rpcService as any).NETWORK) : undefined;
      const accounts = await this.walletService.requestAccounts(net);
      this.accounts = (accounts || []).map((a: any) => ({ address: a.address, pubkey: a.pubkey || '' }));
      const addr = this.accounts[0]?.address;

      if (!addr) {
        this.channelsCommits = [];
        this.__rows$.next([]);
        return;
      }

      const m: any = this.spotMarkets.selectedMarket;

      // SpotMarketsService shape: first_token.propertyId, second_token.propertyId
      const pidRaw = m?.first_token?.propertyId;
      const propertyId = pidRaw !== undefined && pidRaw !== null ? Number(pidRaw) : undefined;

      if (propertyId === undefined || !Number.isFinite(propertyId)) {
        this.channelsCommits = [];
        this.__rows$.next([]);
        return;
      }

      const body = { params: [addr, propertyId] };

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

      const rows = rawRows.map((row) => this.normalizeRow(row, addr, { propertyId }));

      this.channelsCommits = rows.slice();
      this.__rows$.next(this.channelsCommits);
    } catch (err) {
      console.error('[spot-channels] load error:', err);
      this.channelsCommits = [];
      this.__rows$.next([]);
    } finally {
      this.isLoading = false;
    }
  }

  get activeSpotaddress() {
    return this.authService.activeSpotKey?.address || null;
  }

  removeAll() {
    this.channelsCommits = [];
    this.__rows$.next([]);
  }
}
