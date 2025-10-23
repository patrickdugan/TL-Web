// src/app/@core/utils/ob-normalize.ts

export type OBRowSide = "BUY" | "SELL";

export interface OBFlatRow {
  price: number;
  quantity: number;
  side: OBRowSide;
  [k: string]: any;
}

/**
 * Normalize any inbound OB payload into a shape your UI can rely on:
 * - Keeps {bids, asks} intact (non-destructive)
 * - Guarantees a flat `orders` array for array-based pipelines
 * - Accepts string (incl. log-noise) or object
 * - Accepts { snapshot:{...} } and { orders:{...} } sources
 * - Adds marketKey from symbol (futures-friendly), no exported helper collisions
 */
export function wrangleObMessageInPlace(input: any): any {
  let msg: any = input;

  // 1) Parse strings (including log lines like: '3|Hyper | market snapshot "{...}"')
  if (typeof msg === "string") {
    const json = _extractFirstJson(msg);
    const parsed = json ? _safeParse(json) : _safeParse(msg);
    if (parsed) msg = parsed;
  }

  // 2) If `snapshot` is a string, parse it
  if (typeof msg?.snapshot === "string") {
    const parsedSnapshot = _safeParse(msg.snapshot);
    if (parsedSnapshot) msg.snapshot = parsedSnapshot;
  }

  // 3) If frame looks like { orders: { bids, asks, ... } } and no snapshot, alias it
  if (!msg?.snapshot && _looksLikeSnapshot(msg?.orders)) {
    msg.snapshot = msg.orders;
  }

  // 4) Choose a root to read bids/asks/symbol from
  const root = msg?.snapshot ?? msg ?? {};
  const symbol =
    root?.symbol ?? msg?.symbol ?? msg?.marketKey ?? root?.marketKey ?? undefined;

  // 5) Pull bids/asks without mutating the originals
  const bidsRaw = Array.isArray(root?.bids) ? root.bids : Array.isArray(msg?.bids) ? msg.bids : [];
  const asksRaw = Array.isArray(root?.asks) ? root.asks : Array.isArray(msg?.asks) ? msg.asks : [];

  // 6) Build flat `orders` array
  const flatOrders: OBFlatRow[] = [
    ..._mapSide("BUY", bidsRaw),
    ..._mapSide("SELL", asksRaw),
  ];

  // 7) Assemble non-destructive output
  const out: any = { ...msg };

  // Mirror bids/asks top-level if only present under snapshot
  if (!Array.isArray(out.bids) && Array.isArray(bidsRaw)) out.bids = bidsRaw;
  if (!Array.isArray(out.asks) && Array.isArray(asksRaw)) out.asks = asksRaw;

  // Always expose a flat orders array for the UI
  out.orders = flatOrders;

  // Normalize a marketKey (futures-friendly) if missing
  if (!out.marketKey && symbol) {
    out.marketKey = _mk(String(symbol));
  }

  console.log('emitting normalized book '+JSON.stringify(out))

  return out;
}

/* -------------------- file-local helpers (no exports) -------------------- */

function _mapSide(side: OBRowSide, arr: any[]): OBFlatRow[] {
  return (arr ?? []).map((row: any) => {
    // Common shapes:
    // - row.orders[0].Standard   (Hyper nested)
    // - row.Standard             (single)
    // - row                      (flat)
    const std = row?.orders?.[0]?.Standard ?? row?.Standard ?? row;

    const price = _toNum(
      std?.price ?? row?.price ?? (Array.isArray(row) ? row[0] : undefined)
    );

    const quantity = _toNum(
      std?.quantity ??
        row?.quantity ??
        row?.visible_quantity ??
        row?.amount ??
        (Array.isArray(row) ? row[1] : undefined)
    );

    // Merge Standard fields but guarantee price/quantity/side numerics
    const base =
      std && typeof std === "object" ? { ...std } :
      typeof row === "object" ? { ...row } : {};

    (base as any).price = price;
    (base as any).quantity = quantity;
    (base as any).side = side;

    return base as OBFlatRow;
  });
}

function _looksLikeSnapshot(x: any): boolean {
  return !!(x && (Array.isArray(x?.bids) || Array.isArray(x?.asks)));
}

function _safeParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

/** Extract the first balanced {...} block from a noisy string (returns '' if none) */
function _extractFirstJson(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t.startsWith("{") && t.endsWith("}")) return t;

  const start = t.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return "";
}

function _toNum(v: any): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Number(n) : NaN;
}

/** Futures-friendly normalizer: keep '3-perp' as is; add '-perp' for bare symbols */
function _mk(sym: string): string {
  const s = (sym || "").trim();
  if (!s) return s;
  if (s.toLowerCase().endsWith("-perp")) return s;
  if (/^\d+$/u.test(s) || !s.includes("-")) return `${s}-perp`;
  return s;
}

/* ------------------------ file-local helpers (no exports) ------------------------ */

/** Normalize market keys for futures without colliding with app-wide helpers */
function _normalizePerpKey(sym: string): string {
  const s = String(sym ?? "").trim();
  if (!s) return s;

  // If already looks like "foo-perp" (any case), keep as-is
  if (s.toLowerCase().endsWith("-perp")) return s;

  // Common futures symbol forms:
  //  - pure digits like "3"  -> "3-perp"
  //  - code without dash     -> "<code>-perp"
  if (/^\d+$/u.test(s) || !s.includes("-")) return `${s}-perp`;

  // Otherwise, leave it alone (e.g., "BTC-USD-PERP" if you ever emit that)
  return s;
}

// ======================= FUTURES WRANGLER (WEB) =======================

export type FutSide = "BUY" | "SELL";
export interface FutFlatRow {
  price: number;
  quantity: number;
  side: FutSide;
  [k: string]: any;
}

/**
 * Futures version of the orderbook wrangler (non-destructive).
 * - Accepts string/object. Handles {orders:{...}} or {snapshot:{...}}.
 * - Preserves bids/asks as-is.
 * - Adds flat `orders` array with side inferred (BUY from bids, SELL from asks).
 * - Keeps raw `marketKey` (symbol) intact for routing.
 * - Adds `marketLabel` (suffixes stripped) for UI display.
 */
export function wrangleFuturesObMessageInPlace(input: any): any {
  let msg: any = input;

  // Parse strings (including noisy log lines)
  if (typeof msg === "string") {
    const json = _ob_extractFirstJson(msg);
    const parsed = json ? _ob_safeParse(json) : _ob_safeParse(msg);
    if (parsed) msg = parsed;
  }

  // Parse stringified snapshot if present
  if (typeof msg?.snapshot === "string") {
    const parsedSnapshot = _ob_safeParse(msg.snapshot);
    if (parsedSnapshot) msg.snapshot = parsedSnapshot;
  }

  // Alias {orders:{...}} → snapshot if snapshot missing
  if (!msg?.snapshot && _ob_looksLikeSnapshot(msg?.orders)) {
    msg.snapshot = msg.orders;
  }

  const root = msg?.snapshot ?? msg ?? {};
  const rawSymbol = root?.symbol ?? msg?.symbol ?? msg?.marketKey ?? undefined;

  const bidsRaw = Array.isArray(root?.bids) ? root.bids
                : Array.isArray(msg?.bids) ? msg.bids : [];
  const asksRaw = Array.isArray(root?.asks) ? root.asks
                : Array.isArray(msg?.asks) ? msg.asks : [];

  const flat: FutFlatRow[] = [
    ..._ob_mapSide("BUY", bidsRaw),
    ..._ob_mapSide("SELL", asksRaw),
  ];

  const out: any = { ...msg };
  if (!Array.isArray(out.bids) && Array.isArray(bidsRaw)) out.bids = bidsRaw;
  if (!Array.isArray(out.asks) && Array.isArray(asksRaw)) out.asks = asksRaw;
  out.orders = flat;

  // Futures-specific keys
  out.marketKey = out.marketKey ?? rawSymbol ?? null;         // keep raw for routing
  out.marketLabel = _ob_futDisplayKey(rawSymbol ?? "");       // strip suffixes for UI
  // Helpful alias for code that wants the object snapshot explicitly
  out.ordersObj = out.snapshot ?? out.orders ?? { symbol: rawSymbol, bids: bidsRaw, asks: asksRaw };

  return out;
}

/** Also expose a tiny helper for components that only need the display label. */
export function futDisplayKey(sym?: string): string {
  return _ob_futDisplayKey(sym ?? "");
}

/* ---------------- file-local helpers (no collisions) ---------------- */

function _ob_mapSide(side: FutSide, arr: any[]): FutFlatRow[] {
  return (arr ?? []).map((row: any) => {
    const std = row?.orders?.[0]?.Standard ?? row?.Standard ?? row;
    const price = _ob_toNum(std?.price ?? row?.price ?? (Array.isArray(row) ? row[0] : undefined));
    const quantity = _ob_toNum(
      std?.quantity ?? row?.quantity ?? row?.visible_quantity ?? row?.amount ??
      (Array.isArray(row) ? row[1] : undefined)
    );
    const base = std && typeof std === "object" ? { ...std } :
                 typeof row === "object" ? { ...row } : {};
    (base as any).price = price;
    (base as any).quantity = quantity;
    (base as any).side = side;
    return base as FutFlatRow;
  });
}

function _ob_looksLikeSnapshot(x: any): boolean {
  return !!(x && (Array.isArray(x?.bids) || Array.isArray(x?.asks)));
}

function _ob_safeParse(s: string): any | null {
  try { return JSON.parse(s); } catch { return null; }
}

/** Extract first balanced {...} from a noisy string */
function _ob_extractFirstJson(s: string): string {
  const t = String(s ?? "").trim();
  if (!t) return "";
  if (t.startsWith("{") && t.endsWith("}")) return t;
  const start = t.indexOf("{");
  if (start < 0) return "";
  let depth = 0;
  for (let i = start; i < t.length; i++) {
    const ch = t[i];
    if (ch === "{") depth++;
    else if (ch === "}") {
      depth--;
      if (depth === 0) return t.slice(start, i + 1);
    }
  }
  return "";
}

function _ob_toNum(v: any): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Number(n) : NaN;
}

/** FUTURES display normalizer: strip terminal -perp / -futures / -P / -C / -4500P forms */
function _ob_futDisplayKey(sym: string): string {
  let s = String(sym || "").trim();
  if (!s) return "-";

  // Common terminal futures tags at the end only
  s = s.replace(/-perp\b/i, "");
  s = s.replace(/-fut(?:ure|ures)?\b/i, "");

  // Simple option trailers at the end: -P / -C
  s = s.replace(/-(?:p|c)\b/i, "");

  // Strike+P/C at end: -4500P, -4500C
  s = s.replace(/-\d+(?:\.\d+)?(?:p|c)\b/i, "");

  // Formats like SYMBOL-P-30JUN25 (strip "-P-" / "-C-<expiry>")
  s = s.replace(/-(?:p|c)-[A-Za-z0-9]+$/i, "");

  s = s.trim().replace(/-{2,}/g, "-"); // collapse double dashes if any
  return s || "-";
}
