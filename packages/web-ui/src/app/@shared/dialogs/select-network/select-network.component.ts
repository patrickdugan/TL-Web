import { Component, OnInit } from '@angular/core';
import { MatDialogRef } from '@angular/material/dialog';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { ENetwork, RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';
import { BalanceService } from 'src/app/@core/services/balance.service';

type NetworkOpt = { value: ENetwork | string; label: string };

@Component({
  selector: 'select-network-dialog',
  templateUrl: './select-network.component.html',
  styleUrls: ['./select-network.component.scss'],
})
export class SelectNetworkDialog implements OnInit {
  network: ENetwork | string | null = null;
  options: NetworkOpt[] = [];

  constructor(
    public dialogRef: MatDialogRef<SelectNetworkDialog>,
    private router: Router,
    private toastrService: ToastrService,
    private loadingService: LoadingService,
    private rpcService: RpcService,
    private windowsService: WindowsService,
    private balanceService: BalanceService
  ) {
    this.dialogRef.disableClose = false;
    this.dialogRef.backdropClick().subscribe(() => this.cancel());
  }

  ngOnInit(): void {
    const keys = Object.keys(ENetwork).filter(k => isNaN(Number(k)));
    if (keys.length) {
      this.options = keys.map(k => ({
        value: (ENetwork as any)[k],
        label: k.replace(/_/g, ' ')
      }));
    } else {
      // Fallback if enum is empty
      this.options = [
        { value: 'MAINNET', label: 'Mainnet' },
        { value: 'TESTNET', label: 'Testnet' }
      ];
    }
  }

  async confirm(): Promise<void> {
    if (!this.network) {
      this.toastrService.warning('Please select a network');
      return;
    }
    try {
      this.loadingService.isLoading = true;

      this.rpcService.NETWORK = this.network as ENetwork;
      this.rpcService.isNetworkSelected = true;
      this.balanceService.NETWORK = this.network as ENetwork;

      this.dialogRef.close(true);
      this.router.navigateByUrl('/futures');

      const tab = this.windowsService.tabs.find(t => t.title === 'Servers');
      if (tab) tab.minimized = false;
    } catch (error: any) {
      this.toastrService.error(error?.message || 'Failed to set network', 'Error');
    } finally {
      this.loadingService.isLoading = false;
    }
  }

  cancel(): void {
    this.dialogRef.close(false);
  }
}
