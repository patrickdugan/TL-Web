export type AlgoParamSpec =
  | { type: 'int';    default: number; min?: number; max?: number; step?: number }
  | { type: 'number'; default: number; min?: number; max?: number; step?: number }
  | { type: 'string'; default?: string; enum?: string[] }
  | { type: 'bool';   default?: boolean };

export interface AlgoMeta {
  name: string;
  symbol: string;
  venue?: string;
  mode: 'SPOT' | 'FUTURES';
  leverage?: number;
  timeframe?: string;
  description?: string;
  tags?: string[];
  parameters?: Record<string, AlgoParamSpec>;
  risk?: {
    stopLossPct?: number;
    takeProfitPct?: number;
    maxLeverage?: number;
    maxPositions?: number;
  };
  author?: string;
  version?: string;
}

export interface AlgoIndexItem {
  id: string;
  name: string;
  fileName: string;
  size: number;
  createdAt: number;
  status: 'stopped' | 'running';
  amount?: number;
  meta?: AlgoMeta;
}

const ALGO_BLOCK_RE = /\/\*\s*@algo([\s\S]*?)@algo\s*\*\//i;
const ALGO_LINE_RE  = /^\s*\/\/\s*@algo\s*({[\s\S]*})\s*$/m;

function normalizeMeta(m: any): AlgoMeta | undefined {
  if (!m || typeof m !== 'object') return undefined;
  const mode = String(m.mode || '').toUpperCase();
  const meta: AlgoMeta = {
    name: String(m.name || m.symbol || 'Unnamed Strategy'),
    symbol: String(m.symbol || '').toUpperCase(),
    venue: m.venue ? String(m.venue) : undefined,
    mode: mode === 'FUTURES' ? 'FUTURES' : 'SPOT',
    leverage: m.leverage != null ? Number(m.leverage) : undefined,
    timeframe: m.timeframe ? String(m.timeframe) : undefined,
    description: m.description ? String(m.description) : undefined,
    tags: Array.isArray(m.tags) ? m.tags.map((t: any) => String(t)) : undefined,
    parameters: (m.parameters && typeof m.parameters === 'object') ? m.parameters : undefined,
    risk: (m.risk && typeof m.risk === 'object') ? m.risk : undefined,
    author: m.author ? String(m.author) : undefined,
    version: m.version ? String(m.version) : undefined,
  };
  return meta;
}

export function parseAlgoMetaFromSource(src: string): AlgoMeta | undefined {
  try {
    const m = ALGO_BLOCK_RE.exec(src);
    if (m?.[1]) return normalizeMeta(JSON.parse(m[1].trim()));
    const m2 = ALGO_LINE_RE.exec(src);
    if (m2?.[1]) return normalizeMeta(JSON.parse(m2[1]));
  } catch (e: any) {
    console.warn('[algo.meta] parse failed:', e?.message || e);
  }
  return undefined;
}
