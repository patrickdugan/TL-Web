import { AfterViewInit, Component, ElementRef, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { first } from 'rxjs/operators';
import { AttestationService } from 'src/app/@core/services/attestation.service';
import { AuthService } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { PasswordDialog } from 'src/app/@shared/dialogs/password/password.component';
import { ENCODER } from 'src/app/utils/payloads/encoder';
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
    private loadingService: LoadingService
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

  async getUserPublicIP(): Promise<string> {
    return new Promise((resolve, reject) => {
      const pc = new RTCPeerConnection({ iceServers: [] });
      pc.createDataChannel('');
      pc.onicecandidate = (event) => {
        if (event && event.candidate) {
          const candidate = event.candidate.candidate;
          const ipMatch = candidate.match(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
          if (ipMatch) {
            pc.close();
            resolve(ipMatch[0]);
          }
        }
      };
      pc.onicecandidateerror = () => {
        pc.close();
        reject(new Error('Failed to fetch public IP'));
      };
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .catch((error) => reject(error));
    });
  }

  async selfAttestate(address: string) {
    try {
      this.loadingService.isLoading = true;

      const userIP = await this.getUserPublicIP();
      console.log(`User's public IP: ${userIP}`);

      const ipCheckResult = await axios.post('https://api.layerwallet.com/chain/check-ip', { ip: userIP });

      if (!ipCheckResult.data || !ipCheckResult.data.success) {
        this.toastrService.error('IP check failed. Unable to attest address.', 'Attestation Error');
        return;
      }

      const countryCode = ipCheckResult.data.attestation.country;
      const bannedCountries = ['US', 'KP', 'SY', 'SD', 'RU', 'IR'];

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
        payload: attestationPayload,
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
