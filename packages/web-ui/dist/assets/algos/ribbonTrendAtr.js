// ribbonTrendAtr.js
// Standalone strategy module

function ema(values, period) {
  if (period <= 0 || values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function sma(values, period) {
  if (period <= 0 || values.length < period) return null;
  let s = 0;
  for (let i = values.length - period; i < values.length; i++) s += values[i];
  return s / period;
}

function atrFromHLC(highs, lows, closes, period) {
  const n = closes.length;
  if (period <= 0 || n < period + 1 || highs.length !== n || lows.length !== n) return null;
  const trs = [];
  let prevClose = closes[0];
  for (let i = 1; i < n; i++) {
    const tr = Math.max(
      highs[i] - lows[i],
      Math.abs(highs[i] - prevClose),
      Math.abs(lows[i] - prevClose)
    );
    trs.push(tr);
    prevClose = closes[i];
  }
  if (trs.length < period) return null;

  let a = trs.slice(0, period).reduce((x, y) => x + y, 0) / period;
  for (let i = period; i < trs.length; i++) a = (a * (period - 1) + trs[i]) / period;
  return a;
}

function ribbonSnapshot(closes, periods) {
  const mas = {};
  for (const p of periods) {
    const v = ema(closes, p);
    if (v == null) return null;
    mas[p] = v;
  }
  const ps = [...periods].sort((a, b) => a - b);
  const vals = ps.map(p => mas[p]);

  const bullish = vals.every((v, i) => i === 0 || vals[i - 1] > v);
  const bearish = vals.every((v, i) => i === 0 || vals[i - 1] < v);

  const maxv = Math.max(...vals);
  const minv = Math.min(...vals);
  const mid = vals.reduce((a, b) => a + b, 0) / vals.length;

  return { bullish, bearish, mas, maxv, minv, mid };
}

function pctDist(a, b) {
  return a > 0 ? Math.abs(a - b) / a : 1;
}

/**
 * candlesByTf: { "5m": {high:[], low:[], close:[]}, "15m": {...}, ... }
 */
function computeSignal({
  candlesByTf,
  price,
  baseTf = "5m",
  ribbonTfs = ["5m", "15m", "1h"],
  ribbonPeriods = [8, 13, 21, 34, 55],
  puckerMaxPct = 0.002,     // 0.2% spread
  requireAllTfs = true,
  supportLevels = [{ tf: "1h", period: 200 }],
  supportTouchPct = 0.002, // 0.2%
}) {
  const snaps = {};
  let bullishAll = true;
  let bearishAll = true;

  for (const tf of ribbonTfs) {
    const c = candlesByTf[tf]?.close || [];
    const snap = ribbonSnapshot(c, ribbonPeriods);
    if (!snap) return { side: "FLAT", strength: 0, reason: `Ribbon not ready on ${tf}`, meta: { ready: false } };
    snaps[tf] = snap;
    bullishAll = bullishAll && snap.bullish;
    bearishAll = bearishAll && snap.bearish;
  }

  const base = snaps[baseTf];
  if (!base) return { side: "FLAT", strength: 0, reason: `Missing baseTf=${baseTf}`, meta: { ready: false, snaps } };

  // pucker = aligned + tight spread
  const spreadPct = base.maxv > 0 ? (base.maxv - base.minv) / base.maxv : 1;
  const puckered = (spreadPct <= puckerMaxPct) && (base.bullish || base.bearish);

  if (!puckered) {
    return { side: "FLAT", strength: 0, reason: "Ribbon not puckered", meta: { ready: true, snaps, spreadPct } };
  }

  let side = "FLAT";
  if (requireAllTfs) {
    if (bullishAll) side = "LONG";
    else if (bearishAll) side = "SHORT";
  } else {
    side = base.bullish ? "LONG" : base.bearish ? "SHORT" : "FLAT";
  }
  if (side === "FLAT") {
    return { side: "FLAT", strength: 0, reason: "Ribbon not aligned", meta: { ready: true, snaps, spreadPct } };
  }

  // support touch -> reload_ok
  const hits = [];
  let reloadOk = false;
  for (const lvl of supportLevels || []) {
    const c = candlesByTf[lvl.tf]?.close || [];
    const v = sma(c, lvl.period);
    if (v == null) continue;
    const d = pctDist(price, v);
    const alignOk = side === "LONG" ? price >= v : price <= v;
    const touch = d <= supportTouchPct && alignOk;
    hits.push({ tf: lvl.tf, period: lvl.period, sma: v, distPct: d, alignOk, touch });
    if (touch) reloadOk = true;
  }

  // strength: simple scoring (tightness + alignment)
  const tightScore = Math.max(0, Math.min(50, (puckerMaxPct / Math.max(spreadPct, 1e-9)) * 5));
  const alignScore = 50;
  const strength = Math.max(1, Math.min(100, Math.round(tightScore + alignScore)));

  return {
    side,
    strength,
    reason: reloadOk ? "Ribbon trend + support touch" : "Ribbon trend confirmed",
    meta: { snaps, spreadPct, puckered, reloadOk, support: hits }
  };
}

function computeExit({
  candlesByTf,
  price,
  position, // { side, entryPrice, highWater, lowWater }
  baseTf = "5m",
  ribbonPeriods = [8, 13, 21, 34, 55],
  atrTf = "5m",
  atrPeriod = 14,
  atrStopMult = 1.0,
  trailPct = 0.0015, // 0.15% trailing (15 bps)
}) {
  const baseC = candlesByTf[baseTf]?.close || [];
  const baseSnap = ribbonSnapshot(baseC, ribbonPeriods);

  if (baseSnap) {
    if (position.side === "LONG") {
      if (!baseSnap.bullish) return { exit: true, reason: "Ribbon lost bullish alignment", type: "signal" };
      if (price < baseSnap.mid) return { exit: true, reason: "Price broke under ribbon midline", type: "signal" };
    } else if (position.side === "SHORT") {
      if (!baseSnap.bearish) return { exit: true, reason: "Ribbon lost bearish alignment", type: "signal" };
      if (price > baseSnap.mid) return { exit: true, reason: "Price broke over ribbon midline", type: "signal" };
    }
  }

  // ATR stop
  const h = candlesByTf[atrTf]?.high || [];
  const l = candlesByTf[atrTf]?.low || [];
  const c = candlesByTf[atrTf]?.close || [];
  const atr = atrFromHLC(h, l, c, atrPeriod);
  if (atr != null && position.entryPrice > 0) {
    const dist = atr * atrStopMult;
    if (position.side === "LONG" && price <= position.entryPrice - dist) {
      return { exit: true, reason: "ATR hard stop hit", type: "risk" };
    }
    if (position.side === "SHORT" && price >= position.entryPrice + dist) {
      return { exit: true, reason: "ATR hard stop hit", type: "risk" };
    }
  }

  // Trailing stop (5m logic)
  if (position.side === "LONG") {
    position.highWater = Math.max(position.highWater ?? price, price);
    const stop = position.highWater * (1 - trailPct);
    if (price <= stop) return { exit: true, reason: "Trailing stop hit", type: "trail" };
  } else if (position.side === "SHORT") {
    position.lowWater = Math.min(position.lowWater ?? price, price);
    const stop = position.lowWater * (1 + trailPct);
    if (price >= stop) return { exit: true, reason: "Trailing stop hit", type: "trail" };
  }

  return { exit: false, reason: "Hold" };
}

module.exports = { computeSignal, computeExit };
