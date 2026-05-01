export interface AlgoRunnerStrategyPayload {
  id: string;
  source: string;
  name?: string;
  meta?: Record<string, unknown>;
}

export interface AlgoRunnerStartPayload {
  systemId: string;
  source: string;
  config: Record<string, unknown>;
  meta: Record<string, unknown>;
}

export interface AlgoRunnerStartResult {
  systemId: string;
  startedAt: number;
}

export interface AlgoRunnerRunningInstance {
  systemId: string;
  startedAt: number;
  amount: number;
  pnlUsd: number;
  status: 'running' | 'stopped';
}

export type AlgoRunnerEvent =
  | { type: 'log'; systemId: string; args: unknown[] }
  | { type: 'metric'; systemId: string; pnl: number }
  | { type: 'order'; systemId: string; order: Record<string, unknown> }
  | { type: 'stopped'; systemId: string }
  | { type: 'error'; systemId: string; error: string };
