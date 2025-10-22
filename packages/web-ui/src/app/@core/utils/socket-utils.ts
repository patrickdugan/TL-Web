export type MarketKey = string;

export interface CancelRaw {
  marketKey?: string;
  marketId?: string | number;
  instrument_id?: string | number;
  symbol?: string;
  base?: string;
  quote?: string;
  contractId?: string | number;
  orderId?: string;
  maker_socketId?: string; maker_socket_id?: string;
  taker_socketId?: string; taker_socket_id?: string;
  props?: any;
  [k: string]: any;
}

export interface MarketContext {
  byId?: Map<string, MarketKey>;
  byInstrument?: Map<string, MarketKey>;
  bySymbol?: Map<string, MarketKey>;
  byPair?: Map<string, MarketKey>;
  byContract?: Map<string, MarketKey>;
  byOrder?: Map<string, MarketKey>;
  subsBySocket?: Map<string, Set<MarketKey>>;
  defaultKey?: MarketKey;
}

export function normalizeCancel(raw: CancelRaw): CancelRaw {
  const r = { ...raw, ...(raw.props ?? {}) };
  (r as any).maker_socketId = (r as any).maker_socketId ?? (r as any).maker_socket_id;
  (r as any).taker_socketId = (r as any).taker_socketId ?? (r as any).taker_socket_id;
  (r as any).marketId       = (r as any).marketId ?? (r as any).instrument_id;
  return r;
}

export function inferMarketKeyFromCancel(rawIn: CancelRaw, ctx: MarketContext): MarketKey | null {
  const r = normalizeCancel(rawIn);
  if (typeof r.marketKey === 'string' && r.marketKey) return r.marketKey;
  if (r.orderId && ctx.byOrder?.has(r.orderId)) return ctx.byOrder.get(r.orderId)!;

  const id = (r.marketId ?? '').toString();
  if (id && ctx.byId?.has(id)) return ctx.byId.get(id)!;
  if ((r as any).instrument_id && ctx.byInstrument?.has(String((r as any).instrument_id))) {
    return ctx.byInstrument.get(String((r as any).instrument_id))!;
  }

  if (r.symbol && ctx.bySymbol?.has(r.symbol)) return ctx.bySymbol.get(r.symbol)!;

  const base = r.base?.toUpperCase?.();
  const quote = r.quote?.toUpperCase?.();
  if (base && quote) {
    const key = `${base}|${quote}`;
    if (ctx.byPair?.has(key)) return ctx.byPair.get(key)!;
  }

  if ((r.contractId ?? '') !== '' && ctx.byContract?.has(String(r.contractId))) {
    return ctx.byContract.get(String(r.contractId))!;
  }

  const maker = (r as any).maker_socketId;
  const taker = (r as any).taker_socketId;
  if (maker && ctx.subsBySocket?.get(maker)?.size === 1) {
    return Array.from(ctx.subsBySocket.get(maker)!)[0];
  }
  if (taker && ctx.subsBySocket?.get(taker)?.size === 1) {
    return Array.from(ctx.subsBySocket.get(taker)!)[0];
  }

  return ctx.defaultKey ?? null;
}
