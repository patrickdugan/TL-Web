import { Injectable } from '@angular/core';
import axios, { AxiosResponse } from 'axios';
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

  /** relayer endpoints (testnet default) */
  private baseUrl = 'https://api.layerwallet.com';
  private testUrl = 'https://testnet-api.layerwallet.com';

  /** Store accounts like BalanceService */
  private accounts: { address: string; pubkey: string }[] = [];

  constructor(
    private authService: AuthService,
    private walletService: WalletService,
    private spotMarkets: SpotMarketsService,
    private rpcService: RpcService
  ) {
    // Optional: live refresh on address/market change if streams exist
    this.authService.updateAddressesSubs$?.subscribe(() => this.refreshNow());
    (this.spotMarkets as any).selectedMarket$?.subscribe?.(() => this.refreshNow());
    (this.spotMarkets as any).marketChange$?.subscribe?.(() => this.refreshNow());
  }

  /** relayer selector (mirrors FuturesChannelsService) */
  private get relayerUrl(): string {
    return String(this.rpcService.NETWORK).includes('TEST')
      ? this.testUrl
      : this.baseUrl;
  }

  /** Start (or restart) polling */
  startPolling(ms: number = this.refreshMs): void {
    this.stopPolling();
    this.refreshMs = Math.max(1000, ms | 0);
    this.loadOnce(); // run immediately
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

  // ---------- internals ----------

  private normalizeRow(
    r: any,
    addr: string,
    defaults: { propertyId?: number }
  ): ChannelBalanceRow {
    // participants can come in various shapes; normalize
    const participants: { A?: string; B?: string } = r?.participants ?? {
      A: r?.participantA ?? r?.A ?? r?.partyA,
      B: r?.participantB ?? r?.B ?? r?.partyB,
    };

    // Determine which side we are (prefer provided column, else infer)
    let column: 'A' | 'B';
    if (r?.column === 'A' || r?.column === 'B') {
      column = r.column;
    } else if (participants?.A && addr && participants.A === addr) {
      column = 'A';
    } else if (participants?.B && addr && participants.B === addr) {
      column = 'B';
    } else {
      column = 'A'; // fallback
    }

    const counterparty = column === 'A' ? participants?.B : participants?.A;

    // propertyId (0 is valid for LTC)
    const pidRaw = r?.propertyId;
    const propertyId =
      pidRaw !== undefined && pidRaw !== null
        ? Number(pidRaw)
        : defaults.propertyId !== undefined
          ? Number(defaults.propertyId)
          : 0;

    const amount = Number(r?.amount ?? r?.balance ?? r?.value ?? 0);

    const lastCommitmentBlock = Number(
      r?.lastCommitmentBlock ?? r?.block ?? r?.height ?? undefined
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
      lastCommitmentBlock: Number.isFinite(lastCommitmentBlock)
        ? lastCommitmentBlock
        : undefined,
    };
  }

  public async loadOnce(): Promise<void> {
    if (this.isLoading) return;
    this.isLoading = true;

    try {
      // Get address using WalletService like BalanceService does
      let addr: string | undefined;
      
      try {
        const network = this.rpcService.NETWORK ? String(this.rpcService.NETWORK) : undefined;
        const accounts = await this.walletService.requestAccounts(network);
        this.accounts = accounts.map((account) => ({
          address: account.address,
          pubkey: account.pubkey || '',
        }));
        addr = this.accounts[0]?.address;
      } catch (error) {
        console.error('[spot-channels] Failed to get accounts:', error);
        this.channelsCommits = [];
        return;
      }

      if (!addr) {
        this.channelsCommits = [];
        return;
      }

      const m = this.spotMarkets.selectedMarket;

      // Use first_token.propertyId from IMarket interface (0 is valid for LTC)
      const propertyId = m?.first_token?.propertyId;

      const res: AxiosResponse<ChannelBalancesResponse | ChannelBalanceRow[] | any> =
        await axios.post(
          `${this.relayerUrl}/rpc/tl_channelBalanceForCommiter`,
          {
            params: [addr, propertyId],
          }
        );

      const data = res.data;
      const rawRows: any[] = Array.isArray(data)
        ? data
        : Array.isArray(data?.rows)
          ? data.rows
          : [];

      const rows = rawRows.map(row =>
        this.normalizeRow(row, addr!, { propertyId })
      );

      // New array ref so Angular change detection triggers
      this.channelsCommits = rows.slice();
    } catch (err) {
      console.error('[spot-channels] load error:', err);
      this.channelsCommits = [];
    } finally {
      this.isLoading = false;
    }
  }

  get activeSpotaddress() {
    return this.authService.activeSpotKey?.address || null;
  }

  removeAll() {
    this.channelsCommits = [];
  }
}