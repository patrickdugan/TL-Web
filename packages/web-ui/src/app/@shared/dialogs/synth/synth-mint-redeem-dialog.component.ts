// src/app/@shared/dialogs/synth/synth-mint-redeem-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { IBuildTxConfig, TxsService } from 'src/app/@core/services/txs.service'; import { ENCODER } from 'src/app/utils/payloads/encoder';

export type SynthMode = 'mint' | 'redeem';

type ContractRow = { 
    id: number; 
    label: string; 
    notional?: number; 
    maxMintLTC?: number
    maxMintUnits?: number; };

@Component({
  selector: 'app-synth-mint-redeem-dialog',
  templateUrl: './synth-mint-redeem-dialog.component.html',
  styleUrls: ['./synth.scss'],
})
export class SynthMintRedeemDialogComponent {
  amount = '';
  capInfo?: { max: number };
  contracts: ContractRow[] = [];
  selectedContractId: number | null = null;

  constructor(
    public dialogRef: MatDialogRef<SynthMintRedeemDialogComponent>,
    @Inject(MAT_DIALOG_DATA) public data: {
      mode?: SynthMode;                 // now optional — we’ll infer if not provided
      address: string;
      propId: number | string;      // may be 's<pid>-<cid>' alias or a number
      available?: number
    },
    private http: HttpClient,
  ) {}

  async ngOnInit() {
    // 1) Infer mode from propertyId if not explicitly provided:
    if (!this.data.mode) {
      const isSynthAlias = typeof this.data.propId === 'string' && /^s\d+-\d+$/i.test(this.data.propId);
      this.data.mode = isSynthAlias ? 'redeem' : 'mint';
    }

    // 2) Load caps
    if (this.data.mode === 'mint') {
      await this.loadEligibility(); // fills contracts & default selection & cap
    } else {
      await this.loadRedeemCap();   // simple available balance
    }
  }

  private async loadEligibility() {
    try {
      const pid = typeof this.data.propId === 'string'
        ? Number(this.data.propId.replace(/^s/i, '').split('-')[0])
        : Number(this.data.propId);

      const resp: any = await this.http.post(`'https://api.layerwallet.com/rpc/tl_getMaxSynth`, { address: this.data.address, propId: String(pid)}).toPromise();

      // Normalize to dialog shape
      this.contracts = (resp?.contracts || []).map((c: any) => ({
        id: Number(c.contractId),
        label: c.label || `Contract #${c.contractId}`,
        notional: c.notional,
        maxMintLTC: c.maxMintLTC,
      }));

      // pick the first eligible by default
      this.selectedContractId = this.contracts[0]?.id ?? null;

      // cap = selected contract max (fallback to total)
      const selected = this.contracts.find(c => c.id === this.selectedContractId);
      const max = selected?.maxMintLTC ?? Number(resp?.maxMintTotalLTC ?? 0);
      if (max > 0) {
        this.capInfo = { max };
        this.amount = max.toFixed(8);
      } else {
        this.capInfo = undefined;
      }
    } catch {
      this.contracts = [];
      this.selectedContractId = null;
      this.capInfo = undefined;
    }
  }

  private async loadRedeemCap() {
    try{
      const max = Number(this.data.available ?? 0);
      if (max > 0) {
        this.capInfo = { max };
        this.amount = max.toFixed(8);
      } else {
        this.capInfo = undefined;
      }
    } catch {
      this.capInfo = undefined;
    }
  }

  onContractChange(id: number) {
    this.selectedContractId = id;
    const selected = this.contracts.find(c => c.id === id);
    const max = selected?.maxMintLTC ?? 0;
    this.capInfo = max > 0 ? { max } : undefined;
    if (max > 0) this.amount = max.toFixed(8);
  }

  fillMax() {
    if (this.capInfo) this.amount = this.capInfo.max.toFixed(8);
  }

  isPositive(val: string) {
    const n = Number(val);
    return Number.isFinite(n) && n > 0;
  }

  copyAddress() {
    try { navigator.clipboard?.writeText(this.data.address); } catch {}
  }

  onSlide(ev: any) {
    if (!this.capInfo) return;
    const v = (ev?.value ?? ev?.target?.value ?? 0) as number;
    const pct = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    this.amount = (this.capInfo.max * pct).toFixed(8);
  }

  cancel() { this.dialogRef.close(); }

  submit() {
    // Return what the encoder needs
    this.dialogRef.close({
      mode: this.data.mode,
      amount: this.amount,
      propIdUsed:
        typeof this.data.propId === 'string'
          ? Number(this.data.propId.replace(/^s/i, '').split('-')[0])
          : Number(this.data.propId),
      contractIdUsed: this.data.mode === 'mint' ? this.selectedContractId : undefined,
      address: this.data.address,
    });
  }
}
