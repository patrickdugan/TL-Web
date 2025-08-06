import { Injectable } from '@angular/core';
import { RpcService } from './rpc.service';

@Injectable({
  providedIn: 'root',
})
export class WalletService {
  constructor(private rpc: RpcService) {
    
    if (!window.myWallet) {
      console.warn('Wallet extension not detected');
    }
  }

  private ensureWalletAvailable(): void {
    if (!window.myWallet) {
      throw new Error('Wallet extension not detected');
    }
  }

  isWalletAvailable(): boolean {
    return !!window.myWallet;
  }

async requestAccounts(network?:string): Promise<{ address: string; pubkey?: string }[]> {
  this.ensureWalletAvailable();
  try {
    const accounts = await window.myWallet!.sendRequest('requestAccounts', {network:network});
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned by the wallet');
    }

    // Ensure the accounts have both `address` and an optional `pubkey`
    return accounts.map((account: { address: string; pubkey?: string }) => ({
      address: account.address,
      pubkey: account.pubkey, // Allow pubkey to be undefined
    }));
  } catch (error: any) {
    console.error('Error requesting accounts:', error.message);
    throw new Error('Failed to request accounts');
  }
}



  async signMessage(message: string): Promise<string> {
    this.ensureWalletAvailable();
    try {
      return await window.myWallet!.sendRequest('signMessage', { message }); // Non-null assertion
    } catch (error) {
      console.error('Error signing message:', error);
      throw new Error('Failed to sign message');
    }
  }

  async addMultisig(m: number, pubkeys: string[]): Promise<{ address: string; redeemScript?: string }> {
  this.ensureWalletAvailable();

  console.log('showing network in walletService '+this.rpc.NETWORK)
  let network = this.rpc.NETWORK || "LTC"
  if(network==undefined){network = "LTC"}
  const payload = { m, pubkeys, network: this.rpc.NETWORK};

    console.log('about to call window with multisig params '+JSON.stringify(payload))
  try {
    // Use actual variables `m` and `pubkeys` in the payload
    
    return await window.myWallet!.sendRequest('addMultisig', payload); // Non-null assertion
  } catch (error) {
    console.error('Error adding multisig address:', error);
    throw new Error('Failed to add multisig address');
  }
}

 async signTransaction(transaction: string, network: string): Promise<string> {
    this.ensureWalletAvailable();
    try {
      return await window.myWallet!.sendRequest('signTransaction', { transaction, network }); // Non-null assertion
    } catch (error) {
      console.error('Error signing transaction:', error);
      throw new Error('Failed to sign transaction');
    }
  }

  async signPSBT(psbt: string): Promise<string> {
    this.ensureWalletAvailable();
    try {
      return await window.myWallet!.sendRequest('signPSBT', { transaction:psbt, network: this.rpc.NETWORK }); // Non-null assertion
    } catch (error) {
      console.error('Error signing PSBT:', error);
      throw new Error('Failed to sign PSBT');
    }
  }

  async checkIP(): Promise<{ ip: string; isVpn: boolean, countryCode: string }> {
      try {
        const response = await window.myWallet!.sendRequest('fetchUserIP', {});
        return response

       
      } catch (error: any) {
        console.error('Error fetching user IP:', error.message);
        return error
      }
  }

  async signPsbt(psbtHex: string, redeemKey?: string): Promise<string> {
    this.ensureWalletAvailable();
    try {
        return await window.myWallet!.sendRequest('signPsbt', { psbtHex, redeemKey });
    } catch (error) {
        console.error('Error signing PSBT:', error);
        throw new Error('Failed to sign PSBT');
    }
  }

}
