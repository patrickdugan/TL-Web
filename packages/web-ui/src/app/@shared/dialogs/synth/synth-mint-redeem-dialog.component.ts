// src/app/@shared/dialogs/synth/synth-mint-redeem-dialog.component.ts
import { Component, Inject } from '@angular/core';
import { MAT_DIALOG_DATA, MatDialogRef } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { ENCODER } from 'src/app/utils/payloads/encoder';
import {
  M1_PROCEDURAL_RECEIPT_CONFIG,
  ProceduralReceiptConfig,
} from 'src/app/@core/constants/procedural.constants';
import { ProceduralRuntimeService } from 'src/app/@core/services/procedural-runtime.service';

export type SynthMode = 'mint' | 'redeem';
export type SynthFlow = 'synthetic' | 'proceduralReceipt';

type ContractRow = {
  id: number;
  label: string;
  notional?: number;
  maxMintLTC?: number;
  maxMintUnits?: number;
};

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
  proceduralConfig?: ProceduralReceiptConfig;
  proceduralRuntimeError?: string;
  submitting = false;

  constructor(
    public dialogRef: MatDialogRef<SynthMintRedeemDialogComponent>,
    @Inject(MAT_DIALOG_DATA)
    public data: {
      mode?: SynthMode;
      flow?: SynthFlow;
      address: string;
      propId: number | string;
      available?: number;
      title?: string;
      actionLabel?: string;
      underlyingAssetLabel?: string;
      refreshProceduralArtifacts?: boolean;
      underlyingPropertyId?: number;
      proceduralArtifactMode?: 'fresh' | 'replay';
      proceduralPathName?: string;
    },
    private txsService: TxsService,
    private toastr: ToastrService,
    private http: HttpClient,
    private balanceService: BalanceService,
    private proceduralRuntime: ProceduralRuntimeService
  ) {}

  get relayerRpcBase() {
    return this.balanceService.NETWORK === 'LTCTEST'
      ? 'https://testnet-api.layerwallet.com/rpc'
      : 'https://api.layerwallet.com/rpc';
  }

  get isProceduralFlow() {
    return this.data.flow === 'proceduralReceipt';
  }

  get titleText() {
    if (this.data.title) return this.data.title;
    return this.data.mode === 'mint'
      ? 'Mint Synthetic'
      : `Redeem ${this.data.underlyingAssetLabel || 'LTC'}`;
  }

  get submitText() {
    if (this.data.actionLabel) return this.data.actionLabel;
    return this.data.mode === 'mint' ? 'Mint' : `Redeem ${this.data.underlyingAssetLabel || 'LTC'}`;
  }

  get selectedContract() {
    return this.contracts.find((c) => c.id === this.selectedContractId) || null;
  }

  async ngOnInit() {
    if (!this.data.mode) {
      const isSynthAlias =
        typeof this.data.propId === 'string' && /^s\d+-\d+$/i.test(this.data.propId);
      this.data.mode = isSynthAlias ? 'redeem' : 'mint';
    }
    if (!this.data.flow) {
      this.data.flow = 'synthetic';
    }
    if (!this.data.underlyingAssetLabel) {
      this.data.underlyingAssetLabel = 'LTC';
    }

    if (this.isProceduralFlow) {
      try {
        await this.loadProceduralConfig();
        await this.loadAmountCap();
      } catch (error: any) {
        if (this.shouldGenerateProceduralArtifacts()) {
          this.proceduralRuntimeError = error?.message || 'Procedural runtime is not ready yet.';
          await this.loadAmountCap();
        } else {
          this.toastr.error(error?.message || 'Procedural runtime is not ready.');
          this.dialogRef.close();
        }
      }
      return;
    }

    if (this.data.mode === 'mint') {
      await this.loadEligibility();
    } else {
      await this.loadRedeemCap();
    }
  }

  private async loadProceduralConfig() {
    const runtimeConfig = await this.proceduralRuntime.loadRequiredConfig();
    await this.applyProceduralConfig(runtimeConfig);
  }

  private async applyProceduralConfig(config?: ProceduralReceiptConfig) {
    if (!config) {
      this.proceduralConfig = undefined;
      return;
    }

    this.proceduralConfig = {
      ...config,
      receiptPropertyId: config.receiptPropertyId || await this.resolveReceiptPropertyId(config),
    };
  }

  private async resolveReceiptPropertyId(config?: ProceduralReceiptConfig): Promise<number | undefined> {
    const propId = Number(this.data.propId);
    if (this.data.mode === 'redeem' && Number.isFinite(propId) && propId > 0) {
      return propId;
    }

    const propertiesRes: any = await this.http
      .post(`${this.relayerRpcBase}/tl_listProperties`, {})
      .toPromise();
    const properties = Array.isArray(propertiesRes?.data)
      ? propertiesRes.data
      : Array.isArray(propertiesRes)
        ? propertiesRes
        : [];
    const ticker = String(config?.receiptTicker || M1_PROCEDURAL_RECEIPT_CONFIG.receiptTicker || '').toUpperCase();
    const match = properties.find((property: any) => String(property?.ticker || '').toUpperCase() === ticker);
    return match?.id != null ? Number(match.id) : undefined;
  }

  private async loadAmountCap() {
    const max = this.data.mode === 'mint'
      ? Number(this.proceduralConfig?.fundedAmountLtc ?? this.data.available ?? 0)
      : Number(this.data.available ?? this.proceduralConfig?.fundedAmountLtc ?? 0);
    if (max > 0) {
      this.capInfo = { max };
      this.amount = max.toFixed(8);
    } else {
      this.capInfo = undefined;
    }
  }

  private async loadEligibility() {
    try {
      const pid =
        typeof this.data.propId === 'string'
          ? Number(this.data.propId.replace(/^s/i, '').split('-')[0])
          : Number(this.data.propId);

      const resp: any = await this.http
        .post(`${this.relayerRpcBase}/tl_getMaxSynth`, {
          address: this.data.address,
          propId: String(pid),
        })
        .toPromise();

      this.contracts = (resp?.contracts || []).map((c: any) => ({
        id: Number(c.contractId),
        label: c.label || `Contract #${c.contractId}`,
        notional: c.notional,
        maxMintLTC: c.maxMintLTC,
      }));

      this.selectedContractId = this.contracts[0]?.id ?? null;

      const selected = this.contracts.find((c) => c.id === this.selectedContractId);
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
    try {
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
    const selected = this.contracts.find((c) => c.id === id);
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
    try {
      navigator.clipboard?.writeText(this.data.address);
    } catch {}
  }

  onSlide(ev: any) {
    if (!this.capInfo) return;
    const v = (ev?.value ?? ev?.target?.value ?? 0) as number;
    const pct = Math.max(0, Math.min(100, Number(v) || 0)) / 100;
    this.amount = (this.capInfo.max * pct).toFixed(8);
  }

  cancel() {
    this.dialogRef.close();
  }

  private shouldGenerateProceduralArtifacts() {
    return this.data.refreshProceduralArtifacts === true
      && Number(this.data.underlyingPropertyId ?? -1) === 0;
  }

  private async refreshProceduralArtifactsIfNeeded() {
    if (!this.shouldGenerateProceduralArtifacts()) {
      return;
    }

    const mode = this.data.proceduralArtifactMode || (this.data.mode === 'mint' ? 'fresh' : 'replay');
    const pathName = this.data.proceduralPathName || this.proceduralConfig?.selectedPathId || 'roll';
    this.toastr.info(
      mode === 'fresh'
        ? 'Generating fresh BitVM artifacts for procedural tLTC.'
        : 'Refreshing BitVM execution context from the current artifact set.'
    );

    const config = await this.proceduralRuntime.generateAndLoadRequiredConfig({
      mode,
      pathName,
      provisionIfMissing: true,
    });
    await this.applyProceduralConfig(config);
    await this.loadAmountCap();
    this.proceduralRuntimeError = undefined;
  }

  private async submitProceduralReceipt() {
    await this.refreshProceduralArtifactsIfNeeded();

    if (!this.proceduralConfig?.receiptPropertyId) {
      throw new Error('Receipt property could not be resolved.');
    }

    if (this.data.mode === 'mint') {
      const result = await this.txsService.tokenizeProceduralReceipt({
        depositorAddress: this.data.address,
        amount: Number(this.amount),
        config: this.proceduralConfig,
      });

      if (result.error || !result.data) {
        throw new Error(result.error || 'Tokenize failed');
      }

      this.toastr.success(`Funding TX: ${result.data.depositTxid}`);
      this.toastr.success(`Mint TX: ${result.data.mintTxid}`);
      this.dialogRef.close(result);
      return;
    }

    const result = await this.txsService.redeemProceduralReceiptWithRelease({
      holderAddress: this.data.address,
      amount: Number(this.amount),
      config: this.proceduralConfig,
    });

    if (result.error || !result.data) {
      throw new Error(result.error || 'Redeem failed');
    }

    this.toastr.success(`Redeem TX: ${result.data.redeemTxid}`);
    this.toastr.success(`Release TX: ${result.data.releaseTxid}`);
    this.dialogRef.close(result);
  }

  async submit() {
    if (this.submitting) {
      return;
    }

    try {
      this.submitting = true;
      if (this.isProceduralFlow) {
        await this.submitProceduralReceipt();
        return;
      }

      let payload: string;
      if (this.data.mode === 'mint') {
        payload = ENCODER.encodeMintSynthetic({
          propertyId: Number(this.data.propId),
          contractId: Number(this.selectedContractId),
          amount: Number(this.amount),
        });
      } else {
        payload = ENCODER.encodeRedeemSynthetic({
          propertyId: String(this.data.propId),
          contractId: Number(this.selectedContractId),
          amount: Number(this.amount),
        });
      }

      const result = await this.txsService.buildSignSendTx({
        fromKeyPair: { address: this.data.address },
        toKeyPair: { address: this.data.address },
        amount: 0,
        payload,
      });

      if (result.error || !result.data) {
        throw new Error(result.error || 'Tx failed');
      }

      this.toastr.success(`Tx sent: ${result.data}`);
      this.dialogRef.close(result);
    } catch (err: any) {
      console.error('[SynthDialog] tx error', err);
      this.toastr.error(err.message || 'Tx failed');
    } finally {
      this.submitting = false;
    }
  }
}
