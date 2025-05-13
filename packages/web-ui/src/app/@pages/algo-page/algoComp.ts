// strategy-runner.component.ts

import { Component } from '@angular/core';

@Component({
  selector: 'app-strategy-runner',
  templateUrl: './strategy-runner.component.html',
  styleUrls: ['./strategy-runner.component.css']
})
export class StrategyRunnerComponent {
  strategies = ['bollingerMomentum', 'meanRevertRSI', 'breakoutLadder'];
  selectedStrategy = this.strategies[0];
  params = {
    quote_amount: 100,
    bb_sigma: 2.0
  };
  botStatus = '';
  lastSignal = '';
  histoValues = [20, 40, 60, 80, 50];
  liveDiagnostics = true;

  constructor() {
    setInterval(() => this.animateDiagnostics(), 1000);
  }

  async startBot() {
    const res = await fetch('/api/bots/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        strategy: this.selectedStrategy,
        config: this.params
      })
    });
    const data = await res.json();
    this.botStatus = data.status;
    this.pullDiagnostics();
  }

  async pullDiagnostics() {
    if (!this.liveDiagnostics) {
      this.histoValues = Array.from({ length: 5 }, () => Math.floor(Math.random() * 100));
      return;
    }

    const res = await fetch('/api/bots/status');
    const data = await res.json();
    if (data.metrics) {
      const volatility = Math.min(Math.max(data.metrics.volatility * 100, 5), 100);
      const pnl = Math.min(Math.max(data.metrics.pnl * 10, 0), 100);
      const tradeRate = Math.min(Math.max(data.metrics.tradesPerMinute, 5), 100);
      this.histoValues = [volatility, pnl, tradeRate, 50 + Math.random() * 30, 40 + Math.random() * 20];
    }
  }

  animateDiagnostics() {
    this.pullDiagnostics();
  }
}
