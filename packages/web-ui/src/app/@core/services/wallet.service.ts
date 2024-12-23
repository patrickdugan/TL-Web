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

  async requestAccounts(): Promise<string[]> {
    this.ensureWalletAvailable();
    try {
      return await window.myWallet!.sendRequest('requestAccounts', {}); // Non-null assertion
    } catch (error) {
      console.error('Error requesting accounts:', error);
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
}
