/**
 * Ribbon Pucker Trend Strategy (JS)
 *
 * Standalone implementation you can "ape" into Moneyball quickly.
 * Assumes you have candles per timeframe (or you build them from trades).
 *
 * Entry:
 *  - Trend TF ribbon aligned + puckered (tight)
 *  - Signal TF ribbon aligned + puckered
 *  - Price "touches" a higher-TF SMA support/resistance within an ATR band
 *
 * Exit:
 *  - Price moves under/over the short-TF ribbon while it remains puckered
 *  - Trailing stop
 *  - Emergency ATR stop
 *
 * This is intentionally conservative: it avoids chasing and tries to trade a few times/day.
 */

// --------------------- helpers ---------------------

function sma(values, period) {
  if (!period || period <= 0 || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

// Wilder-style ATR (last value only)
function atr(highs, lows, closes, period) {
  if (!period || period <= 1) return null;
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;

  let sumTR = 0;
  for (let i = highs.length - period; i < highs.length; i++) {
    const h = highs[i], l = lows[i], prevC = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    sumTR += tr;
  }
  return sumTR / period;
}

function emaSeries(values, period) {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out = new Array(values.length);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) {
    out[i] = values[i] * k + out[i - 1] * (1 - k);
  }
  return out;
}

function ribbonSnapshot(closes, periods = [8, 13, 21, 34, 55]) {
  if (closes.length < Math.max(...periods) + 5) return null;

  const mas = {};
  for (const p of periods) {
    const e = emaSeries(closes, p);
    mas[p] = e[e.length - 1];
  }

  const vals = Object.values(mas);
  const allBull = vals.every((v, idx, arr) => idx === 0 || arr[idx - 1] >= v); // smaller period >= larger period
  const allBear = vals.every((v, idx, arr) => idx === 0 || arr[idx - 1] <= v);

  // score: simple count of ordered pairs
  let score = 0;
  for (let i = 1; i < vals.length; i++) {
    if (vals[i - 1] >= vals[i]) score++;
    if (vals[i - 1] <= vals[i]) score--;
  }

  return { mas, bullish: allBull, bearish: allBear, score };
}

function ribbonWidthPct(mas, price) {
  const vals = Object.values(mas).filter(v => v != null);
  if (!vals.length || price <= 0) return null;
  return (Math.max(...vals) - Math.min(...vals)) / price;
}

function anySupportTouch({ candlesByTf, price, band, supportTfs, supportSmaPeriods }) {
  const hits = [];
  for (const tf of supportTfs) {
    const c = candlesByTf[tf];
    if (!c) continue;
    for (const p of supportSmaPeriods) {
      const lvl = sma(c.close, p);
      if (lvl == null) continue;
      if (Math.abs(price - lvl) <= band) {
        hits.push({ tf, period: p, sma: lvl, band });
        return { touched: true, hits };
      }
    }
  }
  return { touched: false, hits };
}

// --------------------- strategy ---------------------

export class RibbonPuckerTrendStrategy {
  constructor(spec = {}) {
    this.trendTf = spec.trend_timeframe ?? "1h";
    this.signalTf = spec.signal_timeframe ?? "5m";
    this.supportTfs = spec.support_timeframes ?? ["1h", "4h"];
    this.supportSmaPeriods = spec.support_sma_periods ?? [50, 100, 200];

    this.minRibbonScore = spec.min_ribbon_score ?? 2;
    this.maxPuckerWidthPct = spec.max_pucker_width_pct ?? 0.0015;

    this.atrPeriod = spec.atr_period ?? 14;
    this.pullbackAtrMult = spec.pullback_atr_mult ?? 0.5;
    this.emergencyAtrMult = spec.emergency_atr_mult ?? 2.0;

    this.trailPctBps = spec.trail_pct_bps ?? 20.0;
    this.exitBufferPct = spec.exit_buffer_pct ?? 0.001;

    // runtime position tracking for trailing stop (simple)
    this._peak = null;
    this._trough = null;
  }

  computeSignal(candlesByTf, price, tsMs) {
    const trendC = candlesByTf[this.trendTf];
    const sigC = candlesByTf[this.signalTf];
    if (!trendC || !sigC) return { side: "FLAT", strength: 0, reason: "missing timeframe" };

    const trend = ribbonSnapshot(trendC.close);
    const sig = ribbonSnapshot(sigC.close);
    if (!trend || !sig) return { side: "FLAT", strength: 0, reason: "ribbon not ready" };

    const trendWidth = ribbonWidthPct(trend.mas, price);
    const sigWidth = ribbonWidthPct(sig.mas, price);

    const trendOk = (trend.bullish || trend.bearish) && trend.score >= this.minRibbonScore && trendWidth != null && trendWidth <= this.maxPuckerWidthPct;
    const sigOk = (sig.bullish || sig.bearish) && sig.score >= this.minRibbonScore && sigWidth != null && sigWidth <= this.maxPuckerWidthPct;

    if (!trendOk || !sigOk) {
      return { side: "FLAT", strength: 0, reason: "not puckered/aligned", meta: { trend, sig, trendWidth, sigWidth } };
    }

    const a = atr(sigC.high, sigC.low, sigC.close, this.atrPeriod);
    const band = a != null ? a * this.pullbackAtrMult : 0;
    const { touched, hits } = anySupportTouch({
      candlesByTf,
      price,
      band,
      supportTfs: this.supportTfs,
      supportSmaPeriods: this.supportSmaPeriods
    });

    const meta = { trend, sig, trendWidth, sigWidth, atr: a, supportHits: hits };

    if (trend.bullish && sig.bullish) {
      if (!touched) return { side: "FLAT", strength: 0, reason: "bullish but no support touch", meta };
      return { side: "LONG", strength: 70, reason: "bullish puckered + support touch", meta };
    }
    if (trend.bearish && sig.bearish) {
      if (!touched) return { side: "FLAT", strength: 0, reason: "bearish but no resistance touch", meta };
      return { side: "SHORT", strength: 70, reason: "bearish puckered + resistance touch", meta };
    }

    return { side: "FLAT", strength: 0, reason: "trend/signal disagreement", meta };
  }

  computeExit(candlesByTf, price, tsMs, position) {
    const sigC = candlesByTf[this.signalTf];
    const sig = sigC ? ribbonSnapshot(sigC.close) : null;

    // Emergency ATR stop
    if (sigC && position?.entryPrice != null) {
      const a = atr(sigC.high, sigC.low, sigC.close, this.atrPeriod);
      if (a != null) {
        const dist = a * this.emergencyAtrMult;
        if (position.side === "LONG" && price <= position.entryPrice - dist) return { exit: true, reason: "emergency ATR stop" };
        if (position.side === "SHORT" && price >= position.entryPrice + dist) return { exit: true, reason: "emergency ATR stop" };
      }
    }

    // Shed under/over ribbon while puckered
    if (sig && sig.mas) {
      const w = ribbonWidthPct(sig.mas, price);
      const puckered = w != null && w <= this.maxPuckerWidthPct;
      const vals = Object.values(sig.mas);
      const ribLow = Math.min(...vals);
      const ribHigh = Math.max(...vals);

      if (puckered && position?.side === "LONG") {
        if (sig.bullish && price < ribLow * (1 - this.exitBufferPct)) return { exit: true, reason: "fell under puckered ribbon" };
        if (sig.bearish) return { exit: true, reason: "ribbon flipped bearish" };
      }
      if (puckered && position?.side === "SHORT") {
        if (sig.bearish && price > ribHigh * (1 + this.exitBufferPct)) return { exit: true, reason: "rose above puckered ribbon" };
        if (sig.bullish) return { exit: true, reason: "ribbon flipped bullish" };
      }
    }

    // Simple trailing stop
    const trailPct = (this.trailPctBps / 10000);
    if (position?.side === "LONG") {
      this._peak = this._peak == null ? price : Math.max(this._peak, price);
      if (price <= this._peak * (1 - trailPct)) return { exit: true, reason: "trailing stop" };
    }
    if (position?.side === "SHORT") {
      this._trough = this._trough == null ? price : Math.min(this._trough, price);
      if (price >= this._trough * (1 + trailPct)) return { exit: true, reason: "trailing stop" };
    }

    return { exit: false, reason: "hold" };
  }

  onNewPosition(position) {
    this._peak = null;
    this._trough = null;
  }
}
