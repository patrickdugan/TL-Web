import {
  Component,
  OnInit,
  OnDestroy,
} from '@angular/core';
import { FormBuilder, FormGroup } from '@angular/forms';
import { Subscription } from 'rxjs';
import {
  AlgoTradingService,
  StrategyRow,
  RunningRow,
} from './algo-trading-service'; // adjust relative path if needed

@Component({
  selector: 'app-algo-trading',
  templateUrl: './algo-trading.component.html',
  styleUrls: ['./algo-trading.component.scss'],
})
export class AlgoTradingComponent implements OnInit, OnDestroy {
  // ======== tab state ========
  public tabs = [
    { key: 'discover', label: 'Discover' },
    { key: 'running', label: 'Running' },
  ];
  public activeTab: 'discover' | 'running' = 'discover';

  // ======== tables ========
  public rows: StrategyRow[] = [];
  public running: RunningRow[] = [];

  // ======== filters (stub UI in your HTML) ========
  public filters!: FormGroup;

  // ======== allocate dialog ========
  public showAllocate = false;
  public allocationForm!: FormGroup;
  private allocationTargetId: string | null = null;

  // ======== withdraw dialog ========
  public showWithdraw = false;
  public withdrawForm!: FormGroup;
  private withdrawTargetId: string | null = null;

  private subs: Subscription[] = [];

  constructor(
    private algo: AlgoTradingService,
    private fb: FormBuilder,
  ) {}

  ngOnInit() {
    // build forms
    this.filters = this.fb.group({
      market: ['All'],
      runningTime: ['All'],
      roi: ['All'],
      category: ['All'],
      sort: ['Recommended'],
    });

    this.allocationForm = this.fb.group({
      amount: [100],
      apiKey: [''],
      apiSecret: [''],
    });

    this.withdrawForm = this.fb.group({
      amount: [0],
    });

    // subscribe to discovery list
    this.subs.push(
      this.algo.discovery$.subscribe(list => {
        this.rows = list;
      })
    );

    // subscribe to running list
    this.subs.push(
      this.algo.running$.subscribe(list => {
        this.running = list;
      })
    );

    // init data
    this.algo.fetchDiscovery();
    this.algo.fetchRunning();
  }

  ngOnDestroy() {
    this.subs.forEach(s => s.unsubscribe());
  }

  // ======== tabs ========
  public setTab(tabKey: 'discover' | 'running') {
    this.activeTab = tabKey;
  }

  // ======== upload button in header ========
  // this HTML just calls openUploadSystemDialog(); you can evolve this into a modal
  public openUploadSystemDialog() {
    console.log('[ALGO UI] Upload system clicked');
    // TODO: wire real upload modal if you want inline upload like desktop,
    // or reuse the upload flow we sketched earlier.
    // For now this is just a stub to not break template bindings.
  }

  // ======== Allocate flow ("Copy" / "Allocate" button in discovery table) ========
  // HTML calls (click)="onCopy(r)"
  public onCopy(r: StrategyRow) {
    this.allocationTargetId = r.id || null;
    this.allocationForm.patchValue({
      amount: r.amount ?? 100,
      apiKey: '',
      apiSecret: '',
    });
    this.showAllocate = true;
  }

  public closeAllocate() {
    this.showAllocate = false;
    this.allocationTargetId = null;
  }

  public allocateConfirm() {
    if (!this.allocationTargetId) {
      this.closeAllocate();
      return;
    }
    const { amount, apiKey } = this.allocationForm.value;

    this.algo.runSystem(this.allocationTargetId, {
      amount,
      counterVenueKey: apiKey || '',
      hedgeMode: 'mirror',
    });

    // switch to running tab so user sees it live
    this.activeTab = 'running';

    this.closeAllocate();
  }

  // ======== Withdraw / Stop flow ========
  // HTML running table calls openWithdraw(s)
  public openWithdraw(s: RunningRow) {
    this.withdrawTargetId = s.id;
    this.withdrawForm.patchValue({
      amount: s.allocated,
    });
    this.showWithdraw = true;
  }

  public closeWithdraw() {
    this.showWithdraw = false;
    this.withdrawTargetId = null;
  }

  // HTML running table stop button calls stopSystem(s.id)
  public stopSystem(id: string) {
    this.algo.stopSystem(id);
  }

  public confirmWithdraw() {
    if (!this.withdrawTargetId) {
      this.closeWithdraw();
      return;
    }

    // Right now withdraw == stop. Later you can do partial withdraw logic here.
    this.algo.stopSystem(this.withdrawTargetId);

    this.closeWithdraw();
  }
}
