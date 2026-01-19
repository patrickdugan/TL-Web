// src/app/@core/services/wallet.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject, Subject } from 'rxjs';
import { filter, take } from 'rxjs/operators';
import { RpcService, TNETWORK } from './rpc.service';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WalletKind = 'phantom-btc' | 'custom';

type PhantomBtc = {
  request: (args: { method: string; params?: any }) => Promise<any>;
  requestAccounts?: () => Promise<any>;
  on?: (ev: string, cb: (...a: any[]) => void) => void;
};

interface MultisigRecord {
  m: number;
  pubKeys: string[];
  redeemScript: string;
  address?: string;
}


interface IWalletProvider {
  kind: WalletKind;
  name: string;
  isAvailable(): boolean;

  connect?(network: 'mainnet' | 'testnet'): Promise<void>;
  getAddresses(network: 'mainnet' | 'testnet'): Promise<string[]>;

  signMessage(
    address: string,
    message: string,
    scheme?: 'bip322' | 'ecdsa'
  ): Promise<string>;

  signPsbt(
    psbtBase64: string,
    opts?: { autoFinalize?: boolean; broadcast?: boolean }
  ): Promise<string>;

  signTransactionHex?(txHex: string, network: string): Promise<string>;

  addMultisig?(
    m: number,
    pubkeys: string[],
    network: string
  ): Promise<{ address: string; redeemScript?: string }>;

  on?(ev: 'accountsChanged' | 'networkChanged', cb: (...a: any[]) => void): void;
}

// ---------------------------------------------------------------------------
// Session Auth Types (for WebSocket integration)
// ---------------------------------------------------------------------------

interface SessionState {
  token: string | null;
  address: string | null;
  expiresAt: number | null;
  wsAuthed: boolean;
}

interface WsAuthResult {
  success: boolean;
  address?: string;
  expiresAt?: number;
  error?: string;
}

const isLtcNet = (net?: TNETWORK | string) =>
  String(net ?? '').toUpperCase().startsWith('LTC');

const getPhantomBtc = (net?: TNETWORK | string): PhantomBtc | undefined => {
  if (isLtcNet(net)) return undefined;
  return (window as any).phantom?.bitcoin as PhantomBtc | undefined;
};

// ---------------------------------------------------------------------------
// WalletService
// ---------------------------------------------------------------------------

@Injectable({ providedIn: 'root' })
export class WalletService {
  constructor(private rpc: RpcService) {
    const net = (this.rpc.NETWORK || '').toUpperCase();
  }

  public provider$ = new BehaviorSubject<IWalletProvider | null>(null);
  public addresses$ = new BehaviorSubject<string[]>([]);
  public address$ = new BehaviorSubject<string | null>(null);
  
  // Session state (REST token + WS auth status)
  private sessionToken$ = new BehaviorSubject<string | null>(null);
  private sessionState$ = new BehaviorSubject<SessionState>({
    token: null,
    address: null,
    expiresAt: null,
    wsAuthed: false,
  });

  // Expose session state for components
  public get sessionState() { return this.sessionState$.value; }
  public get isWsAuthed() { return this.sessionState$.value.wsAuthed; }
  public get sessionToken() { return this.sessionState$.value.token; }

  // For session refresh scheduling
  private refreshTimer: ReturnType<typeof setTimeout> | null = null;

  private customWalletNetwork(): string {
    const n = (this.rpc.NETWORK || '').toUpperCase();
    if (n === 'LTCTEST') return 'testnet';
    if (n === 'LTC') return 'mainnet';
    return n;
  }

  get baseUrl(): string {
    const net = (this.rpc.NETWORK || "").toUpperCase();
    return net.includes("TEST")
      ? "https://testnet-api.layerwallet.com"
      : "https://api.layerwallet.com";
  }

  get wsUrl(): string {
    const net = (this.rpc.NETWORK || "").toUpperCase();
    return net.includes("TEST")
      ? "wss://testnet-ob.layerwallet.com/ws"
      : "wss://ob.layerwallet.com/ws";
  }

  get network(): TNETWORK {
    return this.rpc.NETWORK;
  }

  public isWalletAvailable(): boolean {
    return this.available().length > 0;
  }

  get activeWallet(): 'phantom' | 'custom' | null {
    const p = this.provider$.value;
    if (!p) return null;
    if (p.kind === 'phantom-btc') return 'phantom';
    if (p.kind === 'custom') return 'custom';
    return null;
  }

  // In-memory + persistent cache for multisig
  private multisigCache = new Map<string, MultisigRecord>();

  // -------------------------------------------------------------------------
  // Session Auth (REST + WebSocket)
  // -------------------------------------------------------------------------

  /**
   * Establish a session via REST (challenge -> sign -> verify).
   * This gets you a sessionToken for authenticating WebSocket connections.
   */
  async establishSession(): Promise<string> {
    const addr = this.address$.value;
    if (!addr) throw new Error('No active address');

    // 1. Get challenge
    const challenge = await fetch(`${this.baseUrl}/auth/challenge`)
      .then(r => r.json());

    // 2. Sign with wallet
    const signature = await this.signMessage(challenge.message, 'bip322');

    // 3. Verify and get token
    const res = await fetch(`${this.baseUrl}/auth/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        address: addr,
        message: challenge.message,
        signature
      }),
      credentials: 'include'
    }).then(r => r.json());

    if (!res.sessionToken) {
      throw new Error(res.error || 'Session auth failed');
    }

    // Update state
    this.sessionToken$.next(res.sessionToken);
    this.sessionState$.next({
      ...this.sessionState$.value,
      token: res.sessionToken,
      address: addr,
      expiresAt: res.expiresAt,
      wsAuthed: false, // not yet authed on WS
    });

    return res.sessionToken;
  }

  /**
   * Authenticate an existing WebSocket connection using the session token.
   * Call this after establishSession() and after WS connects.
   */
  async authenticateWebSocket(ws: WebSocket): Promise<WsAuthResult> {
    const token = this.sessionState$.value.token;
    if (!token) {
      // Auto-establish session if we have an address
      if (this.address$.value) {
        await this.establishSession();
      } else {
        return { success: false, error: 'No session token - call establishSession first' };
      }
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        ws.removeEventListener('message', handler);
        resolve({ success: false, error: 'Auth timeout' });
      }, 10000);

      const handler = (event: MessageEvent) => {
        let data: any;
        try {
          data = JSON.parse(event.data);
        } catch {
          return; // ignore non-JSON
        }

        if (data.event === 'auth_ok') {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          
          // Update session state
          this.sessionState$.next({
            ...this.sessionState$.value,
            wsAuthed: true,
            address: data.address,
            expiresAt: data.expiresAt,
          });

          resolve({
            success: true,
            address: data.address,
            expiresAt: data.expiresAt,
          });
        } else if (data.event === 'auth_ignored') {
          // Desktop/bot client - auth not needed
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          
          this.sessionState$.next({
            ...this.sessionState$.value,
            wsAuthed: true, // effectively authed via client class
          });

          resolve({ success: true });
        } else if (data.event === 'error' && 
                   (data.message?.includes('session') || data.message?.includes('token'))) {
          clearTimeout(timeout);
          ws.removeEventListener('message', handler);
          resolve({ success: false, error: data.message });
        }
      };

      ws.addEventListener('message', handler);
      
      // Send auth message
      ws.send(JSON.stringify({ 
        event: 'auth', 
        token: this.sessionState$.value.token 
      }));
    });
  }

  /**
   * Full flow: establish session + connect WS + authenticate.
   * Returns the authenticated WebSocket ready for trading.
   */
  async connectAndAuthWebSocket(wsUrl?: string): Promise<WebSocket> {
    // 1. Ensure we have a wallet connected
    if (!this.address$.value) {
      await this.connectPreferred();
    }

    // 2. Establish REST session
    await this.establishSession();

    // 3. Connect WebSocket
    const url = wsUrl || this.wsUrl;
    const ws = new WebSocket(url);

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('WS connect timeout')), 10000);
      ws.onopen = () => { clearTimeout(timeout); resolve(); };
      ws.onerror = () => { clearTimeout(timeout); reject(new Error('WS connect failed')); };
    });

    // 4. Wait for 'connected' event and check if auth is required
    const connectInfo = await new Promise<{ id: string; authRequired: boolean }>((resolve) => {
      const handler = (event: MessageEvent) => {
        const data = JSON.parse(event.data);
        if (data.event === 'connected') {
          ws.removeEventListener('message', handler);
          resolve({ 
            id: data.id, 
            authRequired: data.authRequired ?? true 
          });
        }
      };
      ws.addEventListener('message', handler);
    });

    console.log(`[WalletService] WS connected, id=${connectInfo.id}, authRequired=${connectInfo.authRequired}`);

    // 5. Authenticate if required (web clients)
    if (connectInfo.authRequired) {
      const authResult = await this.authenticateWebSocket(ws);
      if (!authResult.success) {
        ws.close();
        throw new Error(authResult.error || 'WS auth failed');
      }
      console.log(`[WalletService] WS authenticated as ${authResult.address}`);
    }

    // 6. Schedule session refresh
    this.scheduleSessionRefresh(ws);

    return ws;
  }

  /**
   * Refresh the session before it expires.
   * Re-authenticates both REST and WebSocket.
   */
  async refreshSession(ws?: WebSocket): Promise<void> {
    // Get fresh session token
    await this.establishSession();

    // Re-auth WebSocket if provided and open
    if (ws && ws.readyState === WebSocket.OPEN) {
      const result = await this.authenticateWebSocket(ws);
      if (!result.success) {
        console.warn('[WalletService] WS re-auth failed:', result.error);
      }
    }
  }

  /**
   * Schedule automatic session refresh before expiry.
   */
  private scheduleSessionRefresh(ws: WebSocket, marginMs: number = 60000): void {
    // Clear any existing timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    const expiresAt = this.sessionState$.value.expiresAt;
    if (!expiresAt) return;

    const refreshAt = expiresAt - marginMs;
    const delay = refreshAt - Date.now();

    if (delay > 0) {
      this.refreshTimer = setTimeout(async () => {
        try {
          await this.refreshSession(ws);
          // Reschedule for next refresh
          if (ws.readyState === WebSocket.OPEN) {
            this.scheduleSessionRefresh(ws, marginMs);
          }
        } catch (err) {
          console.error('[WalletService] Session refresh failed:', err);
        }
      }, delay);
    }
  }

  /**
   * Logout: clear session and optionally notify server.
   */
  async logout(): Promise<void> {
    const token = this.sessionState$.value.token;
    
    // Clear refresh timer
    if (this.refreshTimer) {
      clearTimeout(this.refreshTimer);
      this.refreshTimer = null;
    }

    // Clear state
    this.sessionState$.next({
      token: null,
      address: null,
      expiresAt: null,
      wsAuthed: false,
    });
    this.sessionToken$.next(null);

    // Notify server (best effort)
    if (token) {
      try {
        await fetch(`${this.baseUrl}/auth/logout`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token }),
        });
      } catch {}
    }
  }

  // -------------------------------------------------------------------------
  // Multisig helpers
  // -------------------------------------------------------------------------

  async checkIP(): Promise<{ ip: string; isVpn: boolean; countryCode: string }> {
    const res = await fetch(`${this.baseUrl}/attestation/ip`, {
      method: "GET",
      credentials: "include"
    }).then(r => r.json());

    return res;
  }

  private msigKey(m: number, pubKeys: string[]): string {
    return `${m}:${[...pubKeys].sort().join(',')}`;
  }

  private loadLocalMsig(key: string): MultisigRecord | null {
    const raw = localStorage.getItem('msig:' + key);
    return raw ? JSON.parse(raw) : null;
  }

  private saveLocalMsig(key: string, rec: MultisigRecord): void {
    localStorage.setItem('msig:' + key, JSON.stringify(rec));
  }

  private async fetchMsDataFromRelayer(
    m: number,
    pubKeys: string[]
  ): Promise<MultisigRecord> {
    const url = `${this.baseUrl}/tx/multisig`;

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        m,
        pubKeys,
        network: this.rpc.NETWORK,
      }),
    }).then((r) => r.json());

    if (!response.success) {
      throw new Error(`Failed to compute multisig: ${response.error}`);
    }

    return response.data;
  }

  /** Canonical multisig builder */
  async addMultisig(m: number, pubKeys: string[]): Promise<MultisigRecord> {
    const provider = this.provider$.value || this.pick();
    console.log('provider in addMultisig '+provider)
    if (!provider) throw new Error('Wallet not connected');

    const key = this.msigKey(m, pubKeys);

    // 1. Check in-memory cache
    let cached = this.multisigCache.get(key);
    if (cached) return cached;

    // 2. Check localStorage
    const local = this.loadLocalMsig(key);
    if (local) {
      this.multisigCache.set(key, local);
      return local;
    }

    // 3. Phantom: must compute via relayer first, then cache
    if (provider.kind === 'phantom-btc') {
      const msRec = await this.fetchMsDataFromRelayer(m, pubKeys);
      this.saveLocalMsig(key, msRec);
      this.multisigCache.set(key, msRec);
      return msRec;
    }

    // 4. Custom extension: use wallet RPC, then cache
    if (provider.kind === 'custom' && provider.addMultisig) {
      
      const network = this.customWalletNetwork();
      console.log('network in build multisig ' + network);
      const res = await provider.addMultisig(m, pubKeys, network);

      const msRec: MultisigRecord = {
        m,
        pubKeys,
        redeemScript: res.redeemScript!,
        address: res.address,
      };

      this.saveLocalMsig(key, msRec);
      this.multisigCache.set(key, msRec);
      return msRec;
    }

    throw new Error(`Unsupported wallet provider: ${provider.kind}`);
  }

  async signPsbtWithPhantom(psbtBase64: string): Promise<string> {
    return this.signPsbt(psbtBase64, { autoFinalize: true, broadcast: false });
  }

  // -------------------------------------------------------------------------
  // Providers (lightweight)
  // -------------------------------------------------------------------------

  private phantomBtc: IWalletProvider = {
    kind: 'phantom-btc',
    name: 'Phantom (Bitcoin)',
    isAvailable: () => !!getPhantomBtc('BTC'),

    connect: async (net) => {
      const ph = getPhantomBtc(net);
      if (!ph) throw new Error('Phantom Bitcoin not available');
      await ph.request({ method: 'btc_connect', params: { network: net } });
    },

    getAddresses: async (net) => {
      const ph = getPhantomBtc(net);
      if (!ph) throw new Error('Phantom Bitcoin not available');
      const r = await ph.request({ method: 'btc_getAddresses' });
      return (r.addresses ?? []).map((a: any) => a.address);
    },

    signMessage: async (addr, message, scheme = 'bip322') => {
      const ph = getPhantomBtc();
      if (!ph) throw new Error('Phantom Bitcoin not available');
      const r = await ph.request({
        method: 'btc_signMessage',
        params: { address: addr, message, type: scheme },
      });
      return r.signature;
    },

    signPsbt: async (psbtBase64, opts) => {
      const ph = getPhantomBtc();
      if (!ph) throw new Error('Phantom Bitcoin not available');
      const r = await ph.request({
        method: 'btc_signPsbt',
        params: {
          psbt: psbtBase64,
          autoFinalize: opts?.autoFinalize ?? true,
          broadcast: opts?.broadcast ?? false,
        },
      });
      return r?.psbt ?? psbtBase64;
    },

    on: (ev, cb) => getPhantomBtc()?.on?.(ev, cb),
  };

  private customExt: IWalletProvider = {
    kind: 'custom',
    name: 'TradeLayer Extension',
    isAvailable: () => !!window.myWallet,

    connect: async () => {
      try {
        await window.myWallet!.sendRequest('connect', {});
      } catch {}
    },

    getAddresses: async (net) => {
      const appNet = this.rpc.NETWORK || 'BTC';
      const reqNet = net === 'testnet' ? 'LTCTEST' : appNet;
      const r = await window.myWallet!.sendRequest('requestAccounts', {
        network: reqNet,
      });
      return (r || []).map((a: any) => a.address);
    },

    signMessage: async (_addr, msg) => {
      return window.myWallet!.sendRequest('signMessage', { message: msg });
    },

    signPsbt: async (psbtBase64) => {
      const hex = base64ToHex(psbtBase64);
      const r = await window.myWallet!.sendRequest('signPSBT', {
        transaction: hex,
        network: this.rpc.NETWORK,
      });
      const out =
        typeof r === 'string' ? r : r?.psbt ?? r?.transaction ?? hex;
      return isHex(out) ? hexToBase64(out) : out;
    },

    signTransactionHex: async (txHex, network) => {
      return window.myWallet!.sendRequest('signTransaction', {
        transaction: txHex,
        network,
      });
    },

    addMultisig: async (m, pubkeys, network) => {
      return window.myWallet!.sendRequest('addMultisig', {
        m,
        pubkeys,
        network,
      });
    },

    on: (ev, cb) => window.myWallet?.on?.(ev, cb),
  };

  // -------------------------------------------------------------------------
  // Provider selection
  // -------------------------------------------------------------------------

  private available(): IWalletProvider[] {
    return [this.phantomBtc, this.customExt].filter((p) => p.isAvailable());
  }

  private providerNet(): 'mainnet' | 'testnet' {
    const n = (this.rpc.NETWORK || '').toUpperCase();
    return n.includes('TEST') ? 'testnet' : 'mainnet';
  }

  private pick(): IWalletProvider | null {
    const opts = this.available();
    const isLtc = isLtcNet(this.rpc.NETWORK);
    if (isLtc) return opts.find((p) => p.kind === 'custom') || opts[0] || null;
    return opts.find((p) => p.kind === 'phantom-btc') || opts[0] || null;
  }

  // -------------------------------------------------------------------------
  // Connect logic
  // -------------------------------------------------------------------------

  private async finishConnect(p: IWalletProvider) {
    const net = this.providerNet();
    await p.connect?.(net);

    this.provider$.next(p);

    const addrs = await p.getAddresses(net);
    this.addresses$.next(addrs);
    this.address$.next(addrs[0] ?? null);

    p.on?.('accountsChanged', (accs) => {
      this.addresses$.next(accs || []);
      this.address$.next(accs?.[0] ?? null);
      // Clear session on account change - will need to re-auth
      this.sessionState$.next({
        token: null,
        address: null,
        expiresAt: null,
        wsAuthed: false,
      });
    });

    p.on?.('networkChanged', (newNet) => {
      console.log('[wallet] networkChanged', newNet);
    });
  }

  async connectPreferred(): Promise<void> {
    const p = this.pick();
    if (!p) throw new Error('No supported wallet found');
    await this.finishConnect(p);
  }

  // -------------------------------------------------------------------------
  // Core signing + account request
  // -------------------------------------------------------------------------

  async requestAccounts(
    network?: string
  ): Promise<{ address: string; pubkey?: string }[]> {
    const isBTC = network === 'BTC' || network === 'BITCOIN';
    const phantomBtc = getPhantomBtc();

    if (isBTC && phantomBtc?.requestAccounts) {
      try {
        const btcAccs = await phantomBtc.requestAccounts();
        return btcAccs.map((a: any) => ({
          address: a.address,
          pubkey: a.publicKey,
        }));
      } catch {}
    }

    const accs = await window.myWallet!.sendRequest('requestAccounts', {
      network,
    });

    return accs.map((a: any) => ({
      address: a.address,
      pubkey: a.pubkey,
    }));
  }

  async signMessage(
    msg: string,
    scheme: 'bip322' | 'ecdsa' = 'bip322'
  ): Promise<string> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet not connected');

    const addr =
      this.address$.value || (await this.requestAccounts())[0]?.address;
    return p.signMessage(addr, msg, scheme);
  }

  async signPsbt(
    psbtBase64: string,
    opts?: { autoFinalize?: boolean; broadcast?: boolean }
  ): Promise<string> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet not connected');
    return p.signPsbt(psbtBase64, opts);
  }

  async signTransaction(
    txHex: string,
    network: string
  ): Promise<string> {
    const p = this.provider$.value || this.pick();
    if (!p || !p.signTransactionHex)
      throw new Error('signTransaction not supported');
    return p.signTransactionHex(txHex, network);
  }
}

// ---------------------------------------------------------------------------
// Hex/Base64 Utils
// ---------------------------------------------------------------------------

function isHex(s: string): boolean {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}

function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; i++)
    out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}

function hexToBase64(hex: string): string {
  if (!isHex(hex)) return hex;
  const bytes = hex.match(/.{1,2}/g)!.map((h) => parseInt(h, 16));
  const bin = String.fromCharCode(...bytes);
  return btoa(bin);
}

// ---------------------------------------------------------------------------
// Window type augmentation
// ---------------------------------------------------------------------------

declare global {
  interface Window {
    myWallet?: {
      sendRequest: (method: string, params?: any) => Promise<any>;
      on?: (ev: string, cb: (...a: any[]) => void) => void;
    };
  }
}
