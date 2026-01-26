import { AuthService } from 'src/app/@core/services/auth.service';
import { WalletService } from 'src/app/@core/services/wallet.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { Subscription } from 'rxjs';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { ToastrService } from 'ngx-toastr';
import { Component, Input, OnInit, OnDestroy } from '@angular/core';
import { FuturesChannelsService } from 'src/app/@core/services/futures-services/futures-channels.service';
import { FuturesMarketService } from 'src/app/@core/services/futures-services/futures-markets.service';
import { DialogService } from 'src/app/@core/services/dialogs.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { ENCODER } from 'src/app/utils/payloads/encoder';
import { BehaviorSubject, combineLatest } from 'rxjs';
import { filter, shareReplay, switchMap, tap } from 'rxjs/operators';

interface ChannelBalanceRow {
  channel: string;
  column: 'A' | 'B';
  propertyId: number;
  amount: number;
  participants?: { A?: string; B?: string };
  counterparty?: string;
  lastCommitmentBlock?: number;
}

@Component({
  selector: 'tl-futures-commits',
  templateUrl: './futures-commits.component.html',
  styleUrls: ['./futures-commits.component.scss'],
})
export class FuturesChannelsComponent implements OnInit, OnDestroy {
  displayedColumns = [
    'property',
    'column',
    'channel',
    'counterparty',
    'amount',
    'block',
    'actions',
  ];

  loading = false;
  working = false;
  error?: string;
  rows: ChannelBalanceRow[] = [];
  private sub?: Subscription;
  private address: string;
  private propertyId: number;

  constructor(
    private futSvc: FuturesChannelsService,
    private auth: AuthService,
    private walletService: WalletService,
    private rpcService: RpcService,
    private futMkts: FuturesMarketService,
    private dialogs: DialogService,
    private txs: TxsService,
    private toastrService: ToastrService
  ) {}

  address$ = new BehaviorSubject<string>('');

  refreshFuturesCommitChannels(): void {
    this.futSvc.loadOnce();
  }

  ngOnInit() {
    console.log('[FuturesChannelsComponent] ngOnInit fired');
    console.log('[FuturesChannelsComponent] futSvc =', this.futSvc);
    // Futures requires address + selectedMarket; polling avoids init race
    this.futSvc.startPolling(5000);
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
    this.futSvc.stopPolling();
  }

  get activeChannelsCommits() {
    return this.futSvc.channelsCommits;
  }

  get total(): number {
    return this.activeChannelsCommits.reduce(
      (s, r) => s + (Number.isFinite(r?.amount) ? Number(r.amount) : 0),
      0
    );
  }

  private async resolveAddress(): Promise<string> {
    try {
      const network = this.rpcService.NETWORK ? String(this.rpcService.NETWORK) : undefined;
      const accounts = await this.walletService.requestAccounts(network);
      return accounts[0]?.address ?? '';
    } catch (error) {
      console.error('[FuturesChannels] Failed to get address:', error);
      return '';
    }
  }

  private resolvePropertyId(): number | undefined {
    return this.futMkts.selectedMarket?.collateral?.propertyId;
  }

  copy(value?: string | null) {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
  }

  async transfer(row: ChannelBalanceRow) {
    const address = await this.resolveAddress();
    
    const data = {
      mode: 'channel-transfer',
      address: address,
      channel: row.channel,
      column: row.column,
      propertyId: row.propertyId,
      maxAmount: row.amount,
      counterparty: row.counterparty,
      participants: row.participants,
    };

    const ref = (this.dialogs as any).openTransfer
      ? (this.dialogs as any).openTransfer(data)
      : (this.dialogs as any).open?.(undefined, { data });

    if (ref?.afterClosed) {
      ref.afterClosed().subscribe(() => {
        this.futSvc.loadOnce();
      });
    }
  }

  async withdraw(row: ChannelBalanceRow) {
    if (this.working) return;
    if (!row?.amount || row.amount <= 0) return;

    try {
      this.working = true;
      this.address = await this.resolveAddress();

      if (!this.address) {
        throw new Error('Could not get wallet address');
      }

      const columnNum = row.column === 'A' ? 0 : 1;

      const payload = ENCODER.encodeWithdrawal({
        withdrawAll: 0,
        propertyId: row.propertyId,
        amountOffered: row.amount,
        column: columnNum,
        channelAddress: row.channel,
      });

      const DUST = 546/1e8; // litoshi to LTC

      const buildCfg = {
        fromKeyPair: { address: this.address },
        toKeyPair: { address: this.address }, // withdrawal goes back to self
        amount: DUST,
        payload,
      };

      const res = await this.txs.buildSignSendTx(buildCfg as any);
      if (res?.error) throw new Error(res.error);
      this.toastrService.success(`Withdrawal TX: ${res.data}`, 'Success');

      this.futSvc.loadOnce();
    } catch (err: any) {
      console.error('[Futures][Withdraw] error:', err?.message || err);
      this.error = err?.message || 'Withdraw failed';
      this.toastrService.error(this.error, 'Withdraw Failed');
    } finally {
      this.working = false;
    }
  }

  async withdrawAll(): Promise<void> {
    if (this.working) return;

    const targetRows = (this.activeChannelsCommits || []).filter(r =>
      (!this.propertyId && r.amount > 0) ||
      (this.propertyId != null && r.propertyId === this.propertyId && r.amount > 0)
    );

    this.address = await this.resolveAddress();
    
    if (!this.address) {
      this.toastrService.error('Could not get wallet address', 'Error');
      return;
    }

    this.working = true;
    this.error = undefined;

    try {
      for (const row of targetRows) {
        const columnNum = row.column === 'A' ? 0 : 1;

        const payload = ENCODER.encodeWithdrawal({
          withdrawAll: 1,
          propertyId: row.propertyId,
          amountOffered: row.amount,
          column: columnNum,
          channelAddress: row.channel
        });

        const buildCfg = {
          fromKeyPair: { address: this.address },
          toKeyPair:   { address: this.address },
          amount: 0.00000560,
          payload
        };

        const res = await this.txs.buildSignSendTx(buildCfg as any);
        if (res?.error) { 
          this.toastrService.error('WithdrawAll failed: ' + res.error);
          return;
        }

        await new Promise(r => setTimeout(r, 200));
        this.toastrService.success(`WithdrawAll TX: ${res.data}`, 'Success');
      }
      this.futSvc.loadOnce();
    } catch (err: any) {
      this.error = err?.message || 'Withdraw All failed';
      console.error('[WithdrawAll] error:', this.error);
      this.toastrService.error(this.error, 'WithdrawAll Failed');
    } finally {
      this.working = false;
    }
  }

  transferAll() {
    if (!this.activeChannelsCommits.length) return;
    this.transfer(this.activeChannelsCommits[0]);
  }

  trackByChan = (_: number, r: ChannelBalanceRow) =>
    `${r.channel}:${r.propertyId}:${r.column}`;
}