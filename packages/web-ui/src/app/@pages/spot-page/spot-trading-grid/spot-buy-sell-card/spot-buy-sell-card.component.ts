import { Component, OnDestroy, OnInit } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { MatDialog } from '@angular/material/dialog';
import { ToastrService } from 'ngx-toastr';
import { ReplaySubject } from 'rxjs';
import { first, takeUntil } from 'rxjs/operators';
import { ApiService } from 'src/app/@core/services/api.service';
import { AttestationService } from 'src/app/@core/services/attestation.service';
import { AuthService, EAddress } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
import { LoadingService } from 'src/app/@core/services/loading.service';
import { WalletService } from 'src/app/@core/services/wallet.service'
import { RpcService } from 'src/app/@core/services/rpc.service';
import { IMarket, IToken, SpotMarketsService } from 'src/app/@core/services/spot-services/spot-markets.service';
import { SpotOrderbookService } from 'src/app/@core/services/spot-services/spot-orderbook.service';
import { ISpotTradeConf, SpotOrdersService } from 'src/app/@core/services/spot-services/spot-orders.service';
import { IUTXO } from 'src/app/@core/services/txs.service';
import { PasswordDialog } from 'src/app/@shared/dialogs/password/password.component';
import { safeNumber } from 'src/app/utils/common.util';

const minFeeLtcPerKb = 0.0001;
const minVOutAmount = 0.0000546;

@Component({
  selector: 'tl-spot-buy-sell-card',
  templateUrl: './spot-buy-sell-card.component.html',
  styleUrls: ['./spot-buy-sell-card.component.scss'],
})
export class SpotBuySellCardComponent implements OnInit, OnDestroy {
    private destroyed$: ReplaySubject<boolean> = new ReplaySubject(1);
    buySellGroup: FormGroup = new FormGroup({});
    private _isLimitSelected: boolean = true;

    constructor(
      private spotMarketsService: SpotMarketsService,
      private balanceService: BalanceService,
      private fb: FormBuilder,
      private spotOrdersService: SpotOrdersService,
      private spotOrderbookService: SpotOrderbookService,
      private authService: AuthService,
      private toastrService: ToastrService,
      private attestationService: AttestationService,
      private loadingService: LoadingService,
      private rpcService: RpcService,
      private apiService: ApiService,
      private walletService: WalletService,
      public matDialog: MatDialog,
      private dialogService: DialogService,
    ) {}

    get spotKeyPair() {
      const accounts = this.balanceService.allAccounts
      return accounts[0];
    }

    get spotAddress() {
      return this.spotKeyPair.address;
    }

    get isLoading(): boolean {
      return this.loadingService.tradesLoading;
    }

    get selectedMarket(): IMarket {
      return this.spotMarketsService.selectedMarket;
    }

    get currentPrice() {
      return this.spotOrderbookService.currentPrice;
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

    ngOnInit() {
      this.buildForms();
      this.trackPriceHandler();
    }

    private buildForms() {
      this.buySellGroup = this.fb.group({
        price: [null, [Validators.required, Validators.min(0.0001)]],
        amount: [null, [Validators.required, Validators.min(0.00000001)]],
      })
    }

    fillMax(isBuy: boolean) {
      const value = this.getMaxAmount(isBuy);
      this.buySellGroup?.controls?.['amount'].setValue(value);
      // tricky update the Max Amount 
      const value2 = this.getMaxAmount(isBuy);
      this.buySellGroup?.controls?.['amount'].setValue(value2);
    }

    getTotal(isBuy: boolean): string {
      const { price, amount } = this.buySellGroup.value;
      const tokenName = isBuy 
        ? this.selectedMarket.second_token.shortName
        : this.selectedMarket.first_token.shortName;
      const _amount = isBuy
        ? (price * amount).toFixed(4)
        : (amount || 0).toFixed(4);
      return `${_amount} ${tokenName}`;
    }

   getMaxAmount(isBuy: boolean) {
        if (!this.spotAddress) return 0;
        if (!this.buySellGroup?.controls?.['price']?.value && this.isLimitSelected) return 0;
        
        const _price = this.isLimitSelected 
            ? this.buySellGroup.value['price'] 
            : this.currentPrice;
        const price = safeNumber(_price);

        const propId = isBuy
            ? this.selectedMarket.second_token.propertyId
            : this.selectedMarket.first_token.propertyId;

        let _available;
        if (propId === -1 || propId === 0) {
            // Handle LTC balance
            _available = safeNumber(this.balanceService.getCoinBalancesByAddress(this.spotAddress)?.confirmed - this.getFees(isBuy));
        } else {
            // Handle other tokens
            
            // Handle other tokens
            const tokenBalance = this.balanceService.getTokensBalancesByAddress(this.spotAddress)
                ?.find((t: any) => t.propertyid === propId);

           if (tokenBalance) {
                _available = safeNumber(Math.max(tokenBalance.available, tokenBalance.channel || 0));
            } else {
                _available = 0;
            }

        }

        const inOrderBalance = this.getInOrderAmount(propId);
        const available = safeNumber((_available || 0) - inOrderBalance);
        
        if (!available || ((available / price) <= 0)) return 0;

        const _max = isBuy ? (available / price) : available;
        const max = safeNumber(_max);
        
        return max;
    }
    
    async handleBuySell(isBuy: boolean) {
      const fee = this.getFees(isBuy);
      const available = safeNumber((this.balanceService.getCoinBalancesByAddress(this.spotAddress)?.confirmed || 0) - fee);
      
      if (available < 0) {
        this.toastrService.error(`You need at least: ${fee} LTC for this trade`);
        return;
      }

      const amount = this.buySellGroup.value.amount;
      const _price = this.buySellGroup.value.price;
      const price = this.isLimitSelected ? _price : this.currentPrice;

      const market = this.selectedMarket;
      const propIdForSale = isBuy ? market.second_token.propertyId : market.first_token.propertyId;
      const propIdDesired = isBuy ? market.first_token.propertyId : market.second_token.propertyId;

      if (propIdForSale === undefined || propIdForSale === null || 
            propIdDesired === undefined || propIdDesired === null || 
            (!price && this.isLimitSelected) || !amount) {
            return console.log('missing parameters for trade ' + propIdForSale + ' ' + propIdDesired + ' ' + price + ' ' + amount);
      }

      console.log('this spotkey in buy/sell '+this.spotKeyPair)
      if (!this.spotKeyPair){
        return console.log('missing key pair');
      }

      const pubkey = this.spotKeyPair.pubkey

      // Get the available and channel amounts
      const tokenBalance = this.balanceService.getTokensBalancesByAddress(this.spotAddress)
          ?.find((t: any) => t.propertyid === propIdForSale);
        console.log('token balance '+JSON.stringify(tokenBalance))
      let availableAmount = 0;
      let channelAmount = 0;
      
      let transfer = false
      if (tokenBalance) {
        availableAmount = safeNumber(tokenBalance.available);
        channelAmount = safeNumber(tokenBalance.channel || 0);
        console.log('checking fund sources in trade card '+availableAmount+' '+channelAmount)
        if(amount<=channelAmount){
            transfer = true
        }
      }

      console.log('checking transfer value '+transfer)

      // Pass both availableAmount and channelAmount to the swap service
      const order: ISpotTradeConf = { 
        keypair: {
          address: this.spotKeyPair.address,
          pubkey: pubkey,
        },
        action: isBuy ? "BUY" : "SELL",
        type: "SPOT",
        props: {
          id_desired: propIdDesired,
          id_for_sale: propIdForSale,
          amount: amount,
          price: price,
          transfer  // Pass transfer
        },
        isLimitOrder: this.isLimitSelected,
        marketName: this.selectedMarket.pairString,
      };

      console.log('about to place trade with available and channel amounts:', order);
      this.spotOrdersService.newOrder(order);
      this.buySellGroup.reset();
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
       const price = this.spotOrderbookService.lastPrice;
       const orders: ISpotTradeConf[] = [];
       const availableLtc = this.balanceService.getCoinBalancesByAddress(this.spotAddress)?.confirmed;
       const first =  this.selectedMarket.first_token.propertyId;
       const second = this.selectedMarket.second_token.propertyId;

       const availableFirst = first === -1
         ? this.balanceService.getCoinBalancesByAddress(this.spotAddress)?.confirmed
         : this.balanceService.getTokensBalancesByAddress(this.spotAddress)
           ?.find((t: any) => t.propertyid === first)
           ?.balance;

       const availableSecond = second === -1
         ? this.balanceService.getCoinBalancesByAddress(this.spotAddress)?.confirmed
         : this.balanceService.getTokensBalancesByAddress(this.spotAddress)
           ?.find((t: any) => t.propertyid === second)
           ?.balance;
      
       if (!availableFirst || !availableSecond || availableFirst < 1 || availableSecond < 1) {
         this.toastrService.error(`You Need At least balance of 1 from each: ${this.selectedMarket.pairString}`);
         return;
       }

       for (let i = 1; i < 11; i++) {
         const rawOrder = { 
           keypair: {
             address: this.spotKeyPair?.address,
             pubkey: this.spotKeyPair?.pubkey,
           },
           isLimitOrder: this.isLimitSelected,
           marketName: this.selectedMarket.pairString,
         };

         const buyProps = {
           id_desired: this.selectedMarket.second_token.propertyId,
           id_for_sale: this.selectedMarket.first_token.propertyId,
           amount: safeNumber(availableFirst / 10),
           price: safeNumber(price + i* (price / 10)),
         };

         const sellProps = {
           id_desired: this.selectedMarket.first_token.propertyId,
           id_for_sale: this.selectedMarket.second_token.propertyId,
           amount: safeNumber(availableSecond / 10),
           price: safeNumber(price - i* (price / 10)),
         };

         const buyOrder: ISpotTradeConf = {
           ...rawOrder, 
           type:"SPOT", 
           action: "SELL", 
           props: buyProps,
         };

         const sellOrder: ISpotTradeConf = {
           ...rawOrder, 
           type:"SPOT", 
           action: "BUY", 
           props: sellProps,
         };

         orders.push(buyOrder, sellOrder)
       }
       this.spotOrdersService.addLiquidity(orders);
    }*/

    getButtonDisabled(isBuy: boolean) {
      const v = this.buySellGroup.value.amount <= this.getMaxAmount(isBuy);
      return !this.buySellGroup.valid || !v;
    }

    private trackPriceHandler() {
      this.spotOrderbookService.outsidePriceHandler
        .pipe(takeUntil(this.destroyed$))
        .subscribe(price => {
          this.buySellGroup.controls['price'].setValue(price);
        });
    }

    async newSpotAddress() {
    //   if (this.authService.walletKeys.spot.length) {
    //     this.toastrService.error('The Limit of Spot Addresses is Reached');
    //     return;
    //   }
    //   const passDialog = this.matDialog.open(PasswordDialog);
    //   const password = await passDialog.afterClosed()
    //       .pipe(first())
    //       .toPromise();
  
    //   if (!password) return;
    //   await this.authService.addKeyPair(EAddress.SPOT, password);

    //   if (this.rpcService.NETWORK?.endsWith('TEST') && this.authService.activeSpotKey?.address) {
    //     const fundRes = await this.reLayerApi.fundTestnetAddress(this.authService.activeSpotKey.address).toPromise();
    //     if (fundRes.error || !fundRes.data) {
    //         this.toastrService.warning(fundRes.error, 'Faucet Error');
    //     } else {
    //         this.toastrService.success(`${this.authService.activeSpotKey?.address} was Fund with small amount tLTC`, 'Testnet Faucet')
    //     }
    // }
    }

    getNameBalanceInfo(token: IToken) {
      let _balance;
      if (token.propertyId === 0) {
        _balance = this.balanceService.getCoinBalancesByAddress(this.spotAddress)?.confirmed;
      } else {
        _balance = this.balanceService.getTokensBalancesByAddress(this.spotAddress)
          ?.find(e => e.propertyid === token.propertyId)?.available;
      }
      const inOrderBalance = this.getInOrderAmount(token.propertyId);
      const balance = safeNumber((_balance || 0) - inOrderBalance);
      return [token.fullName, `${balance > 0 ? balance : 0} ${token.shortName}`];
    }


    private getInOrderAmount(propertyId: number) {
      const num = this.spotOrdersService.openedOrders.map(o => {
        const { amount, price, id_for_sale } = o.props;
        if (propertyId === -1) {
          if (id_for_sale === -1) return safeNumber(amount * price);
          return 0.001;
        } else {
          if (id_for_sale === propertyId) return safeNumber(amount * price);
          return 0;
        }
      }).reduce((a, b) => a + b, 0);
      return safeNumber(num);
    }
  
   isSpotAddressSelfAtt() {
    const attestationStatus = this.attestationService.getAttByAddress(this.spotAddress);
    switch (attestationStatus) {
        case true:
            return "YES";
        case false:
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

        const propId = isBuy
            ? this.selectedMarket.second_token.propertyId
            : this.selectedMarket.first_token.propertyId;

        const minSmallOutput = 0.000072; // Define the threshold for small outputs
        let smallOutputCount = 0; // Initialize a count for small outputs
        const finalInputs: number[] = [];
        
        // Use a more conservative fee multiplier: 10-15%
        const feeMultiplier = propId === 0 ? 1.10 : 1.0; // Increase fee by 10% if propertyId is 0 (LTC)
        
        // Determine the required amount based on token or LTC
        const _amount = propId !== -1
            ? safeNumber(minVOutAmount * 2)
            : safeNumber((amount * price) + minVOutAmount);
        
        // Get all UTXO amounts and sort them
        const _allAmounts = this.balanceService.getCoinBalancesByAddress(this.spotAddress).utxos
            .map(r => r.amount)
            .sort((a, b) => b - a);

        // Add the minVOutAmount if dealing with LTC
        const allAmounts = propId !== -1
            ? _allAmounts
            : [minVOutAmount, ..._allAmounts];

        // Loop through inputs to ensure we have enough to cover the amount + fee
        allAmounts.forEach(u => {
            const _amountSum: number = finalInputs.map(a => a).reduce((a, b) => a + b, 0);
            const amountSum = safeNumber(_amountSum);
            const _fee = safeNumber(feeMultiplier * (0.3 * minFeeLtcPerKb) * (finalInputs.length + 1));

            // Add a small output only if we haven't added one yet
            if (u < minSmallOutput) {
                if (smallOutputCount > 0) return; // Skip if already added a small output
                smallOutputCount++;
            }

            // Check if we need more inputs to cover the total (amount + fee)
            if (amountSum < safeNumber(_amount + _fee)) finalInputs.push(u);
        });

        // Calculate the total fee as per the number of inputs, using the same logic as getEnoughInputs2
        const fee = safeNumber((0.3 * minFeeLtcPerKb) * finalInputs.length);

        // Return the final calculated fee
        return safeNumber(feeMultiplier * fee);
    }


    closeAll() {
      this.spotOrdersService.closeAllOrders();
    }

    transfer() {
      const data = {
        firstToken: this.selectedMarket.first_token,
        secondToken: this.selectedMarket.second_token,
        address: this.spotAddress,
      };
  
      this.dialogService.openDialog(DialogTypes.TRANSFER, { data });
    }
}
