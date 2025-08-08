import { Component, OnInit, ChangeDetectorRef } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { ENetwork, RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';
import { BalanceService } from 'src/app/@core/services/balance.service';

type NetworkOpt = { value: ENetwork; label: string };

@Component({
  selector: 'select-network-dialog',
  templateUrl: './select-network.component.html',
  styleUrls: ['./select-network.component.scss'],
})
export class SelectNetworkDialog implements OnInit {
  public network: ENetwork = ENetwork.LTC; // default like old version
  public options: NetworkOpt[] = [];

  constructor(
    private rpcService: RpcService,
    public dialogRef: MatDialogRef<SelectNetworkDialog>,
    private router: Router,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private windowsService: WindowsService,
    private balanceService: BalanceService
    private cdr: ChangeDetectorRef
  ) {
    // enable click-off close
    this.dialogRef.disableClose = false;
    this.dialogRef.backdropClick().subscribe(() => this.cancel());
  }

  ngOnInit(): void {
    // Build options from ENetwork; fall back if enum is empty at runtime
    const enumObj = (ENetwork as any) || {};
    const keys = Object.keys(enumObj).filter(k => isNaN(Number(k)));
    if (keys.length) {
      this.options = keys.map(k => ({
        value: enumObj[k] as ENetwork,
        label: k.replace(/_/g, ' ')
      }));
    } else {
      // Fallback list so the modal is never empty
      this.options = [
        { value: ENetwork.LTC, label: 'LTC' },
        // add others if your enum normally has them
      ];
    }

    // Ensure the selected value is one of the options
    if (!this.options.some(o => o.value === this.network)) {
      this.network = this.options[0]?.value ?? this.network;
    }

  // 👉 force a render pass so mat-select sees options immediately
    Promise.resolve().then(() => this.cdr.detectChanges());
  }

  async selectNetwork(): Promise<void> {
    try {
      this.loadingService.isLoading = true;

      this.rpcService.NETWORK = this.network;
      this.rpcService.isNetworkSelected = true;
      this.balanceService.NETWORK = this.network;

      this.dialogRef.close(true);

      // Old behaviour navigated to '/', keep that here
      this.router.navigateByUrl('/');

      const tab = this.windowsService.tabs?.find((tab: any) => tab.title === 'Servers');
      if (tab) tab.minimized = false;
    } catch (error: any) {
      this.toastrService.error(error?.message || 'Failed to set network', 'Error');
    } finally {
      this.loadingService.isLoading = false;
    }
  }

  // Alias to support templates calling (click)="confirm()"
  async confirm(): Promise<void> {
    return this.selectNetwork();
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
