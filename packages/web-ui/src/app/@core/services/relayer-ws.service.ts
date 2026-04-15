import { Injectable } from "@angular/core";

type WsRequest = {
  id: string;
  method: string;
  path: string;
  query?: Record<string, any>;
  body?: any;
};

type WsResponse = {
  id?: string;
  ok?: boolean;
  statusCode?: number;
  data?: any;
  error?: any;
};

@Injectable({
  providedIn: "root",
})
export class RelayerWsService {
  private baseUrl: string | null = null;
  private ws: WebSocket | null = null;
  private wsUrl: string | null = null;
  private connectPromise: Promise<void> | null = null;
  private nextId = 1;
  private pending = new Map<
    string,
    { resolve: (value: any) => void; reject: (reason?: any) => void; timeout: any }
  >();

  private sanitizePath(path: string) {
    if (!path) return null;
    if (!path.startsWith("/")) return null;
    if (path.includes("..")) return null;
    return path;
  }

  setBaseUrl(url: string | null) {
    const normalized = url?.trim() || null;
    if (normalized === this.baseUrl) return;

    this.baseUrl = normalized;
    this.wsUrl = normalized ? this.toWsUrl(normalized) : null;
    this.teardownSocket();
  }

  async request<T = any>(
    path: string,
    opts?: { method?: string; query?: Record<string, any>; body?: any; timeoutMs?: number }
  ): Promise<T> {
    if (!this.baseUrl || !this.wsUrl) {
      throw new Error("Relayer base URL is not configured");
    }

    await this.ensureConnected();

    const id = String(this.nextId++);
    const timeoutMs = opts?.timeoutMs ?? 15000;
    const requestPath = this.sanitizePath(path);
    if (!requestPath) {
      throw new Error("Invalid relayer request path");
    }
    const payload: WsRequest = {
      id,
      method: (opts?.method || (opts?.body ? "POST" : "GET")).toUpperCase(),
      path: requestPath,
      query: opts?.query,
      body: opts?.body,
    };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Relayer WS timeout for ${payload.path}`));
      }, timeoutMs);

      this.pending.set(id, { resolve, reject, timeout });
      this.ws?.send(JSON.stringify(payload));
    });
  }

  private async ensureConnected(): Promise<void> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) return;
    if (this.connectPromise) return this.connectPromise;
    if (!this.wsUrl) throw new Error("Relayer WS URL is not configured");

    this.connectPromise = new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(this.wsUrl as string);
      this.ws = ws;

      ws.onopen = () => {
        this.connectPromise = null;
        resolve();
      };

      ws.onmessage = (event) => this.handleMessage(event.data);

      ws.onerror = () => {
        if (this.connectPromise) {
          this.connectPromise = null;
          reject(new Error("Failed to connect to relayer WS"));
        }
      };

      ws.onclose = () => {
        this.rejectAllPending("Relayer WS disconnected");
        this.ws = null;
      };
    });

    return this.connectPromise;
  }

  private handleMessage(raw: any) {
    let msg: WsResponse;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (!msg.id) return;
    const pending = this.pending.get(msg.id);
    if (!pending) return;

    clearTimeout(pending.timeout);
    this.pending.delete(msg.id);

    if (msg.ok) {
      pending.resolve(msg.data);
    } else {
      pending.reject(new Error(msg.error || "Relayer WS request failed"));
    }
  }

  private teardownSocket() {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.connectPromise = null;
    this.rejectAllPending("Relayer WS reconfigured");
  }

  private rejectAllPending(reason: string) {
    for (const [, pending] of this.pending.entries()) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(reason));
    }
    this.pending.clear();
  }

  private toWsUrl(url: string): string {
    const trimmed = url.replace(/\/+$/, "");
    if (trimmed.startsWith("wss://") || trimmed.startsWith("ws://")) {
      return `${trimmed}/ws`;
    }
    if (trimmed.startsWith("https://")) {
      return `${trimmed.replace(/^https:\/\//, "wss://")}/ws`;
    }
    if (trimmed.startsWith("http://")) {
      return `${trimmed.replace(/^http:\/\//, "ws://")}/ws`;
    }
    return `wss://${trimmed}/ws`;
  }
}
