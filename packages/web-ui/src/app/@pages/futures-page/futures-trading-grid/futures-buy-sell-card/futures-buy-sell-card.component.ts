import { Component, OnDestroy, OnInit, ChangeDetectorRef  } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { ReplaySubject } from 'rxjs';
import { first, takeUntil } from 'rxjs/operators';
import { ApiService } from 'src/app/@core/services/api.service';
import { AttestationService } from 'src/app/@core/services/attestation.service';
import { AuthService, EAddress } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { WalletService } from 'src/app/@core/services/wallet.service'
import { FuturesMarketService, IFutureMarket, IToken } from 'src/app/@core/services/futures-services/futures-markets.service';
import { FuturesOrderbookService } from 'src/app/@core/services/futures-services/futures-orderbook.service';
import { FuturesOrdersService, IFuturesTradeConf } from 'src/app/@core/services/futures-services/futures-orders.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { PasswordDialog } from 'src/app/@shared/dialogs/password/password.component';
import { safeNumber } from 'src/app/utils/common.util';
import BigNumber from 'bignumber.js';

const minFeeLtcPerKb = 0.002;
const minVOutAmount = 0.000036;

@Component({
  selector: 'tl-futures-buy-sell-card',
  templateUrl: './futures-buy-sell-card.component.html',
  styleUrls: ['../../../spot-page/spot-trading-grid/spot-buy-sell-card/spot-buy-sell-card.component.scss'],
})

export class FuturesBuySellCardComponent implements OnInit, OnDestroy {
    private destroyed$: ReplaySubject<boolean> = new ReplaySubject(1);
    private _isLimitSelected: boolean = true;
    public buySellGroup: FormGroup = new FormGroup({});
    maxBuyAmount: number = 0;
    maxSellAmount: number = 0;
    buyFee: number = 0;
    sellFee: number = 0;
    nameBalanceInfo: any;
    attestationStatus: any;


    constructor(
      private futuresMarketService: FuturesMarketService,
      private balanceService: BalanceService,
      private fb: FormBuilder,
      private authService: AuthService,
      private toastrService: ToastrService,
      private attestationService: AttestationService,
      private loadingService: LoadingService,
      private rpcService: RpcService,
      private apiService: ApiService,
      private walletService: WalletService,
      private futuresOrdersService: FuturesOrdersService,
      private futuresOrderbookService: FuturesOrderbookService,
      public matDialog: MatDialog,
      private cdRef: ChangeDetectorRef
    ) {}

    get futureKeyPair() {
      const accounts = this.balanceService.allAccounts
      return accounts[0];
    }

    get futureAddress() {
      return this.futureKeyPair.address;
    }

    get isLoading(): boolean {
      return this.loadingService.tradesLoading;
    }

    get selectedMarket(): IFutureMarket {
      return this.futuresMarketService.selectedMarket
    }

    public forceRefresh() {
      this.cdRef.detectChanges();
    }

    get currentPrice() {
      return this.futuresOrderbookService.currentPrice;
    }

    get isLimitSelected() {
      return this._isLimitSelected;
    }

    set isLimitSelected(value: boolean) {
      this._isLimitSelected = value;
      this.buySellGroup.controls.price.setValue(this.currentPrice);
    }

    get reLayerApi() {
      return this.apiService.tlApi;
    }

      /*ngOnInit() {
        this.buildForms();
        this.trackPriceHandler();

        this.buySellGroup.valueChanges.pipe(takeUntil(this.destroyed$)).subscribe(() => {
          this.maxBuyAmount = this.getMaxAmount(true);
          this.maxSellAmount = this.getMaxAmount(false);
          this.buyFee = this.getFees(true);
          this.sellFee = this.getFees(false);
        });

        this.nameBalanceInfo = this.getNameBalanceInfo(this.selectedMarket.collateral);
      }*/

    ngOnInit() {
        this.buildForms();
        this.trackPriceHandler();

        this.buySellGroup.valueChanges
          .pipe(takeUntil(this.destroyed$))
          .subscribe(() => {
            this.maxBuyAmount = this.getMaxAmount();
            this.maxSellAmount = this.getMaxAmount();
            this.buyFee        = this.getFees(true);   // was calculateFee()
            this.sellFee       = this.getFees(false);  // was calculateFee()
          });

        this.nameBalanceInfo   = this.getNameBalanceInfo(this.selectedMarket.collateral);
        this.attestationStatus = this.isFutureAddressSelfAtt();  // was getAttestationStatus()
      }

      private contractsFromAmount(
          isInverse: boolean,
          notional: number,   // Per-contract notional in base (LTC per contract for inverse, TL per contract for linear)
          price: number,      // TL/LTC (or quote/base)
          amount: number      // User's input (TL for inverse, base asset for linear)
      ): number {
          if (isInverse) {
              // User input: TL; need contracts to reach amount TL exposure at price
              // contracts = (amount TL / price TL/LTC) / notional (LTC/contract)
              const ltc = new BigNumber(amount).dividedBy(price); // TL / (TL/LTC) = LTC
              return Math.floor(ltc.dividedBy(notional).toNumber());
          } else {
              // User input: BASE asset (e.g., LTC)
              // contracts = amount BASE / notional (BASE/contract)
              return Math.floor(new BigNumber(amount).dividedBy(notional).toNumber());
          }
      }


    private buildForms() {
      this.buySellGroup = this.fb.group({
        price: [null, [Validators.required, Validators.min(0.01)]],
        amount: [null, [Validators.required, Validators.min(0.01)]],
      })
    }

    /** Trigger a BUY (Long) order */
      public handleBuySellBuy(): void {
        this.handleBuySell(true);
      }

      /** Trigger a SELL (Short) order */
      public handleBuySellSell(): void {
        this.handleBuySell(false);
      }


    fillMax(isBuy: boolean) {
      const value  = this.getMaxAmount();
      this.buySellGroup.controls['amount'].setValue(value);

      // Update twice to recalc properly
      const value2 = this.getMaxAmount();
      this.buySellGroup.controls['amount'].setValue(value2);
    }

    getMaxAmount(): number {
      if (!this.futureAddress) return 0;

      // grab whatever price we're using
      const limitPrice = this.buySellGroup.controls.price.value;
      const marketPrice = this.currentPrice;

      // both of these could be null at first—so bail if so
      const raw = this.isLimitSelected ? limitPrice : marketPrice;
      if (raw == null) return 0;

      // now safe to coerce
      const price = safeNumber(raw);
      if (!price || price <= 0) return 0;

      const market = this.selectedMarket;
      const propId = market?.collateral?.propertyId;
      if (!propId) return 0;

      const tokenBalanceObj = this.balanceService
        .getTokensBalancesByAddress(this.futureAddress)
        .find((t: any) => t.propertyid === propId);

      let available = 0, channel = 0;
      if (tokenBalanceObj) {
        available = safeNumber(tokenBalanceObj.available);
        channel   = safeNumber(tokenBalanceObj.channel);
      }

      const collateralBalance = Math.max(available, channel);
      const leverage = market.leverage || 10;
      const notional = 1;

      return safeNumber((collateralBalance * leverage) / (price * notional));
    }

    async handleBuySell(isBuy: boolean) {
    const fee = this.getFees(isBuy);
    const available = safeNumber((this.balanceService.getCoinBalancesByAddress(this.futureAddress)?.confirmed || 0) - fee);
    if (available < 0) {
      this.toastrService.error(`You need at least: ${fee} LTC for this trade`);
      return;
    }
    
    const amount = this.buySellGroup.value.amount;
    const _price = this.buySellGroup.value.price;
    const price = this.isLimitSelected ? _price : this.currentPrice;

	const market      = this.selectedMarket;
	const collateral  = market.collateral.propertyId;
	const contract_id = market.contract_id;
	const isInverse = market.inverse  ?? false;
	const notional  = market.notional ?? 1;
	const leverage  = market.leverage ?? 10;

    try {
    const contracts = this.contractsFromAmount(isInverse, notional, price, amount);
        const initialMargin = this.calculateInitialMargin(isInverse, contracts, price, leverage, notional);


        const pubkey = this.futureKeyPair.pubkey

        // Get the available and channel amounts
        const tokenBalance = this.balanceService.getTokensBalancesByAddress(this.futureAddress)
            ?.find((t: any) => t.propertyid === collateral);

        let availableBalance = 0;
        let channelBalance = 0;

        if (tokenBalance) {
          availableBalance = safeNumber(tokenBalance.available || 0);
          channelBalance = safeNumber(tokenBalance.channel || 0);
        }

        let transfer = false;

        if (initialMargin <= channelBalance) {
          transfer = true;
        } else if (initialMargin <= availableBalance) {
          transfer = false; // Use available balance, no need for transfer from channel
        } else {
          this.toastrService.error(`Insufficient collateral for this trade.`);
          return;
        }

        if (!contract_id || (!price && this.isLimitSelected) || !amount) return;
        if (!this.futureKeyPair) return;

        const order: IFuturesTradeConf = { 
          keypair: {
            address: this.futureKeyPair.address,
            pubkey: pubkey,
          },
          action: isBuy ? "BUY" : "SELL",
          type: "FUTURES",
          props: {
            contract_id: contract_id,
            amount: contracts,
            price: price,
            collateral: collateral,
            margin: initialMargin,
            transfer: transfer
          },
          isLimitOrder: this.isLimitSelected,
          marketName: this.selectedMarket.pairString,
        };
        this.futuresOrdersService.newOrder(order);
        this.buySellGroup.reset();
    } catch (error) {
        console.error('Error in buy/sell process:', error);
        this.toastrService.error('An error occurred during the trade.');
    }  // This is the missing closing brace for the try block
}

    stopLiquidity() {
      console.log(`Stop Liquidity`);
    }

    /*addLiquidity(_amount: string, _orders_number: string, _range: string) {
      const amount = parseFloat(_amount);
      const orders_number = parseFloat(_orders_number);
      const range = parseFloat(_range);
      console.log({ amount, orders_number, range });
      return;
    }*/

    getButtonDisabled(): boolean {
      return !this.buySellGroup.valid
          || this.buySellGroup.value.amount > this.getMaxAmount();
    }

    private trackPriceHandler() {
      this.futuresOrderbookService.outsidePriceHandler
        .pipe(takeUntil(this.destroyed$))
        .subscribe(price => {
          this.buySellGroup.controls['price'].setValue(price);
        });
    }

    async newFutureAddress() {
    //   if (this.authService.walletKeys.futures.length) {
    //     this.toastrService.error('The Limit of Futures Addresses is Reached');
    //     return;
    //   }
    //   const passDialog = this.matDialog.open(PasswordDialog);
    //   const password = await passDialog.afterClosed()
    //       .pipe(first())
    //       .toPromise();
  
    //   if (!password) return;
    //   await this.authService.addKeyPair(EAddress.FUTURES, password);

    //   if (this.rpcService.NETWORK?.endsWith('TEST') && this.authService.activeFuturesKey?.address) {
    //     const fundRes = await this.reLayerApi.fundTestnetAddress(this.authService.activeFuturesKey.address).toPromise();
    //     if (fundRes.error || !fundRes.data) {
    //         this.toastrService.warning(fundRes.error, 'Faucet Error');
    //     } else {
    //         this.toastrService.success(`${this.authService.activeFuturesKey?.address} was Fund with small amount tLTC`, 'Testnet Faucet')
    //     }
    // }
    }

    getNameBalanceInfo(token: IToken) {
      const _balance = token.propertyId === -1
        ? this.balanceService.getCoinBalancesByAddress(this.futureAddress).confirmed
        : this.balanceService.getTokensBalancesByAddress(this.futureAddress)
          ?.find(e => e.propertyid === token.propertyId)?.available;
      const inOrderBalance = this.getInOrderAmount(token.propertyId);
      const balance = safeNumber((_balance  || 0) - inOrderBalance);
      return [token.fullName, `${ balance > 0 ? balance : 0 } ${token.shortName}`];
    }

    // Example of initial margin calculation based on inverse contract type
    calculateInitialMargin(
  isInverse: boolean,
  contracts: number,
  price: number,
  leverage: number,
  notional: number
) {
  let margin = 0;

  if (isInverse) {
    // Margin for inverse contract: (contracts * notional) / price / leverage
    margin = safeNumber((contracts * notional) / price / leverage);
  } else {
    // Margin for linear contract: (contracts * notional * price) / leverage
    margin = safeNumber((contracts * notional * price) / leverage);
  }

  return safeNumber(margin);
}


    private getInOrderAmount(propertyId: number) {
      const num = this.futuresOrdersService.openedOrders.map(o => {
        const { amount, price, collateral } = o.props;
        if (collateral === propertyId) return safeNumber(amount * price);
        return 0;
      }).reduce((a, b) => a + b, 0);
      return safeNumber(num);
    }
  
    
isFutureAddressSelfAtt() {
    const attestationStatus = this.attestationService.getAttByAddress(this.futureAddress);
    switch (attestationStatus) {
        case 'ATTESTED':
            return "YES";
        case 'NOT_ATTESTED':
            return "REVOKED";
        case 'PENDING':
        default:
            return "NO";
    }
}

    ngOnDestroy() {
      this.destroyed$.next(true);
      this.destroyed$.complete();
    }

    getFees(isBuy: boolean) {
      const { amount, price } = this.buySellGroup.value;
      if (!amount || !price) return 0;
      const finalInputs: number[] = [];
      const _amount = safeNumber((amount * price) + minVOutAmount);
      const _allAmounts = this.balanceService.getCoinBalancesByAddress(this.futureAddress).utxos
        .map(r => r.amount)
        .sort((a, b) => b - a);
      const allAmounts = [minVOutAmount, ..._allAmounts];
      allAmounts.forEach(u => {
        const amountSum = safeNumber(finalInputs.reduce((a, b) => a + b, 0));
        const _fee = safeNumber((0.3 * minFeeLtcPerKb) * (finalInputs.length + 1));
        if (amountSum < safeNumber(_amount + _fee)) finalInputs.push(u);
      });
      return safeNumber((0.3 * minFeeLtcPerKb) * (finalInputs.length));
    }

    closeAll() {
      this.futuresOrdersService.closeAllOrders();
    }
}
