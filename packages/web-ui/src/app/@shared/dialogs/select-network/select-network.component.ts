import { ChangeDetectorRef, Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { SpotMarketsService } from 'src/app/@core/services/spot-services/spot-markets.service';
import { FuturesMarketService } from 'src/app/@core/services/futures-services/futures-markets.service';

type NetworkValue = 'BTC' | 'LTC' | 'LTCTEST';
type NetworkOpt = { value: NetworkValue; label: string };

const NETWORK_OPTIONS: NetworkOpt[] = [
  { value: 'BTC', label: 'BTC' },
  { value: 'LTC', label: 'LTC' },
  { value: 'LTCTEST', label: 'LTCTEST' },
];

@Component({
  selector: 'select-network-dialog',
  templateUrl: './select-network.component.html',
  styleUrls: ['./select-network.component.scss'],
})
export class SelectNetworkDialog implements OnInit {
  public network: NetworkValue = 'BTC';
  public options: NetworkOpt[] = NETWORK_OPTIONS;

  constructor(
    private rpcService: RpcService,
    public dialogRef: MatDialogRef<SelectNetworkDialog>,
    private router: Router,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private windowsService: WindowsService,
    private balanceService: BalanceService,
    private cdr: ChangeDetectorRef,
    private futures: FuturesMarketService,
    private spot: SpotMarketsService
  ) {
    // enable click-off close
    this.dialogRef.disableClose = false;
    this.dialogRef.backdropClick().subscribe(() => this.cancel());
  }

  ngOnInit(): void {
    this.options = [...NETWORK_OPTIONS];
    const currentNetwork = this.rpcService.NETWORK as NetworkValue | null;
    if (currentNetwork && this.options.some((opt) => opt.value === currentNetwork)) {
      this.network = currentNetwork;
    }
    if (!this.options.some((o) => o.value === this.network)) {
      this.network = this.options[0]?.value ?? this.network;
    }

    Promise.resolve().then(() => this.cdr.detectChanges());
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
    this.dialogRef.close(false);
  }
}
