import { Component, ElementRef, OnDestroy, OnInit } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { HttpClient } from '@angular/common/http';
import { ToastrService } from 'ngx-toastr';
import { AttestationService } from 'src/app/@core/services/attestation.service';
import { AuthService } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { TxsService } from 'src/app/@core/services/txs.service';
import { ENCODER } from 'src/app/utils/payloads/encoder';
import { WalletService } from 'src/app/@core/services/wallet.service'
import { ProceduralRuntimeConfig, ProceduralRuntimeService } from 'src/app/@core/services/procedural-runtime.service';
import { environment } from 'src/environments/environment';
import { Subject } from 'rxjs';
import { takeUntil } from 'rxjs/operators';

@Component({
  selector: 'tl-portoflio-page',
  templateUrl: './portfolio-page.component.html',
  styleUrls: ['./portfolio-page.component.scss'],
})
export class PortfolioPageComponent implements OnInit {
  cryptoBalanceColumns: string[] = ['attestation', 'address', 'confirmed', 'unconfirmed', 'tokens', 'actions'];
  tokensBalanceColums: string[] = ['propertyid', 'name', 'available', 'reserved', 'margin', 'channel', 'actions'];
  selectedAddress: string = '';
  hideZeroBalances = false;
  private url = "https://ws.layerwallet.com/relayer";
  receiptPropertyId: number | null = null;
  proceduralConfig: ProceduralRuntimeConfig | null = null;
  private destroy$ = new Subject<void>();

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
    private walletService: WalletService,
    private http: HttpClient,
    private proceduralRuntime: ProceduralRuntimeService
  ) {}

  get coinBalance() {
    const addresses = Object.keys(this.balanceService.allBalances || {});
    const nextRows = addresses
      .map((address, index) => {
        const coinBalance = this.balanceService.getCoinBalancesByAddress(address) || {};
        const hasNativeBalance = this.hasNativeBalance(coinBalance);
        const hasTokenBalance = this.hasTokenBalance(address);
        return {
          address,
          index,
          hasAnyBalance: hasNativeBalance || hasTokenBalance,
          tokenSummary: this.getTokenSummaryForAddress(address),
          ...coinBalance,
        };
      })
      .filter((row) => !this.hideZeroBalances || row.hasAnyBalance)
      .sort((a, b) => {
        if (a.hasAnyBalance !== b.hasAnyBalance) {
          return a.hasAnyBalance ? -1 : 1;
        }

        const aConfirmed = Number(a.confirmed || 0);
        const bConfirmed = Number(b.confirmed || 0);
        if (aConfirmed !== bConfirmed) {
          return bConfirmed - aConfirmed;
        }

        const aUnconfirmed = Number(a.unconfirmed || 0);
        const bUnconfirmed = Number(b.unconfirmed || 0);
        if (aUnconfirmed !== bUnconfirmed) {
          return bUnconfirmed - aUnconfirmed;
        }

        return a.index - b.index;
      })
      .map(({ index, hasAnyBalance, ...balanceRow }) => balanceRow);

    return nextRows;
  }

  get tokensBalances() {
    return this.balanceService.getTokensBalancesByAddress(this.selectedAddress);
  }

  get selectedCoinBalance() {
    return this.selectedAddress
      ? this.balanceService.getCoinBalancesByAddress(this.selectedAddress)
      : { confirmed: 0, unconfirmed: 0, utxos: [] as any[] };
  }

  get selectedUtxos() {
    return this.selectedCoinBalance.utxos || [];
  }

  formatBalance(value: any): string {
    return Number(value || 0).toFixed(6);
  }

  private hasNativeBalance(balance: any): boolean {
    const confirmed = Number(balance?.confirmed || 0);
    const unconfirmed = Number(balance?.unconfirmed || 0);
    return confirmed > 0 || unconfirmed > 0;
  }

  private hasTokenBalance(address: string): boolean {
    const balances = this.balanceService.getTokensBalancesByAddress(address) || [];
    return balances.some((row: any) => {
      return ['amount', 'available', 'reserved', 'margin', 'vesting', 'channel']
        .some((field) => Math.abs(Number(row?.[field] || 0)) > 0);
    });
  }

  getTokenSummaryForAddress(address: string): string {
    const balances = this.balanceService.getTokensBalancesByAddress(address) || [];
    const nonZeroBalances = balances
      .map((row: any) => {
        const total = ['available', 'reserved', 'margin', 'vesting', 'channel']
          .reduce((sum, field) => sum + Number(row?.[field] || 0), 0);
        return {
          label: row?.name || row?.ticker || row?.rawPropertyId || row?.propertyid || 'Token',
          total,
        };
      })
      .filter((row) => Math.abs(row.total) > 0);

    if (!nonZeroBalances.length) return '-';

    return nonZeroBalances
      .slice(0, 3)
      .map((row) => `${row.label}: ${Number(row.total.toFixed(6))}`)
      .join(', ');
  }

  get isAbleToRpc() {
    return this.rpcService.isAbleToRpc;
  }

  get walletBootstrapStatus(): string {
    if (!this.walletService.isWalletAvailable()) return 'Waiting for wallet extension...';
    if (!this.walletService.address$.value) return 'Wallet loaded, waiting for connection...';
    return '';
  }

  get isSynced() {
    return this.rpcService.isSynced;
  }

  get nativeAssetLabel() {
    return this.balanceService.NETWORK === 'BTC' ? 'tBTC' : 'tLTC';
  }

  get isLtctest() {
    return this.balanceService.NETWORK === 'LTCTEST';
  }

  get hasProceduralSupport() {
    return this.proceduralRuntime.isExecutableConfig(this.proceduralConfig);
  }

  get underlyingAssetLabel() {
    return this.balanceService.NETWORK === 'BTC' ? 'BTC' : 'LTC';
  }

  get relayerRpcBase() {
    const network = this.balanceService.NETWORK || 'LTC';
    return `${environment.ENDPOINTS[network]?.relayerUrl || environment.ENDPOINTS.LTC.relayerUrl}/rpc`;
  }

  ngOnInit(): void {
    this.authService.listOfallAddresses; // Placeholder for actual logic
    this.loadProceduralRuntime();

    this.walletService.address$
      .pipe(takeUntil(this.destroy$))
      .subscribe((address) => {
        if (!address) {
          return;
        }

        if (this.selectedAddress !== address) {
          this.selectedAddress = address;
        }
      });

    const currentAddress = this.walletService.address$.value;
    if (currentAddress && !this.selectedAddress) {
      this.selectedAddress = currentAddress;
    }
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }

  shouldShowVesting(propertyId: number): boolean {
    return propertyId === 2 || propertyId === 3;
  }

  getReservedOrVestingValue(element: any): string {
    if (element.propertyid === 2 || element.propertyid === 3) {
      return Number(element?.vesting || 0).toFixed(6);
    } else {
      return Number(element?.reserved || 0).toFixed(6);
    }
  }

  isProceduralReceiptRow(row: any): boolean {
    return Number(row?.propertyid) === Number(this.receiptPropertyId || 0);
  }

  openDialog(dialog: string, address?: any, _propId?: number | string, _amount?:number, extraData: any = {}) {
    const data = { address, propId: _propId, amount: _amount, available: _amount, ...extraData };

    let TYPE = null;
    if (dialog === 'deposit') {
      TYPE = DialogTypes.DEPOSIT;
    } else if (dialog === 'withdraw') {
      TYPE = DialogTypes.WITHDRAW;
    } else if (dialog === 'synth') {
      TYPE = DialogTypes.SYNTH;
    }

    if (!TYPE || !data) return;
    const dialogRef = this.dialogService.openDialog(TYPE, { disableClose: false, data });
    if (dialog === 'synth') {
      dialogRef?.afterClosed()?.subscribe(() => {
        this.loadProceduralRuntime();
      });
    }
  }

  openTokenizeDialog(address: string, amount?: number) {
    if (!this.isLtctest) {
      this.toastrService.error(
        this.proceduralConfig?.contextErrors?.[0]
          || this.proceduralConfig?.contextWarnings?.[0]
          || 'Procedural mint is only configured for LTC testnet.'
      );
      return;
    }

    const canonicalAmount = Number(this.proceduralConfig?.fundedAmountLtc ?? amount ?? 0);
    this.openDialog(
      'synth',
      address,
      Number(this.receiptPropertyId || this.proceduralConfig?.receiptPropertyId || 1),
      canonicalAmount > 0 ? canonicalAmount : amount,
      {
        mode: 'mint',
        flow: 'proceduralReceipt',
        title: `Mint ${this.underlyingAssetLabel}`,
        actionLabel: `Mint ${this.underlyingAssetLabel}`,
        underlyingAssetLabel: this.underlyingAssetLabel,
        refreshProceduralArtifacts: true,
        underlyingPropertyId: 0,
        proceduralArtifactMode: 'fresh',
        proceduralPathName: this.proceduralConfig?.selectedPathId || 'roll',
      }
    );
  }

  openTokenActionDialog(address: string, row: any) {
    const isProceduralReceipt = this.isProceduralReceiptRow(row);
    if (!isProceduralReceipt) {
      return;
    }
    this.openDialog('synth', address, row.rawPropertyId || row.propertyid, row.available, {
      mode: 'redeem',
      flow: 'proceduralReceipt',
      title: `Redeem ${this.underlyingAssetLabel}`,
      actionLabel: `Redeem ${this.underlyingAssetLabel}`,
      underlyingAssetLabel: this.underlyingAssetLabel,
      refreshProceduralArtifacts: true,
      underlyingPropertyId: 0,
      proceduralArtifactMode: 'replay',
      proceduralPathName: this.proceduralConfig?.selectedPathId || 'roll',
    });
  }

  async loadReceiptPropertyId() {
    if (this.proceduralConfig?.receiptPropertyId) {
      this.receiptPropertyId = Number(this.proceduralConfig.receiptPropertyId);
      return;
    }

    try {
      const properties: any = await this.http
        .post(`${this.relayerRpcBase}/tl_listproperties`, {})
        .toPromise();
      const propertyList = Array.isArray(properties?.data) ? properties.data : Array.isArray(properties) ? properties : [];
      const receiptTicker = String(this.proceduralConfig?.receiptTicker || '').toUpperCase();
      const match = propertyList.find((property: any) => {
        return String(property?.ticker || '').toUpperCase() === receiptTicker;
      });

      this.receiptPropertyId = match?.id != null ? Number(match.id) : null;
    } catch (error) {
      console.error('Error resolving procedural receipt property id:', error);
      this.receiptPropertyId = null;
    }
  }

  async loadProceduralRuntime() {
    this.proceduralConfig = await this.proceduralRuntime.loadConfig();
    await this.loadReceiptPropertyId();
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

       const accounts = await this.walletService.requestAccounts(this.balanceService.NETWORK);
        console.log("Accounts with pubkeys:", accounts);
        let _pubkey = ''
        for (const account of accounts) {
            const { address, pubkey } = account;
            console.log('account '+ account)
            if(_address==address){
              _pubkey = pubkey ?? ''
              console.log('do we have a winner '+_pubkey)
            }
            console.log(`Processing address: ${address}, pubkey: ${pubkey}`);
         }
        
        const network = this.balanceService.NETWORK; // 'LTC' or 'LTCTEST'
        this.url = environment.ENDPOINTS[network]?.relayerUrl || environment.ENDPOINTS.LTC.relayerUrl;
        console.log('network in portfolio '+network+' '+this.url)

      const payload = { pubkey:_pubkey };
      console.log('attestation utxo query and payload '+`${this.url}/address/utxo/${_address}` + JSON.stringify(payload))
      const utxoRes = await this.txsService.fetchUTXOs(_address, _pubkey);
      const unspentUtxos = (utxoRes as any)?.data || utxoRes;


      const res = await this.txsService.buildSignSendTx({
        fromKeyPair: { address: _address },
        toKeyPair:   { address: _address }, // e.g. same address if needed
        amount:      0.0000564,
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
