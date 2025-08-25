import { AuthService } from 'src/app/@core/services/auth.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { Subscription } from 'rxjs';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { ToastrService } from 'ngx-toastr';
import { HttpClient, HttpParams } from '@angular/common/http';
import { Component, OnInit, OnDestroy, Input } from '@angular/core';
import { DialogService } from 'src/app/@core/services/dialogs.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { ENCODER } from 'src/app/utils/payloads/encoder';
import { SpotMarketsService } from 'src/app/@core/services/spot-services/spot-markets.service';
import { Observable, forkJoin, of, BehaviorSubject, combineLatest} from 'rxjs';
import { catchError, finalize, map, filter, shareReplay, switchMap, tap } from 'rxjs/operators';
import { SpotChannelsService } from 'src/app/@core/services/spot-services/spot-channels.service'; 

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
  selector: 'tl-spot-channels',
  templateUrl: './spot-channels.component.html',
  styleUrls: ['./spot-channels.component.scss']
})
export class SpotChannelsComponent implements OnInit {

  displayedColumns = ['property', 'column', 'channel', 'counterparty', 'amount', 'block', 'actions'];
  loading = false;
  working = false;
  error?: string;
  private sub?: Subscription;
  private address: string
  private propertyId: number
  private rows: ChannelBalanceRow[] = [];

  constructor(
    private spotSvc: SpotChannelsService,
    private spotMkts: SpotMarketsService,
    private dialogs: DialogService,
    private auth: AuthService,
    private txs: TxsService,
    private toastrService: ToastrService
  ) {}

/** Call this when user action should force refresh (optional) */
refreshChannels(): void { this.spotSvc.loadOnce(); }

   ngOnInit(): void {
    this.refreshChannels();
  }

  ngOnDestroy(): void {
    this.sub?.unsubscribe();
  }

  private resolveAddress(): string {
    return this.auth.walletAddresses?.[0] ?? '';
  }

  get activeChannelsCommits() {
  return this.spotSvc.channelsCommits;
}

get total(): number {
  return this.activeChannelsCommits
    .reduce((s, r) => s + (Number.isFinite(r?.amount) ? Number(r.amount) : 0), 0);
}


  private resolvePropertyId(): number | undefined {
    // Be flexible; different builds store selected spot market differently.
    const m: any = this.spotMkts?.selectedMarket;
    return (
      m?.propIdDesired ??
      m?.propIdForSale ??
      m?.base?.propertyId ??
      m?.quote?.propertyId ??
      m?.property?.propertyId ??
      m?.propertyId
    );
  }

  copy(value?: string | null) {
    if (!value) return;
    navigator.clipboard?.writeText(value).catch(() => {});
  }

  // ----- Transfer via DialogsService -----
  transfer(row: ChannelBalanceRow) {
    const data = {
      mode: 'channel-transfer',
      address: this.address,
      channel: row.channel,
      column: row.column,
      propertyId: row.propertyId,
      maxAmount: row.amount,
      counterparty: row.counterparty,
      participants: row.participants
    };

    const ref = (this.dialogs as any).openTransfer
      ? (this.dialogs as any).openTransfer(data)
      : (this.dialogs as any).open?.(/* component */ undefined, { data });

    if (ref?.afterClosed) {
      ref.afterClosed().subscribe((res: any) => {
        if (res?.success) this.refreshChannels();
      });
    }
  }

  // ----- Withdraw builds the tx directly -----
  async withdraw(row: ChannelBalanceRow) {
    if (this.working) return;
    if (!row?.amount || row.amount <= 0) return;

    try {
      this.working = true;

      const columnNum = row.column === 'A' ? 0 : 1;
      this.address = this.resolveAddress()

      const payload = ENCODER.encodeWithdrawal({
        withdrawAll: 0,
        propertyId: row.propertyId,
        amountOffered: row.amount,
        column: columnNum,
        channelAddress: row.channel
      });

      const buildCfg = {
        fromKeyPair: { address: this.address },
        toKeyPair:   { address: row.channel },
        payload
      };

      const res = await this.txs.buildSignSendTx(buildCfg as any);
      if (res?.error) throw new Error(res.error);
      this.toastrService.success(`Withdrawal TX: ${res.data}`, 'Success');

      this.refreshChannels();
    } catch (err: any) {
      console.error('[Spot][Withdraw] error:', err?.message || err);
      this.error = err?.message || 'Withdraw failed';
    } finally {
      this.working = false;
    }
  }

  async withdrawAll() {
  if (this.working) return;

  // pick rows currently shown; if this.propertyId is set, rows are likely already filtered,
  // but we'll defensively filter again.
  const targetRows = (this.activeChannelsCommits || []).filter(r =>
    (!this.propertyId && r.amount > 0) ||
    (this.propertyId != null && r.propertyId === this.propertyId && r.amount > 0)
  );

  if (!targetRows.length) return;

  this.working = true;
  this.error = undefined;

  try {
    let ok = 0, fail = 0;

    // Process sequentially to avoid RPC/mempool bursts
    for (const row of targetRows) {
      const columnNum = row.column === 'A' ? 0 : 1;

      // withdrawAll=1 tells protocol to withdraw entire balance for this property on that column
      this.address = this.resolveAddress()
      const payload = ENCODER.encodeWithdrawal({
        withdrawAll: 1,
        propertyId: row.propertyId,
        // amountOffered is ignored by withdrawAll in protocol; passing current visible amount is harmless
        amountOffered: row.amount,
        column: columnNum,
        channelAddress: row.channel
      });

      const buildCfg = {
        fromKeyPair: { address: this.address }, // wallet
        toKeyPair:   { address: row.channel },  // channel target
        payload
      };

        const res = await this.txs.buildSignSendTx(buildCfg as any);
        if (res?.error) {
          console.error('[WithdrawAll] item failed:', row, res.error);
          fail++;
        } 
    
      this.toastrService.success(`Withdrawal TX: ${res.data}`, 'Success');


      // small delay to be gentle on node/mempool
      await new Promise(r => setTimeout(r, 200));
    }

    console.log(`[WithdrawAll] done: ok=${ok} fail=${fail}`);
    this.refreshChannels(); // refresh table (rows may shrink/disappear)
  } catch (err: any) {
    this.error = err?.message || 'Withdraw All failed';
    console.error('[WithdrawAll] error:', this.error);
  } finally {
    this.working = false;
  }
}


  transferAll() {
    if (!this.activeChannelsCommits.length) return;
    this.transfer(this.activeChannelsCommits[0]);
  }

  trackByChan = (_: number, r: ChannelBalanceRow) => `${r.channel}:${r.propertyId}:${r.column}`;

  
private _mergeCommits(a?: any[], b?: any[]): any[] {
  const rows = ([] as any[]).concat(a || [], b || []);
  const keyOf = (n: any) => `${n?.propertyId}|${n?.column}|${n?.channel}`;
  const seen = new Set<string>();
  const out: any[] = [];
  for (const r of rows) {
    const k = keyOf(r);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}

private _sortByBlockDesc(rows: any[]): any[] {
  return [...(rows || [])].sort((x, y) =>
    (Number(y?.lastCommitmentBlock ?? 0) - Number(x?.lastCommitmentBlock ?? 0))
  );
}

private _extractCommits(resp: any): any[] {
  if (!resp) return [];
  if (Array.isArray(resp)) return resp;

  // Common shapes from APIs
  const arr =
    resp.commits ??
    resp.channels ??
    resp.activeChannelsCommits ??
    resp.rows ??
    resp.data ??
    resp.items;

  if (Array.isArray(arr)) return arr;

  // Last resort: first array field in the object
  for (const k of Object.keys(resp)) {
    if (Array.isArray((resp as any)[k])) return (resp as any)[k];
  }
  return [];
}

}
