import { Component, OnDestroy, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { NavigationEnd } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { Subscription } from 'rxjs';
import { AuthService } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { ConnectionService } from 'src/app/@core/services/connections.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';
import { MenuService } from 'src/app/@core/services/menu.service';
import { WalletService } from 'src/app/@core/services/wallet.service';

@Component({
  selector: 'tl-header',
  templateUrl: './header.component.html',
  styleUrls: ['./header.component.scss']
})

export class HeaderComponent implements OnInit, OnDestroy {
  private readonly subscriptions = new Subscription();
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
       id: 4,
       name: 'Futures Trading',
       link: '/futures',
       needAuthToShow: false,
    },
    {
      id: 3,
      name: 'Spot Trading',
      link: '/spot',
      needAuthToShow: false,
      needFullSynced: true,
    },
    {
      id: 2,
      name: 'Portfolio',
      link: '/portfolio',
      needAuthToShow: false,
      needFullSynced: false,
    },
    {
       id: 5,
       name: 'Algo Trading',
       link: '/algo',
       needAuthToShow: false,
       needFullSynced: false,
     },
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
    private dialogService: DialogService,
    private menuService: MenuService,
    private router: Router,
    private walletService: WalletService,
    private authService: AuthService,
    private balanceService: BalanceService,
    private connectionService: ConnectionService,
    private windowsService: WindowsService,
    private toastrService: ToastrService,
    public rpcService: RpcService,
  ) { }

  get selectedRoute(){
    return this._selectedRoute;
  }

  // header.component.ts
  get isBitcoinNetwork(): boolean {
    const icon = (this.networkIcon ?? '').toLowerCase();
    return icon.includes('btc') || icon.includes('bitcoin');
  }

  get isLitecoinNetwork(): boolean {
    const net = (this.rpcService?.NETWORK ?? '').toLowerCase();
    return net === 'ltc' || net === 'ltctest';
  }


  set selectedRoute(value: any){
    this._selectedRoute = value;
  }

  get mainRoutes(){
    return this._mainRoutes
      .filter(e => e.needAuthToShow ? this.isLoggedIn : true)
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

  ngOnInit(): void {
    this.syncSelectedRoute(this.router.url || '/');
    this.subscriptions.add(
      this.walletService.address$.subscribe((address) => {
        this.walletAddress = address;
        this.balanceVisible = !!address;
      })
    );

    this.subscriptions.add(
      this.router.events.subscribe((event) => {
        if (!(event instanceof NavigationEnd)) return;
        this.syncSelectedRoute(event.urlAfterRedirects || '/');
      })
    );
  }

  private syncSelectedRoute(url: string): void {
    const currentUrl = String(url || '/').split('?')[0].split('#')[0];
    const match = this.mainRoutes.find((route) => {
      const link = route.link || '';
      const routeUrl =
        link === '' || link === '/' ? '/' :
        link.startsWith('/') ? link : `/${link}`;
      return routeUrl === currentUrl;
    });
    this.selectedRoute = match || this.mainRoutes[0];
  }

  ngOnDestroy(): void {
    this.subscriptions.unsubscribe();
  }

  navigateTo(route: any) {
    this.selectedRoute = route;

    // normalize URL: '' => '/', 'spot' => '/spot', '/portfolio' stays
    const link = route.link || '';
    const url =
      link === '' ? '/' :
      link.startsWith('/') ? link : `/${link}`;

    this.router.navigateByUrl(url);
  }

  openNetworkDialog() {
    // open the existing select-network popup
    this.dialogService.openDialog(DialogTypes.SELECT_NETOWRK, { disableClose: false });
  }

  navigateToLoginRoute() {
    this.router.navigateByUrl('login', { replaceUrl: true });
    this.selectedRoute = null;
  }

  logOut() {
    this.authService.logout();
  }

  toggleSideBar() {
    this.menuService.toggleSideBar();
  }
  
  async updateBalance() {
    if (this.balanceLoading) return;
    this.balanceLoading = true;
    await this.balanceService.updateBalances();
    this.balanceLoading = false;
  }

async connectWallet() {
  try {
    console.log("Checking for wallet...");
//
    // --- Phantom Bitcoin provider (preferred) ---
    const ph: any = (window as any)?.phantom?.bitcoin;
    if (!this.isLitecoinNetwork && typeof ph?.requestAccounts === 'function') {
      console.log("Phantom Bitcoin detected.");

      // Must be called from a user gesture (your button click) to show the approval modal.
      const accounts = await ph.requestAccounts(); // triggers Phantom approval UI
      if (accounts && accounts.length > 0) {
        // accounts: BtcAccount[] per docs: { address, addressType, publicKey, purpose }
        const nextAddress = accounts[0].address;
        this.walletAddress = nextAddress;
        this.balanceVisible = true;
        this.walletService.addresses$.next([nextAddress]);
        this.walletService.address$.next(nextAddress);
        console.log("Connected Phantom BTC Address:", this.walletAddress);
      }

      // Listen for account switches (Phantom BTC supports 'accountsChanged')
      if (!this.isLitecoinNetwork && typeof ph.on === "function") {
        ph.on("accountsChanged", (newAccounts: any[]) => {
          console.log("Phantom accounts changed:", newAccounts);
          if (Array.isArray(newAccounts) && newAccounts.length > 0) {
            const nextAddress = newAccounts[0].address;
            this.walletAddress = nextAddress;
            this.walletService.addresses$.next([nextAddress]);
            this.walletService.address$.next(nextAddress);
          } else {
            // If empty array, try to reconnect (per docs suggestion)
            ph.requestAccounts().catch((e: any) => console.warn("Re-connect failed:", e));
          }
        });
      }

    return; // Done with Phantom path
    }

    // --- Fallback: your existing custom wallet path ---
    const customWallet: any = (window as any).myWallet || (window as any).tradelayer;
    if (customWallet && typeof customWallet.sendRequest === "function") {
      console.log("Fallback wallet detected.");

      if (this.isLitecoinNetwork && this.walletAddress && this.walletAddress.startsWith('bc1')) {
        this.walletAddress = null;
      }

      const network = this.rpcService.NETWORK;
      let accounts: any = null;

      if (typeof customWallet.connect === "function") {
        try {
          accounts = await customWallet.connect(network);
        } catch (connectError) {
          console.warn("[wallet] custom provider connect failed; falling back to requestAccounts", connectError);
        }
      }

      if (!Array.isArray(accounts) || accounts.length === 0) {
        accounts = await customWallet.sendRequest("requestAccounts", { network });
      }

      const firstAccount = Array.isArray(accounts) ? accounts[0] : null;
      const nextAddress = firstAccount?.address || firstAccount || null;
      if (nextAddress) {
        this.walletAddress = nextAddress;
        this.balanceVisible = true;
        this.walletService.addresses$.next([nextAddress]);
        this.walletService.address$.next(nextAddress);
        console.log("Connected Wallet Address:", this.walletAddress);
      }

    } else {
      console.warn("No wallet extension detected.");
    }
  } catch (error: any) {
    console.error("Wallet connection error:", error);
  }
}


  get networkIcon(): string {
    switch (this.rpcService.NETWORK) {
      case 'BTC':     return 'assets/icons/btc.svg';
      case 'LTC':     return 'assets/icons/ltc.svg';
      case 'LTCTEST': return 'assets/icons/ltc-test.svg';
      default:        return 'assets/icons/tl_logo_circle_only_small.png';
    }
  }

openWalletDownload() {
  window.open(
    "https://chromewebstore.google.com/detail/tradelayer-wallet-extensi/ilfdpenpmlmjljckbjcafgmbemogdkfn",
    "_blank"
  );
}

}
