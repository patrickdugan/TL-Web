// lighter_flow.js
// npm i ws
const WebSocket = require("ws");

// ---- helpers: side from Lighter trade ----
function lighterTakerSide(tr) {
  // If REST-style trade has tr.type = "buy"/"sell", use it.
  if (tr.type === "buy" || tr.type === "sell") return tr.type;

  // Stream example shows type:"trade" but includes is_maker_ask boolean.
  // If maker is ask (sell limit), taker is buying into it => buy.
  if (typeof tr.is_maker_ask === "boolean") return tr.is_maker_ask ? "buy" : "sell";

  // fallback
  return "buy";
}

// ---- CVD ----
class CVD {
  constructor() { this.cvd = 0; this.buyVol = 0; this.sellVol = 0; }
  update(size, side) {
    if (!(size > 0)) return;
    if (side === "buy") { this.cvd += size; this.buyVol += size; }
    else if (side === "sell") { this.cvd -= size; this.sellVol += size; }
  }
  snap() { return { cvd: this.cvd, buyVol: this.buyVol, sellVol: this.sellVol }; }
}

// ---- OFI (L1) ----
class OFI {
  constructor() { this.prev = null; this.ofi = 0; }
  updateL1(bidPx, bidSz, askPx, askSz) {
    const cur = { bidPx, bidSz, askPx, askSz };
    if (!this.prev) { this.prev = cur; return { eventOfi: 0, ofi: this.ofi }; }

    let bid = 0;
    if (cur.bidPx > this.prev.bidPx) bid = cur.bidSz;
    else if (cur.bidPx === this.prev.bidPx) bid = cur.bidSz - this.prev.bidSz;
    else bid = -this.prev.bidSz;

    let ask = 0;
    if (cur.askPx < this.prev.askPx) ask = -cur.askSz;
    else if (cur.askPx === this.prev.askPx) ask = -(cur.askSz - this.prev.askSz);
    else ask = +this.prev.askSz;

    const eventOfi = bid + ask;
    this.ofi += eventOfi;
    this.prev = cur;
    return { eventOfi, ofi: this.ofi };
  }
}

// ---- Tick tracker (rolling) ----
class TickTracker {
  constructor(windowMs = 5000) {
    this.windowMs = windowMs;
    this.q = [];
    this.i = 0;
  }
  prune(now) {
    const cutoff = now - this.windowMs;
    while (this.i < this.q.length && this.q[this.i].t < cutoff) this.i++;
    if (this.i > 2048 && this.i > this.q.length / 2) {
      this.q = this.q.slice(this.i); this.i = 0;
    }
  }
  update(tMs, side, size) {
    this.q.push({ t: tMs, side, size });
    this.prune(tMs);
    let buyTrades = 0, sellTrades = 0, buyVol = 0, sellVol = 0;
    for (let k = this.i; k < this.q.length; k++) {
      const x = this.q[k];
      if (x.side === "buy") { buyTrades++; buyVol += x.size; }
      else { sellTrades++; sellVol += x.size; }
    }
    const secs = this.windowMs / 1000;
    const totalVol = buyVol + sellVol;
    const deltaVol = buyVol - sellVol;
    return {
      tradeRate: (buyTrades + sellTrades) / secs,
      imbalanceVol: totalVol ? deltaVol / totalVol : 0,
      buyVol, sellVol, deltaVol,
    };
  }
}

// ---- Minimal top-of-book tracker (so OFI can run) ----
// Lighter order_book updates are price-level deltas (strings). Maintain maps.
class TopOfBook {
  constructor() {
    this.bids = new Map(); // price -> size
    this.asks = new Map();
  }
  applyLevels(sideMap, levels) {
    for (const lvl of levels) {
      const px = Number(lvl.price);
      const sz = Number(lvl.size);
      if (!(px > 0)) continue;
      if (sz > 0) sideMap.set(px, sz);
      else sideMap.delete(px); // treat 0 as delete
    }
  }
  onOrderBookUpdate(ob) {
    if (Array.isArray(ob.bids)) this.applyLevels(this.bids, ob.bids);
    if (Array.isArray(ob.asks)) this.applyLevels(this.asks, ob.asks);
  }
  bestBid() {
    let bestPx = -Infinity, bestSz = 0;
    for (const [px, sz] of this.bids.entries()) if (px > bestPx) { bestPx = px; bestSz = sz; }
    return bestPx > -Infinity ? [bestPx, bestSz] : [null, null];
  }
  bestAsk() {
    let bestPx = Infinity, bestSz = 0;
    for (const [px, sz] of this.asks.entries()) if (px < bestPx) { bestPx = px; bestSz = sz; }
    return bestPx < Infinity ? [bestPx, bestSz] : [null, null];
  }
}

// ---- Wire it up ----
function run({ marketIndex = 0, url = "wss://mainnet.zklighter.elliot.ai/stream" } = {}) {
  const ws = new WebSocket(url);

  const cvd = new CVD();
  const ofi = new OFI();
  const tt = new TickTracker(5000);
  const tob = new TopOfBook();

  ws.on("open", () => {
    ws.send(JSON.stringify({ type: "subscribe", channel: `trade/${marketIndex}` }));
    ws.send(JSON.stringify({ type: "subscribe", channel: `order_book/${marketIndex}` }));
  });

  ws.on("message", (buf) => {
    let msg;
    try { msg = JSON.parse(buf.toString("utf8")); } catch { return; }

    // trades
    if (msg.type === "update/trade" && Array.isArray(msg.trades)) {
      for (const tr of msg.trades) {
        const side = lighterTakerSide(tr);
        const size = Number(tr.size);
        const tMs = (Number(tr.timestamp) || 0) * 1000; // docs show seconds
        cvd.update(size, side);
        const tick = tt.update(tMs || Date.now(), side, size);
        // sample: print confirmation signals
        // console.log({ side, size, ...cvd.snap(), ...tick });
      }
    }

    // order book (use for OFI via top-of-book)
    if (msg.type === "update/order_book" && msg.order_book) {
      tob.onOrderBookUpdate(msg.order_book);
      const [bidPx, bidSz] = tob.bestBid();
      const [askPx, askSz] = tob.bestAsk();
      if (bidPx != null && askPx != null) {
        const o = ofi.updateL1(bidPx, bidSz, askPx, askSz);
        // console.log({ bidPx, askPx, ...o });
      }
    }
  });

  ws.on("close", () => console.log("ws closed"));
  ws.on("error", (e) => console.error("ws error", e));
}

run({ marketIndex: 0 });
