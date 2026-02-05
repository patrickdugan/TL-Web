import { Component, OnInit } from '@angular/core';
import { Router } from '@angular/router';
import { ToastrService } from 'ngx-toastr';
import { AuthService } from 'src/app/@core/services/auth.service';
import { BalanceService } from 'src/app/@core/services/balance.service';
import { ConnectionService } from 'src/app/@core/services/connections.service';
import { RpcService } from 'src/app/@core/services/rpc.service';
import { WindowsService } from 'src/app/@core/services/windows.service';
import { DialogService, DialogTypes } from 'src/app/@core/services/dialogs.service';

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
       id: 4,
       name: 'Futures Trading',
       link: '',
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
    private router: Router,
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

  ngOnInit(): void { }

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
    console.log("Checking for wallet...");
//
    // --- Phantom Bitcoin provider (preferred) ---
    const ph: any = (window as any)?.phantom?.bitcoin;
    if (!this.isLitecoinNetwork && ph?.isPhantom) {
      console.log("Phantom Bitcoin detected.");

      // Must be called from a user gesture (your button click) to show the approval modal.
      const accounts = await ph.requestAccounts(); // triggers Phantom approval UI
      if (accounts && accounts.length > 0) {
        // accounts: BtcAccount[] per docs: { address, addressType, publicKey, purpose }
        this.walletAddress = accounts[0].address;
        this.balanceVisible = true;
        console.log("Connected Phantom BTC Address:", this.walletAddress);
        this.toastrService.success("Phantom connected successfully!");
      }

      // Listen for account switches (Phantom BTC supports 'accountsChanged')
      if (!this.isLitecoinNetwork && typeof ph.on === "function") {
        ph.on("accountsChanged", (newAccounts: any[]) => {
          console.log("Phantom accounts changed:", newAccounts);
          if (Array.isArray(newAccounts) && newAccounts.length > 0) {
            this.walletAddress = newAccounts[0].address;
            this.toastrService.info("Phantom account switched.");
          } else {
            // If empty array, try to reconnect (per docs suggestion)
            ph.requestAccounts().catch((e: any) => console.warn("Re-connect failed:", e));
          }
        });
      }

      return; // Done with Phantom path
    }

    // --- Fallback: your existing custom wallet path ---
    if (typeof (window as any).myWallet !== "undefined") {
      console.log("Fallback wallet detected.");

      if (this.isLitecoinNetwork && this.walletAddress && this.walletAddress.startsWith('bc1')) {
        this.walletAddress = null;
      }

      const accounts = await (window as any).myWallet.sendRequest("requestAccounts", {});
      if (accounts && accounts.length > 0) {
        this.walletAddress = accounts[0]?.address || accounts[0];
        this.balanceVisible = true;
        console.log("Connected Wallet Address:", this.walletAddress);
        this.toastrService.success("Wallet connected successfully!");
      }

      if (typeof (window as any).myWallet.on === "function") {
        (window as any).myWallet.on("accountsChanged", (newAccounts: string[]) => {
          console.log("Accounts changed:", newAccounts);
          this.walletAddress = newAccounts[0] || null;
          this.toastrService.info("Account switched.");
        });
        // Only keep this if your custom wallet actually emits it. Phantom BTC does not document 'networkChanged'.
        (window as any).myWallet.on("networkChanged", (network: string) => {
          console.log("Network changed:", network);
          this.toastrService.info(`Network changed to ${network}.`);
        });
      } else {
        console.warn("Wallet does not support event listeners.");
      }
    } else {
      console.warn("No wallet extension detected.");
      this.toastrService.error("Wallet extension not detected.");
    }
  } catch (error: any) {
    console.error("Wallet connection error:", error);
    this.toastrService.error("Failed to connect wallet.");
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
