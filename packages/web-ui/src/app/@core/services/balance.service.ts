import { Injectable } from '@angular/core';
import { ToastrService } from 'ngx-toastr';
import { AuthService } from './auth.service';
import { WalletService } from './wallet.service';
import { RpcService, TNETWORK } from "./rpc.service";

import axios from 'axios';

const minBlocksForBalanceConf: number = 1;
const emptyBalanceObj = {
  coinBalance: {
    confirmed: 0,
    unconfirmed: 0,
    utxos: [],
  },
  tokensBalance: [],
};


@Injectable({
  providedIn: 'root',
})
export class BalanceService {
  private url = "https://api.layerwallet.com";
  
  private accounts: { address: string; pubkey: string }[] = [];
  private _NETWORK: string = "LTC"; // Use a different backing field
  private _allBalancesObj: {
    [key: string]: {
      coinBalance: {
        confirmed: number;
        unconfirmed: number;
        utxos: any[];
      };
      tokensBalance: any[];
    };
  } = {};
  
  constructor(
    private authService: AuthService,
    private toastrService: ToastrService,
    private walletService: WalletService,
    private rpcService: RpcService
  ) {}

  get allBalances() {
    return this._allBalancesObj;
  }

  set NETWORK(network: string) {
    this._NETWORK = network; // Assign to the backing field
  }

  get NETWORK(): string {
    return this._NETWORK; // Return the backing field
  }

  get allAccounts() {
    return this.accounts;
  }

  async onInit() {

    if (!this.walletService.isWalletAvailable()) {
      console.warn('Wallet extension not detected');
      return;
    }

    this.authService.updateAddressesSubs$.subscribe(() => {
      this.restartBalance();
      this.updateBalances();
    });

    setInterval(() => this.updateBalances(), 5000);
  }

 async updateBalances() {
      console.log('network detected in balances '+this.rpcService.NETWORK)
     if(this._NETWORK=="LTCTEST"){
      this.url = 'https://testnet-api.layerwallet.com'
      console.log('network in portfolio '+this.rpcService.NETWORK+' '+this.url)
    }else{
      this.url = 'https://api.layerwallet.com'
    }

    try {
        const accounts = await this.walletService.requestAccounts();
        console.log("Accounts with pubkeys:", accounts);

        // Store accounts for synchronous access
      this.accounts = accounts.map((account) => ({
        address: account.address,
        pubkey: account.pubkey || '',
      }));



        for (const account of accounts) {
            const { address, pubkey } = account;
            console.log(`Processing address: ${address}, pubkey: ${pubkey}`);
            
            await this.updateCoinBalanceForAddressFromWallet(address, pubkey);
            await this.updateTokensBalanceForAddress(address);
        }
    } catch (error: any) {
        this.toastrService.warning(
            error.message || "Error with updating balances",
            "Balance Error"
        );
    }
}


  getTokensBalancesByAddress(address: string): any[] {
    return this._allBalancesObj[address]?.tokensBalance || [];
  }

  getCoinBalancesByAddress(address: string): { confirmed: number; unconfirmed: number; utxos: any[] } {
    return this._allBalancesObj[address]?.coinBalance || { confirmed: 0, unconfirmed: 0, utxos: [] };
  }

  sumAvailableCoins(): number {
    try {
      return Object.values(this._allBalancesObj)
        .reduce((sum, balanceObj) => sum + (balanceObj.coinBalance?.confirmed || 0), 0);
    } catch (error) {
      console.error('Error calculating available coins:', error);
      return 0; // Default to 0 in case of error
    }
  }


private async updateCoinBalanceForAddressFromWallet(address: string, pubkey?: string) {
    if (!address) throw new Error('No address provided for updating the balance');

    try {
      const payload = { pubkey };
      console.log('balance utxo query '+`${this.url}/address/utxo/${address}`)
      const { data: unspentUtxos } = await axios.post(`${this.url}/address/utxo/${address}`, payload);


      const confirmed = unspentUtxos
        .filter((utxo: any) => utxo.confirmations >= minBlocksForBalanceConf)
        .reduce((sum: number, utxo: any) => sum + utxo.amount, 0);

      const unconfirmed = unspentUtxos
        .filter((utxo: any) => utxo.confirmations < minBlocksForBalanceConf)
        .reduce((sum: number, utxo: any) => sum + utxo.amount, 0);

      if (!this._allBalancesObj[address]) this._allBalancesObj[address] = emptyBalanceObj;

      this._allBalancesObj[address].coinBalance = {
        confirmed: parseFloat(confirmed.toFixed(6)),
        unconfirmed: parseFloat(unconfirmed.toFixed(6)),
        utxos: unspentUtxos,
      };
    } catch (error: any) {
      throw new Error(`Failed to fetch coin balance for address ${address}: ${error.message}`);
    }
  }

  private async updateTokensBalanceForAddress(address: string) {
    if (!address) throw new Error('No address provided for updating the token balance');

    try {
      const { data: tokens } = await axios.get(`${this.url}/address/balance/${address}`);
      if (!this._allBalancesObj[address]) this._allBalancesObj[address] = emptyBalanceObj;

      this._allBalancesObj[address].tokensBalance = tokens.map((token: any) => ({
        name: token.ticker || '-',
        propertyid: parseInt(token.propertyId || '0', 10),
        amount: token.amount || 0,
        available: token.available || 0,
        reserved: token.reserved || 0,
        margin: token.margin || 0,
        vesting: token.vesting || 0,
        channel: token.channel || 0,
      }));
    } catch (error: any) {
      throw new Error(`Failed to fetch token balance for address ${address}: ${error.message}`);
    }
  }

  getTokenNameById(propertyId: number): string {
  // Iterate through all addresses and find the token name by propertyId
  for (const address in this._allBalancesObj) {
    const tokens = this._allBalancesObj[address]?.tokensBalance || [];
    const token = tokens.find((t: any) => t.propertyid === propertyId);
    if (token) {
      return token.name;
    }
  }
  // Return a default value if no token is found
  return 'Unknown Token';
}


  private restartBalance() {
    this._allBalancesObj = {};
  }
}
