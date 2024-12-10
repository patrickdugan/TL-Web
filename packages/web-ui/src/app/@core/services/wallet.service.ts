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

  isWalletAvailable(): boolean {
    return !!window.myWallet;
  }

  async requestAccounts(): Promise<string[]> {
    if (this.isWalletAvailable()) {
      try {
        return await window.myWallet.sendRequest('requestAccounts', {});
      } catch (error) {
        console.error('Error requesting accounts:', error);
        throw new Error('Failed to request accounts');
      }
    }
    throw new Error('Wallet extension not detected');
  }

  async signMessage(message: string): Promise<string> {
    if (this.isWalletAvailable()) {
      try {
        return await window.myWallet.sendRequest('signMessage', { message });
      } catch (error) {
        console.error('Error signing message:', error);
        throw new Error('Failed to sign message');
      }
    }
    throw new Error('Wallet extension not detected');
  }

  async signTransaction(transaction: string): Promise<string> {
    if (this.isWalletAvailable()) {
      try {
        return await window.myWallet.sendRequest('signTx', { transaction });
      } catch (error) {
        console.error('Error signing transaction:', error);
        throw new Error('Failed to sign transaction');
      }
    }
    throw new Error('Wallet extension not detected');
  }

  async signPSBT(psbt: string): Promise<string> {
    if (this.isWalletAvailable()) {
      try {
        return await window.myWallet.sendRequest('signPSBT', { psbt });
      } catch (error) {
        console.error('Error signing PSBT:', error);
        throw new Error('Failed to sign PSBT');
      }
    }
    throw new Error('Wallet extension not detected');
  }
}
