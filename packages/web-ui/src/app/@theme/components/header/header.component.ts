import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { AuthService } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { ConnectionService } from 'src/app/@core/services/connections.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';

@Component({
  selector: 'tl-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})

export class HeaderComponent implements OnInit {
  private _mainRoutes: {
    id: number;
    name: string;
    link: string;
    needAuthToShow: boolean;
    needFullSynced?: boolean;
  }[] = [
    {
      id: 1,
      name: 'Home',
      link: '/',
      needAuthToShow: false,
    },
    {
      id: 2,
      name: 'Portfolio',
      link: '/portfolio',
      needAuthToShow: false,
      needFullSynced: false,
    },
    {
      id: 3,
      name: 'Spot Trading',
      link: '/spot',
      needAuthToShow: false,
      needFullSynced: true,
    },
    //{
    //   id: 4,
    //   name: 'Futures Trading',
    //   link: '/futures',
    //   needAuthToShow: false,
    // },
    // {
    //   id: 5,
    //   name: 'Node Reward',
    //   link: '/node-reward',
    //   needAuthToShow: false,
    //   needFullSynced: true,
    // },
    // {
    //   id: 6,
    //   name: 'Tx Builder',
    //   link: '/tx-builder',
    //   needAuthToShow: false,
    // }
  ];

  public walletAddress: string | null = null;
  public balanceVisible: boolean = false;

  private _selectedRoute: any = this._mainRoutes[0];
  public balanceLoading: boolean = false;
  constructor(
    private router: Router,
    private authService: AuthService,
    private balanceService: BalanceService,
    private connectionService: ConnectionService,
    private windowsService: WindowsService,
    private toastrService: ToastrService,
    private rpcService: RpcService,
  ) { }

  get selectedRoute(){
    return this._selectedRoute;
  }

  set selectedRoute(value: any){
    this._selectedRoute = value;
  }

  get mainRoutes(){
    return this._mainRoutes
      .filter(e => e.needAuthToShow ? this.isLoggedIn : true)
      .filter(e => e.needFullSynced ? this.isSynced : true);
  }

  get availableBalance() {
    return this.balanceService.sumAvailableCoins().toFixed(6);
  }


  get isLoggedIn() {
    return this.authService.isLoggedIn;
  }

  get isSynced() {
    return this.rpcService.isSynced;
  }

  ngOnInit(): void { }

  navigateTo(route: any) {
    if (route.id === 3 || route.id === 4) {
      if (!this.connectionService.isOBSocketConnected) {
        this.toastrService.warning('Please first connect to Server');
        const window = this.windowsService.tabs.find(tab => tab.title === 'Servers');
        if (window) window.minimized = false;
        return;
      }
    }
    this.selectedRoute = route;
    this.router.navigateByUrl(route.link);
  }

  navigateToLoginRoute() {
    this.router.navigateByUrl('login', { replaceUrl: true });
    this.selectedRoute = null;
  }

  logOut() {
    this.authService.logout();
  }

  toggleSideBar() {
    // this.menuService.toggleSideBar();
  }
  
  async updateBalance() {
    if (this.balanceLoading) return;
    this.balanceLoading = true;
    await this.balanceService.updateBalances();
    this.balanceLoading = false;
  }

  async connectWallet() {
      try {
        if (window.myWallet) {
          const accounts = await window.myWallet.sendRequest('requestAccounts', {});
          if (accounts && accounts.length > 0) {
            this.walletAddress = accounts[0]?.address || accounts[0];
            this.balanceVisible = true;
            console.log('Connected Wallet Address:', this.walletAddress);
            this.toastrService.success('Wallet connected successfully!');
          }

          // Only add listeners if the `on` method exists
          if (typeof window.myWallet.on === 'function') {
            // Listen for account changes
            window.myWallet.on('accountsChanged', (newAccounts: string[]) => {
              console.log('Accounts changed:', newAccounts);
              this.walletAddress = newAccounts[0] || null;
              this.toastrService.info('Account switched.');
            });

            // Listen for network changes (optional)
            window.myWallet.on('networkChanged', (network: string) => {
              console.log('Network changed:', network);
              this.toastrService.info(`Network changed to ${network}.`);
            });
          } else {
            console.warn('Wallet does not support event listeners.');
          }
        } else {
          this.toastrService.error('Wallet extension not detected. Redirecting...');
          window.open('https://chrome.google.com/webstore/detail/your-wallet-extension-id', '_blank');
        }
      } catch (error: any) {
        console.error('Wallet connection error:', error);
        this.toastrService.error('Failed to connect wallet.');
      }
    }

}
