import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root',
})
export class WalletService {
  constructor() {
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

async requestAccounts(): Promise<{ address: string; pubkey?: string }[]> {
  this.ensureWalletAvailable();
  try {
    const accounts = await window.myWallet!.sendRequest('requestAccounts', {});
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

  async signTransaction(transaction: string): Promise<string> {
    this.ensureWalletAvailable();
    try {
      return await window.myWallet!.sendRequest('signTx', { transaction }); // Non-null assertion
    } catch (error) {
      console.error('Error signing transaction:', error);
      throw new Error('Failed to sign transaction');
    }
  }

  async signPSBT(psbt: string): Promise<string> {
    this.ensureWalletAvailable();
    try {
      return await window.myWallet!.sendRequest('signPSBT', { psbt }); // Non-null assertion
    } catch (error) {
      console.error('Error signing PSBT:', error);
      throw new Error('Failed to sign PSBT');
    }
  }

  async checkIP(): Promise<{ ip: string; isVpn: boolean, countryCode: string }> {
      try {
        const response = await window.myWallet!.sendRequest('fetchUserIP', {});
        if (!response.success) {
          throw new Error(response.error || 'Failed to fetch user IP.');
        }
        return response

       
      } catch (error: any) {
        console.error('Error fetching user IP:', error.message);
        return error
      }
    }
}
