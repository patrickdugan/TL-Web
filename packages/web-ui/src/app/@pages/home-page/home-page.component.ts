import { Component } from '@angular/core';
import { ConnectionService } from 'src/app/@core/services/connections.service';
import { ToastrService } from 'ngx-toastr';

@Component({
  selector: 'tl-home-page',
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss']
})
export class HomePageComponent {

  constructor(
    private connectionService: ConnectionService,
    private toastrService: ToastrService
  ) {}

  public walletAddress: string | null = null;
  public balanceVisible: boolean = false;

  async connectWallet() {
    try {
      // Check if the browser wallet is available
      if ((window as any).ethereum) {
        // Request accounts from the wallet
        const accounts = await (window as any).ethereum.request({
          method: 'eth_requestAccounts',
        });

        // Use the first account as the connected wallet address
        this.walletAddress = accounts[0];
        this.balanceVisible = true;

        this.toastrService.success('Wallet connected successfully!');
      } else {
        this.toastrService.error('No wallet detected. Please install a browser wallet extension.');
      }
    } catch (error) {
      console.error('Wallet connection error:', error);
      this.toastrService.error('Failed to connect wallet.');
    }
  }

  setupWalletListeners() {
    const wallet = (window as any).myWallet;

    if (wallet) {
      wallet.on('accountsChanged', (accounts: string[]) => {
        console.log('Accounts changed:', accounts);
        this.walletAddress = accounts[0] || null;
        this.balanceVisible = !!accounts[0];
      });

      wallet.on('networkChanged', (network: string) => {
        console.log('Network changed:', network);
      });
    }
  }

  // Abbreviate the wallet address for display
  get abbreviatedAddress() {
    if (!this.walletAddress) return '';
    return `${this.walletAddress.slice(0, 6)}...${this.walletAddress.slice(-4)}`;
  }
}

