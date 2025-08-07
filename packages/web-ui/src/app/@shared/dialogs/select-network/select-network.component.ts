import { Component, OnInit } from '@angular/core';
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
  network: ENetwork | null = null;
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
    // allow click-off
    this.dialogRef.disableClose = false;
    this.dialogRef.backdropClick().subscribe(() => this.dialogRef.close());
  }

  ngOnInit(): void {
    // Generic, runtime-safe population of enum -> options.
    // Works even if ENetwork values are strings or numbers.
    const keys = Object.keys(ENetwork).filter(k => isNaN(Number(k)));
    this.options = keys.map(k => ({
      value: (ENetwork as any)[k] as ENetwork,
      label: k.replace(/_/g, ' '),
    }));

    // (Optional) default select if only one option exists
    if (this.options.length === 1) this.network = this.options[0].value;
  }

  async confirm(): Promise<void> {
    if (!this.network) {
      this.toastrService.warning('Please select a network');
      return;
    }
    try {
      this.loadingService.isLoading = true;

      this.rpcService.NETWORK = t
