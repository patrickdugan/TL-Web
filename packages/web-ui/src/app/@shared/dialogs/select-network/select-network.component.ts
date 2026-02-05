import { Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { ENetwork, RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { SpotMarketsService } from 'src/app/@core/services/spot-services/spot-markets.service';
import { FuturesMarketService } from 'src/app/@core/services/futures-services/futures-markets.service';
import { DialogService } from 'src/app/@core/services/dialogs.service';

type NetworkOpt = { value: ENetwork; label: string };

@Component({
  selector: 'select-network-dialog',
  templateUrl: './select-network.component.html',
  styleUrls: ['./select-network.component.scss'],
})
export class SelectNetworkDialog implements OnInit {
  public network: ENetwork = ENetwork.LTC; // default like old version

  constructor(
    private rpcService: RpcService,
    public dialogRef: MatDialogRef<SelectNetworkDialog>,
    private router: Router,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private windowsService: WindowsService,
    private balanceService: BalanceService,
    private futures: FuturesMarketService,
    private spot: SpotMarketsService,
    private dialogService: DialogService
  ) {
    // enable click-off close
    this.dialogRef.disableClose = false;
    this.dialogRef.backdropClick().subscribe(() => this.cancel());
    this.dialogRef.afterClosed().subscribe(() => {
      console.log('[SelectNetworkDialog] closed');
    });
    if (typeof window !== 'undefined') {
      (window as any).__pm_networkOptions = this.networkOptions;
    }
  }

  ngOnInit(): void { }

  get networkOptions(): NetworkOpt[] {
    const defaults: ENetwork[] = [ENetwork.BTC, ENetwork.LTC, ENetwork.LTCTEST];
    const opts = defaults.map(v => ({ value: v, label: v.replace(/_/g, ' ') }));

    if (!opts.some(o => o.value === this.network)) {
      this.network = opts[0]?.value ?? this.network;
    }

    return opts;
  }

  async selectNetwork(): Promise<void> {
    try {
      this.loadingService.isLoading = true;

      this.rpcService.NETWORK = this.network;
      this.rpcService.isNetworkSelected = true;
      this.balanceService.NETWORK = this.network;
      this.spot.clearCache();
      this.futures.clearCache();
      this.spot.getMarkets();
      this.futures.getMarkets();


      this.dialogRef.close(true);

      // Old behaviour navigated to '/', keep that here
      this.router.navigateByUrl('/');

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
    console.log('[SelectNetworkDialog] cancel clicked');
    this.dialogRef.close(false);
    this.dialogService.closeAllDialogs();
    setTimeout(() => {
      const overlay = document.querySelector('.cdk-overlay-container');
      if (!overlay) return;
      overlay.querySelectorAll('.cdk-overlay-pane, .cdk-overlay-backdrop')
        .forEach((el) => el.remove());
    }, 0);
  }
}
