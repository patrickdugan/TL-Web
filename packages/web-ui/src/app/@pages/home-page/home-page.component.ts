import { Component, OnDestroy, OnInit } from '@angular/core';
import { Subscription } from 'rxjs';
import { ConnectionService } from 'src/app/@core/services/connections.service';
import { ToastrService } from 'ngx-toastr';
import { AlgoTradingService, StrategyRow } from 'src/app/@core/services/algo-trading.service';

interface LaunchAlgoButton {
  icon: string;
  title: string;
  subtitle: string;
  strategyName: string;
  strategyId?: string;
  amount: number;
}

@Component({
  selector: 'tl-home-page',
  templateUrl: './home-page.component.html',
  styleUrls: ['./home-page.component.scss']
})
export class HomePageComponent implements OnInit, OnDestroy {

  constructor(
    private connectionService: ConnectionService,
    private toastrService: ToastrService,
    private algoTradingService: AlgoTradingService
  ) {}

  public walletAddress: string | null = null;
  public balanceVisible: boolean = false;
  public readonly launchButtons: LaunchAlgoButton[] = [
    { icon: 'SA', title: 'Swing Atlas', subtitle: '2-3 trades per week', strategyName: 'Swing Atlas', amount: 0.025 },
    { icon: 'PS', title: 'Pulse Scalp', subtitle: '2-3 trades per day', strategyName: 'Pulse Scalp', amount: 0.025 },
    { icon: 'RI', title: 'Ribbon Intraday', subtitle: '10-20 trades per day', strategyName: 'Ribbon Intraday', amount: 0.025 },
    { icon: 'OS', title: 'Orderflow Sprint', subtitle: 'High frequency mode', strategyName: 'Orderflow Sprint', amount: 0.025 },
  ];
  public icoTargetUsd = 2500000;
  public icoBaseRaisedUsd = 1842500;
  public algoProfitUsd = 0;
  public icoContributionUsd = 0;
  public runningAlgoCount = 0;
  public allocateProfitToIco = false;

  private readonly icoSettingKey = 'tl.allocateProfitToIco';
  private readonly subs: Subscription[] = [];

  get icoRaisedUsd(): number {
    return this.icoBaseRaisedUsd + this.icoContributionUsd;
  }

  get icoProgressPercent(): number {
    if (!this.icoTargetUsd) return 0;
    return Math.min(100, (this.icoRaisedUsd / this.icoTargetUsd) * 100);
  }

  async ngOnInit(): Promise<void> {
    this.allocateProfitToIco = localStorage.getItem(this.icoSettingKey) === 'true';
    await this.algoTradingService.init();
    this.algoTradingService.fetchDiscovery();
    this.algoTradingService.fetchRunning();
    this.subs.push(
      this.algoTradingService.discovery$.subscribe((discovery) => this.bindStrategiesToButtons(discovery)),
      this.algoTradingService.running$.subscribe((running) => {
        this.runningAlgoCount = running.length;
        const positiveProfit = running
          .map((row) => Number(row.pnlUsd) || 0)
          .filter((pnl) => pnl > 0)
          .reduce((acc, pnl) => acc + pnl, 0);
        this.algoProfitUsd = positiveProfit;
        this.recomputeIcoContribution();
      })
    );
  }

  ngOnDestroy(): void {
    for (const sub of this.subs) {
      sub.unsubscribe();
    }
  }

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

  onToggleIcoAllocation(enabled: boolean): void {
    this.allocateProfitToIco = enabled;
    localStorage.setItem(this.icoSettingKey, String(enabled));
    this.recomputeIcoContribution();
  }

  private recomputeIcoContribution(): void {
    this.icoContributionUsd = this.allocateProfitToIco ? this.algoProfitUsd * 0.1 : 0;
  }

  launchAlgo(button: LaunchAlgoButton): void {
    if (!button.strategyId) {
      this.toastrService.warning('Algo profile not loaded yet. Open the Algo page once to initialize if needed.');
      return;
    }
    this.algoTradingService.runSystem(button.strategyId, { amount: button.amount });
    this.toastrService.success(`${button.title} started`);
  }

  private bindStrategiesToButtons(discovery: StrategyRow[]): void {
    for (const button of this.launchButtons) {
      const match = discovery.find((row) => row.name === button.strategyName);
      button.strategyId = match?.id;
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

