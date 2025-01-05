import { AfterViewInit, Component, ElementRef, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { first } from 'rxjs/operators';
import { AttestationService } from 'src/app/@core/services/attestation.service';
import { AuthService } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { RpcService, TNETWORK } from 'src/app/@core/services/rpc.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { PasswordDialog } from 'src/app/@shared/dialogs/password/password.component';
import { ENCODER } from 'src/app/utils/payloads/encoder';
import { WalletService } from 'src/app/@core/services/wallet.service'
import axios from 'axios';

@Component({
  selector: 'tl-portoflio-page',
  templateUrl: './portfolio-page.component.html',
  styleUrls: ['./portfolio-page.component.scss'],
})
export class PortfolioPageComponent implements OnInit {
  cryptoBalanceColumns: string[] = ['attestation', 'address', 'confirmed', 'unconfirmed', 'actions'];
  tokensBalanceColums: string[] = ['propertyid', 'name', 'available', 'reserved', 'margin', 'channel', 'actions'];
  selectedAddress: string = '';
  private url = "https://api.layerwallet.com";

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
    private walletService: WalletService
  ) {}

  get coinBalance() {
    return Object.keys(this.balanceService.allBalances).map((address) => ({
      address,
      ...(this.balanceService.allBalances?.[address]?.coinBalance || {}),
    }));
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
    this.authService.listOfallAddresses; // Placeholder for actual logic
  }

  shouldShowVesting(propertyId: number): boolean {
    return propertyId === 2 || propertyId === 3;
  }

  getReservedOrVestingValue(element: any): string {
    if (element.propertyid === 2 || element.propertyid === 3) {
      return element.vesting !== undefined ? element.vesting.toFixed(6) : 'N/A';
    } else {
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
    // Placeholder for adding new address logic
    return;
  }

  showTokens(address: string) {
    this.selectedAddress = address;
    try {
      const { nativeElement } = this.elRef;
      setTimeout(() => (nativeElement.scrollTop = nativeElement.scrollHeight));
    } catch (err) {}
  }

  copy(text: string) {
    navigator.clipboard.writeText(text);
    this.toastrService.info('Address Copied to clipboard', 'Copied');
  }

  getAddressAttestationStatus(address: string) {
    return this.attestationService.getAttByAddress(address);
  }

    async selfAttestate(_address: string) {
    try {
      this.loadingService.isLoading = true;

      const response = await this.walletService.checkIP();

       const { ip, isVpn, countryCode } = response;
        console.log('Fetched IP details:', ip, isVpn, countryCode);

        if (isVpn) {
          this.toastrService.error(
            'Your IP is flagged as a VPN or proxy. Please disable it to proceed.',
            'VPN Detected'
          );
          return
        }

        if (['US', 'KP', 'SY', 'SD', 'RU', 'IR'].includes(countryCode.toUpperCase())) {
          this.toastrService.error(
            'Your IP is from a prohibited country..',
            'Sanctioned Country'
          );
          return
        }

      const attestationPayload = ENCODER.encodeAttestation({
        revoke: 0,
        id: 0,
        targetAddress: _address,
        metaData: countryCode,
      });

      console.log('attest payload '+attestationPayload+' '+_address)

       const accounts = await this.walletService.requestAccounts();
        console.log("Accounts with pubkeys:", accounts);
        let _pubkey = ''
        for (const account of accounts) {
            const { address, pubkey } = account;
            if(_address==address ){
              _pubkey = pubkey ?? ''
            }
            console.log(`Processing address: ${address}, pubkey: ${pubkey}`);
         }
        
        const network = this.rpcService.NETWORK; // 'LTC' or 'LTCTEST'
        if(network=='LTCTEST'){
          this.url = 'https://testnet-api.layerwallet.com'
        }
        console.log('network in portfolio '+network+' '+this.url)

      const payload = { _pubkey };
      console.log('attestation utxo query '+`${this.url}/address/utxo/${_address}`)
      const { data: unspentUtxos } = await axios.post(`${this.url}/address/utxo/${_address}`, payload);


      const res = await this.txsService.buildSignSendTx({
        fromKeyPair: { address: _address },
        toKeyPair:   { address: _address }, // e.g. same address if needed
        amount:      0.0000564,
        network:     'LTCTEST',
        payload:     attestationPayload,
        inputs:      unspentUtxos,  // pass your newly-fetched UTXOs
      });

      if (res.data) {
        this.attestationService.setPendingAtt(_address);
        this.toastrService.success(res.data, 'Transaction Sent');
      }
    } catch (error: any) {
      this.toastrService.error(error.message, 'Attestation Error');
    } finally {
      this.loadingService.isLoading = false;
    }
  }

}
