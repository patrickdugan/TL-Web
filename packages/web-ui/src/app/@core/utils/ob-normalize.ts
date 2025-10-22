// src/app/@core/utils/ob-normalize.ts

export type OrderSide = "BUY" | "SELL";

export interface NormalizedOrder {
  price: number;
  quantity: number;
  side: OrderSide;
  [k: string]: any;
}

/**
 * Wrangles inbound OB messages:
 * - Accepts string or object (handles log lines with embedded JSON)
 * - If payload has { snapshot: string }, parses it
 * - Preserves bids/asks (non-destructive)
 * - Adds flat `orders` array (always an array)
 * - Adds `marketKey` from symbol; supports common futures forms ("3" → "3-perp")
 *
 * NOTE: No exported helpers to avoid name collisions with your existing futures utils.
 */
export function wrangleObMessageInPlace(input: any): any {
  let msg: any = input;

  // 1) Parse string / log line containing JSON
  if (typeof msg === "string") {
    const i = msg.indexOf("{");
    const slice = i >= 0 ? msg.slice(i) : msg;
    const parsed = _safeParse(slice);
    if (parsed) msg = parsed;
  }

  // 2) Parse snapshot if it’s a string
  if (typeof msg?.snapshot === "string") {
    const parsedSnapshot = _safeParse(msg.snapshot);
    if (parsedSnapshot) msg.snapshot = parsedSnapshot;
  }

  // 3) Prefer snapshot as the semantic root
  const root = msg?.snapshot ?? msg ?? {};
  const symbol = root?.symbol ?? msg?.symbol ?? null;

  // 4) Extract bids/asks without altering their existing structure
  const bidsRaw = Array.isArray(root?.bids) ? root.bids : Array.isArray(msg?.bids) ? msg.bids : [];
  const asksRaw = Array.isArray(root?.asks) ? root.asks : Array.isArray(msg?.asks) ? msg.asks : [];

  // 5) Build flat orders for array-based consumers
  const toFlat = (side: OrderSide, arr?: any[]): NormalizedOrder[] =>
    (arr ?? []).map((row) => {
      // Common Hyper shapes:
      //   row.orders[0].Standard  |  row.Standard  |  row (naked)
      const std = row?.orders?.[0]?.Standard ?? row?.Standard ?? row;

      const price = _toNum(std?.price ?? row?.price ?? (Array.isArray(row) ? row[0] : undefined));
      const quantity = _toNum(
        std?.quantity ??
          row?.quantity ??
          row?.visible_quantity ??
          row?.amount ??
          (Array.isArray(row) ? row[1] : undefined)
      );

      const base =
        std && typeof std === "object" ? { ...std } : typeof row === "object" ? { ...row } : {};
      base.price = price;
      base.quantity = quantity;
      base.side = side;

      return base as NormalizedOrder;
    });

  const flatOrders: NormalizedOrder[] = [...toFlat("BUY", bidsRaw), ...toFlat("SELL", asksRaw)];

  // 6) Non-destructive output object
  const out: any = { ...msg };

  // Mirror bids/asks at the top level if only present under snapshot
  if (!Array.isArray(out.bids) && Array.isArray(bidsRaw)) out.bids = bidsRaw;
  if (!Array.isArray(out.asks) && Array.isArray(asksRaw)) out.asks = asksRaw;

  // Provide a guaranteed flat orders array
  out.orders = flatOrders;

  // Derive a marketKey compatible with spot/futures, without colliding helper names
  if (symbol && !out.marketKey) {
    out.marketKey = _normalizePerpKey(String(symbol));
  }

  return out;
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

function _safeParse(s: string): any | null {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function _toNum(v: any): number {
  const n = typeof v === "string" ? Number(v) : v;
  return Number.isFinite(n) ? Number(n) : NaN;
}
