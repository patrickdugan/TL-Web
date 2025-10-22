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