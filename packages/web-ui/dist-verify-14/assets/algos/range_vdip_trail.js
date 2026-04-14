/**
 * Range Scale + V-Dip + 3-Minute Trail (JS)
 *
 * This is the "good manual clicker" system:
 * - 25m range regime on 1m candles
 * - scale-in tiers by depth from midline
 * - reversal confirmation
 * - exit using tight 3m chandelier trail (ATR/bps floor) + emergency ATR stop
 *
 * Input shape (per timeframe):
 * candlesByTf[tf] = { open:[], high:[], low:[], close:[] }
 */

function atr(highs, lows, closes, period) {
  if (period <= 1) return null;
  if (highs.length < period + 1 || lows.length < period + 1 || closes.length < period + 1) return null;
  let sum = 0;
  for (let i = highs.length - period; i < highs.length; i++) {
    const h = highs[i], l = lows[i], prevC = closes[i - 1];
    const tr = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
    sum += tr;
  }
  return sum / period;
}

function rangeStats(highs, lows, lookback, price) {
  if (highs.length < lookback || lows.length < lookback || price <= 0) return null;
  const hs = highs.slice(-lookback);
  const ls = lows.slice(-lookback);
  const rHigh = Math.max(...hs);
  const rLow = Math.min(...ls);
  const width = rHigh - rLow;
  const widthPct = width / price;
  const mid = (rHigh + rLow) / 2;
  return { rLow, rHigh, mid, width, widthPct };
}

function sideDepth(price, rLow, rHigh) {
  const mid = (rHigh + rLow) / 2;
  const half = Math.max((rHigh - rLow) / 2, 1e-9);
  if (price < mid) return { longDepth: Math.min((mid - price) / half, 2.0), shortDepth: 0.0 };
  if (price > mid) return { longDepth: 0.0, shortDepth: Math.min((price - mid) / half, 2.0) };
  return { longDepth: 0.0, shortDepth: 0.0 };
}

function tierForDepth(depth, levels) {
  let tier = 0;
  for (let i = 0; i < levels.length; i++) if (depth >= levels[i]) tier = i + 1;
  return tier;
}

function reversalConfirmed(c, side) {
  if (!c || c.close.length < 3) return false;
  const o0 = c.open[c.open.length - 1];
  const c0 = c.close[c.close.length - 1];
  const c1 = c.close[c.close.length - 2];
  const h1 = c.high[c.high.length - 2];
  const l1 = c.low[c.low.length - 2];
  if (side === "LONG") return (c0 > o0 && c0 > c1) || (c0 > h1);
  if (side === "SHORT") return (c0 < o0 && c0 < c1) || (c0 < l1);
  return false;
}

/**
 * Returns: { side, strength, reason, meta }
 * meta.action = { kind:"SCALE_IN", side, tier }
 */
function computeSignal(opts) {
  const {
    candlesByTf,
    price,
    rangeTf = "1m",
    rangeLookback = 25,
    maxRangePct = 0.012,
    depthLevels = [0.35, 0.60, 0.85],
    requireReversal = true,
    atrPeriod = 14,
    trailLookback = 3,
    trailAtrMult = 1.0,
    trailBpsFloor = 12.0
  } = opts;

  const c = candlesByTf[rangeTf];
  if (!c) return { side: "FLAT", strength: 0, reason: `missing ${rangeTf}` };

  const rs = rangeStats(c.high, c.low, rangeLookback, price);
  if (!rs) return { side: "FLAT", strength: 0, reason: "insufficient data" };
  if (rs.widthPct > maxRangePct) return { side: "FLAT", strength: 0, reason: "not in range regime", meta: { range: rs } };

  const { longDepth, shortDepth } = sideDepth(price, rs.rLow, rs.rHigh);
  const levels = [...depthLevels].sort((a,b)=>a-b);
  const tierLong = tierForDepth(longDepth, levels);
  const tierShort = tierForDepth(shortDepth, levels);

  const a = atr(c.high, c.low, c.close, atrPeriod);

  const meta = {
    range: rs,
    depth: { long: longDepth, short: shortDepth },
    tiers: { long: tierLong, short: tierShort, levels },
    atr: a,
    trail: { lookback: trailLookback, atrMult: trailAtrMult, bpsFloor: trailBpsFloor }
  };

  if (tierLong === 0 && tierShort === 0) return { side: "FLAT", strength: 0, reason: "not deep enough", meta };

  if (tierLong > tierShort) {
    if (requireReversal && !reversalConfirmed(c, "LONG")) return { side: "FLAT", strength: 0, reason: "long depth but no reversal", meta };
    meta.action = { kind: "SCALE_IN", side: "LONG", tier: tierLong };
    return { side: "LONG", strength: Math.min(100, 40 + tierLong * 20), reason: `range dip tier ${tierLong}`, meta };
  }

  if (tierShort > tierLong) {
    if (requireReversal && !reversalConfirmed(c, "SHORT")) return { side: "FLAT", strength: 0, reason: "short depth but no reversal", meta };
    meta.action = { kind: "SCALE_IN", side: "SHORT", tier: tierShort };
    return { side: "SHORT", strength: Math.min(100, 40 + tierShort * 20), reason: `range pop tier ${tierShort}`, meta };
  }

  return { side: "FLAT", strength: 0, reason: "depth tie", meta };
}

/**
 * position = { side, entryPrice }
 * Returns: { exit, reason, type }
 */
function computeExit(opts) {
  const {
    candlesByTf,
    price,
    position,
    rangeTf = "1m",
    atrPeriod = 14,
    trailLookback = 3,
    trailAtrMult = 1.0,
    trailBpsFloor = 12.0,
    emergencyAtrMult = 2.0
  } = opts;

  const c = candlesByTf[rangeTf];
  if (!c) return { exit: false, reason: "missing candles" };

  const a = atr(c.high, c.low, c.close, atrPeriod);

  if (a != null && position?.entryPrice != null) {
    const dist = a * emergencyAtrMult;
    if (position.side === "LONG" && price <= position.entryPrice - dist) return { exit: true, reason: "emergency ATR stop", type: "risk" };
    if (position.side === "SHORT" && price >= position.entryPrice + dist) return { exit: true, reason: "emergency ATR stop", type: "risk" };
  }

  const bpsDist = price * (trailBpsFloor / 10000);
  const atrDist = a != null ? a * trailAtrMult : 0;
  const dist = Math.max(bpsDist, atrDist);

  if (position?.side === "LONG" && c.high.length >= trailLookback) {
    const hh = Math.max(...c.high.slice(-trailLookback));
    const stop = hh - dist;
    if (price <= stop) return { exit: true, reason: `3m trail stop (${stop})`, type: "trail" };
  }

  if (position?.side === "SHORT" && c.low.length >= trailLookback) {
    const ll = Math.min(...c.low.slice(-trailLookback));
    const stop = ll + dist;
    if (price >= stop) return { exit: true, reason: `3m trail stop (${stop})`, type: "trail" };
  }

  return { exit: false, reason: "hold" };
}

module.exports = { computeSignal, computeExit };
