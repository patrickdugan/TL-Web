import { AfterViewInit, Component, ElementRef, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { first } from 'rxjs/operators';
import { AttestationService } from 'src/app/@core/services/attestation.service';
import { AuthService, EAddress } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { PasswordDialog } from 'src/app/@shared/dialogs/password/password.component';
import { ENCODER } from 'src/app/utils/payloads/encoder'

@Component({
  selector: 'tl-portoflio-page',
  templateUrl: './portfolio-page.component.html',
  styleUrls: ['./portfolio-page.component.scss']
})
export class PortfolioPageComponent implements OnInit {
  cryptoBalanceColumns: string[] = ['attestation', 'address', 'confirmed', 'unconfirmed', 'actions'];
  tokensBalanceColums: string[] = ['propertyid', 'name', 'available', 'reserved', 'margin', 'channel', 'actions'];
  selectedAddress: string = '';


  constructor(
    private balanceService: BalanceService,
    private dialogService: DialogService,
    private toastrService: ToastrService,
    private authService: AuthService,
    private elRef: ElementRef,
    public matDialog: MatDialog,
    private rpcService: RpcService,
    private txsService: TxsService,
    private attestationService: AttestationService,
    private loadingService: LoadingService,
  ) {}

  get coinBalance() {
    return Object.keys(this.balanceService.allBalances)
      .map(address => ({ address, ...( this.balanceService.allBalances?.[address]?.coinBalance || {}) }));
  }

  get tokensBalances() {
    return this.balanceService.getTokensBalancesByAddress(this.selectedAddress);
  }

  get isAbleToRpc() {
    return this.rpcService.isAbleToRpc;
  }

  get isSynced() {
    return this.rpcService.isSynced;
  }

  ngOnInit(): void {
      this.authService.listOfallAddresses //getAddressesFromWallet();
  }

  shouldShowVesting(propertyId: number): boolean {
    // Show vesting column only for propertyId 2 and 3
    return propertyId === 2 || propertyId === 3;
  }

  getReservedOrVestingValue(element: any): string {
    if (element.propertyid === 2 || element.propertyid === 3) {
      // Display the vesting value
      return element.vesting !== undefined ? element.vesting.toFixed(6) : 'N/A';
    } else {
      // Display the reserved value
      return element.reserved !== undefined ? element.reserved.toFixed(6) : 'N/A';
    }
  }


  openDialog(dialog: string, address?: any, _propId?: number) {
    const data = { address, propId: _propId };
    const TYPE = dialog === 'deposit'
      ? DialogTypes.DEPOSIT
      : dialog === 'withdraw'
        ? DialogTypes.WITHDRAW
        : null;
    if (!TYPE || !data) return;
    this.dialogService.openDialog(TYPE, { disableClose: false, data });
  }

  async newAddress() {
    // if (this.authService.walletKeys.main.length > 2) {
    //   this.toastrService.error('The Limit of Main Addresses is Reached');
    //   return;
    // }
    // const passDialog = this.matDialog.open(PasswordDialog);
    // const password = await passDialog.afterClosed()
    //     .pipe(first())
    //     .toPromise();

    // if (!password) return;
    //await this.authService.addKeyPair();
    return
  }

  showTokens(address: string) {
    this.selectedAddress = address;
    try {
        const { nativeElement } = this.elRef;
        setTimeout(() => nativeElement.scrollTop = nativeElement.scrollHeight);
    } catch(err) { }   
  }

  copy(text: string) {
    navigator.clipboard.writeText(text);
    this.toastrService.info('Address Copied to clipboard', 'Copied');
  }

   getAddressAttestationStatus(address: string) {
     return this.attestationService.getAttByAddress(address);
   }
async selfAttestate(address: string) {
  try {
    this.loadingService.isLoading = true;

    const ipCheckResult = await this.attestationService.checkIP();
    const countryCode = ipCheckResult.attestation.country;

    const bannedCountries = ["US", "KP", "SY", "SD", "RU", "IR"];
    if (bannedCountries.includes(countryCode)) {
      this.toastrService.error('Cannot attest addresses originating from a sanctioned country.', `Address: ${address}`);
      return;
    }

    const attestationPayload = ENCODER.encodeAttestation({
      revoke: 0,
      id: 0,
      targetAddress: address,
      metaData: countryCode,
    });

    const res = await this.txsService.buildSignSendTx({
      fromKeyPair: { address },
      toKeyPair: { address },
      payload: attestationPayload, // Use the correct payload
    });

    if (res.data) {
      this.attestationService.setPendingAtt(address);
      this.toastrService.success(res.data, 'Transaction Sent');
    }
  } catch (error: any) {
    this.toastrService.error(error.message, 'Attestation Error');
  } finally {
    this.loadingService.isLoading = false;
  }
}



}