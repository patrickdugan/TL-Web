import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { AlgoTradingService, StrategyRow } from 'src/app/@core/services/algo-trading.service';
import { FormBuilder, FormGroup } from '@angular/forms';

interface RunningRow {
  systemId: string;
  name: string;
  amount: number;
  pnlUsd: number;
  startedAt: number;
  status: 'running' | 'stopped';
}

type TabKey = 'discover' | 'running';

@Component({
  selector: 'app-algo-trading-page',
  templateUrl: './algo-trading.component.html',
  styleUrls: ['./algo-trading.component.scss'],
})
export class AlgoTradingPageComponent implements OnInit, OnDestroy {
  discovery: StrategyRow[] = [];
  running: RunningRow[] = [];
  logs: { systemId: string; args: any[] }[] = [];
  tabs: { key: TabKey; label: string }[] = [
    { key: 'discover', label: 'Discover' },
    { key: 'running',  label: 'Running'  },
  ];

  activeTab: TabKey = 'discover';
  setTab(t: TabKey) { this.activeTab = t; }

  // streams (wire to service)
  discovery$ = this.svc.discovery$;
  running$   = this.svc.running$;
  selected?: StrategyRow;
  private subs: Subscription[] = [];

  constructor(private svc: AlgoTradingService, private fb: FormBuilder) {}

  ngOnInit(): void {
    void this.svc.init();
    this.subs.push(
      this.svc.discovery$.subscribe((d) => (this.discovery = d)),
      this.svc.running$.subscribe((r) => (this.running = r)),
    );
    this.svc.fetchDiscovery();
    this.svc.fetchRunning();
  }

  ngOnDestroy(): void {
    for (const s of this.subs) s.unsubscribe();
  }

// state + handlers
showUpload = false;

openUploadSystemDialog() { this.showUpload = true; }
closeUpload() { this.showUpload = false; }

onDragOver(e: DragEvent) { e.preventDefault(); e.stopPropagation(); }
onDrop(e: DragEvent) {
  e.preventDefault(); e.stopPropagation();
  const f = e.dataTransfer?.files?.[0];
  if (f) this.svc.registerStrategy(f).finally(() => this.showUpload = false);
}

browseUpload(fileInput: HTMLInputElement) { fileInput.click(); }
onFilePicked(ev: Event) {
  const f = (ev.target as HTMLInputElement).files?.[0];
  if (f) this.svc.registerStrategy(f).finally(() => this.showUpload = false);
}


  // simple forms
  allocationForm: FormGroup = this.fb.group({
    amount: [0],
    apiKey: [''],
    apiSecret: [''],
  });

  withdrawForm: FormGroup = this.fb.group({
    amount: [0],
  });

  openAllocate(r: StrategyRow) {
    this.selected = r;
    this.allocationForm.patchValue({ amount: r.amount ?? 0 });
    this.showAllocate = true;
  }

  allocateConfirm() {
    const amt = Number(this.allocationForm.value?.amount) || 0;
    if (this.selected) this.svc.runSystem(this.selected.id, { amount: amt });
    this.showAllocate = false;
  }

  openWithdraw(r: StrategyRow | RunningRow) {
    this.selected = this.discovery.find(d => d.id === (r as any).systemId) ?? (r as any);
    this.withdrawForm.patchValue({ amount: (this.selected?.amount ?? 0) });
    this.showWithdraw = true;
  }

  confirmWithdraw() {
    const id = (this.selected as any)?.id || (this.selected as any)?.systemId;
    if (id) this.svc.stopSystem(id);
    this.showWithdraw = false;
  }

  showAllocate = false;
  showWithdraw = false;

/*  openUploadSystemDialog() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.js';
    input.onchange = async (e: any) => {
      const file = e.target.files[0];
      if (file) await this.svc.registerStrategy(file);
    };
    input.click();
  }*/

  closeAllocate() { this.showAllocate = false; }
  closeWithdraw() { this.showWithdraw = false; }


  onUpload(files: FileList | null) {
    if (!files || !files.length) return;
    const file = files[0];
    this.svc.registerStrategy(file);
  }

  runSystem(id: string, amount?: number) {
    this.svc.runSystem(id, { amount });
  }

  stopSystem(id: string) {
    this.svc.stopSystem(id);
  }

  copyId(id: string) {
    try {
      navigator.clipboard?.writeText(id);
      console.log('Copied', id);
    } catch {}
  }

  fmtUsd(n?: number): string {
    const v = n ?? 0;
    return (v < 0 ? '-' : '') + '$' + Math.abs(v).toFixed(2);
  }

  fmtPct(n?: number): string {
    const v = n ?? 0;
    return (v >= 0 ? '+' : '') + v.toFixed(2) + '%';
  }

  startedAgo(ms?: number): string {
    if (!ms) return '-';
    const secs = Math.max(0, Math.floor((Date.now() - ms) / 1000));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    return `${h}h ${m}m ${s}s`;
  }
}
