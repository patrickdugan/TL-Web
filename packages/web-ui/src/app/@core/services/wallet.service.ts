// src/app/@core/services/wallet.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RpcService, TNETWORK } from './rpc.service';

type WalletKind = 'phantom-btc' | 'custom';

type PhantomBtc = {
  request: (args: { method: string; params?: any }) => Promise<any>;
  on?: (ev: string, cb: (...a: any[]) => void) => void;
};

interface MultisigRecord {
  m: number;
  pubKeys: string[];
  redeemScript: string;
  address?: string;
}

const isLtcNet = (net?: TNETWORK | string) =>
  String(net ?? '').toUpperCase().startsWith('LTC');

const getPhantomBtc = (net?: TNETWORK | string): PhantomBtc | undefined => {
  // Prevent Phantom from hijacking Litecoin flows
  if (isLtcNet(net)) return undefined;
  return (window as any).phantom?.bitcoin as PhantomBtc | undefined;
};

interface IWalletProvider {
  kind: WalletKind;
  name: string;
  isAvailable(): boolean;

  connect?(network: 'mainnet' | 'testnet'): Promise<void>;
  getAddresses(network: 'mainnet' | 'testnet'): Promise<string[]>;

  signMessage(address: string, message: string, scheme?: 'bip322' | 'ecdsa'): Promise<string>;
  signPsbt(psbtBase64: string, opts?: { autoFinalize?: boolean; broadcast?: boolean }): Promise<string>;

  // custom-only extras:
  signTransactionHex?(txHex: string, network: string): Promise<string>;
  addMultisig?(
    m: number,
    pubkeys: string[],
    network: string
  ): Promise<{ address: string; redeemScript?: string }>;

  on?(ev: 'accountsChanged' | 'networkChanged', cb: (...args: any[]) => void): void;
}

@Injectable({ providedIn: 'root' })
export class WalletService {
  constructor(private rpc: RpcService) {
    const net = (this.rpc.NETWORK || '').toUpperCase();

    this.baseUrl = net.includes('TEST')
      ? "https://testnet-api.layerwallet.com"
      : "https://api.layerwallet.com";
  }

  // Reactive state (handy if you bind in header/futures)
  public provider$  = new BehaviorSubject<IWalletProvider | null>(null);
  public addresses$ = new BehaviorSubject<string[]>([]);
  public address$   = new BehaviorSubject<string | null>(null);
  public baseUrl: string;


  // ---- Providers ------------------------------------------------------------

  private multisigCache = new Map<string, MultisigRecord>();

  private msigKey(m: number, pubKeys: string[]): string {
    // sort pubkeys for deterministic key
    const sorted = [...pubKeys].sort();
    return `${m}:${sorted.join(',')}`;
  }


  private phantomBtc: IWalletProvider = {
    kind: 'phantom-btc',
    name: 'Phantom (Bitcoin)',
    isAvailable: () => !!getPhantomBtc('BTC' as any),

  connect: async (net) => {
    const ph = getPhantomBtc(net);
    if (!ph) throw new Error('Phantom Bitcoin provider not available');
    await ph.request({ method: 'btc_connect', params: { network: net } });
  },

  getAddresses: async (net) => {
    const ph = getPhantomBtc(net);
    if (!ph) throw new Error('Phantom Bitcoin provider not available');
    const res = await ph.request({ method: 'btc_getAddresses' });
    return (res?.addresses ?? []).map((x: any) => x.address);
  },

  signMessage: async (address, message, scheme = 'bip322') => {
    const ph = getPhantomBtc();
    if (!ph) throw new Error('Phantom Bitcoin provider not available');
    const res = await ph.request({
      method: 'btc_signMessage',
      params: { address, message, type: scheme },
    });
    return res.signature; // base64
  },

  signPsbt: async (psbtBase64, opts) => {
    const ph = getPhantomBtc();
    if (!ph) throw new Error('Phantom Bitcoin provider not available');
    const res = await ph.request({
      method: 'btc_signPsbt',
      params: {
        psbt: psbtBase64,
        autoFinalize: opts?.autoFinalize ?? true,
        broadcast: opts?.broadcast ?? false,
      },
    });
    return res?.psbt ?? psbtBase64;
  },

  on: (ev, cb) => getPhantomBtc()?.on?.(ev, cb),
  };

  private customExt: IWalletProvider = {
    kind: 'custom',
    name: 'TradeLayer Extension',
    isAvailable: () => !!window.myWallet,

    connect: async (_net) => {
      try { await window.myWallet!.sendRequest('connect', {}); } catch { /* no-op */ }
    },

    getAddresses: async (net) => {
      // Your extension expects a chain name. Map provider net → app net.
      const appNet = this.rpc.NETWORK || 'BTC';
      const reqNet = net === 'testnet' ? 'LTCTEST' : appNet;
      const res = await window.myWallet!.sendRequest('requestAccounts', { network: reqNet });
      return (res || []).map((x: any) => x.address);
    },

    signMessage: async (_address, message) => {
      return await window.myWallet!.sendRequest('signMessage', { message });
    },

    // Your ext historically used hex. We accept base64 app-wide, convert as needed.
    signPsbt: async (psbtBase64, _opts) => {
      const hex = base64ToHex(psbtBase64);
      const res = await window.myWallet!.sendRequest('signPSBT', {
        transaction: hex,
        network: this.rpc.NETWORK,
      });
      const out = typeof res === 'string' ? res : (res?.psbt ?? res?.transaction ?? hex);
      return isHex(out) ? hexToBase64(out) : out;
    },

    signTransactionHex: async (txHex, network) => {
      return await window.myWallet!.sendRequest('signTransaction', { transaction: txHex, network });
    },

    private loadLocalMsig(key: string): MultisigRecord | null {
        const raw = localStorage.getItem("msig:" + key);
        return raw ? JSON.parse(raw) : null;
    },

    private async fetchMsDataFromRelayer(
      m: number,
      pubKeys: string[]
    ): Promise<MultisigRecord> {
      const isTest = String(this.rpc.NETWORK).toLowerCase().includes("test");

      const url = `${this.rpc.baseUrl}/tx/multisig`;

      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          m,
          pubKeys,
          network: this.rpc.NETWORK,
        }),
      }).then(r => r.json());

      if (!response.success) {
        throw new Error(`Failed to compute multisig: ${response.error}`);
      }

      return response.data;
    },


    private saveLocalMsig(key: string, data: MultisigRecord) {
        localStorage.setItem("msig:" + key, JSON.stringify(data));
    },

    async addMultisig(
      m: number,
      pubKeys: string[],
      msData?: MultisigRecord   // optional, see call-site note below
    ): Promise<MultisigRecord> {
      const provider = this.pick?.(); // or however you select the active provider
      if (!provider) throw new Error('No wallet provider available');

      const key = this.msigKey(m, pubKeys);

      // ✅ Phantom path: purely local cache, no provider RPC
      if (provider.kind === 'phantom-btc') {
        // Already cached? Just return it.
        const cached = this.multisigCache.get(key);
        if (cached) return cached;

        if (!msData) {
          // For Phantom we need caller to give us the msData once
          throw new Error('Multisig data (msData) required for Phantom.');
        }

        this.multisigCache.set(key, msData);
        return msData;
      }

      // ✅ Custom extension path: keep old behavior
      if (provider.kind === 'custom') {
        const res = await (window as any).myWallet.sendRequest('addMultisig', {
          m,
          pubKeys,
          network: this.rpc.NETWORK,
        });

        if (!res || !res.success) {
          throw new Error(res?.error || 'addMultisig failed in custom wallet.');
        }

        const result: MultisigRecord = {
          m,
          pubKeys,
          redeemScript: res.data.redeemScript,
          address: res.data.address,
        };

        // Also cache for consistency
        this.multisigCache.set(key, result);
        return result;
      }

      throw new Error(`Unsupported wallet provider kind: ${provider.kind}`);
    }


    on: (ev, cb) => window.myWallet?.on?.(ev, cb),
  };

  // ---- Selection & connection ----------------------------------------------

// ---- Selection & connection ----------------------------------------------

/** Return all wallets that are currently available in the browser. */
private available(): IWalletProvider[] {
  return [this.phantomBtc, this.customExt].filter(p => p?.isAvailable?.());
}

/** Map app network → wallet network key. */
private providerNet(): 'mainnet' | 'testnet' {
  const n = (this.rpc.NETWORK || '').toUpperCase();
  if (n.includes('TEST')) return 'testnet';
  return 'mainnet';
}

/**
 * Pick the best default wallet for current network.
 * Phantom wins for BTC; custom wins for LTC / TL networks.
 */
private pick(): IWalletProvider | null {
  const opts = this.available();
  const net = this.providerNet();
  const isLtc = String(this.rpc.NETWORK || '').toUpperCase().startsWith('LTC');
  if (isLtc) return opts.find(p => p.kind === 'custom') || opts[0] || null;
  return opts.find(p => p.kind === 'phantom-btc') || opts[0] || null;
}

/** For a dropdown UI (Phantom first if present). */
getDetectedProviders(): { primary: IWalletProvider | null; options: IWalletProvider[] } {
  const options = this.available();
  const primary = this.pick();
  return { primary, options };
}

/**
 * High-level connect that automatically picks provider based on network.
 */
async connectPreferred(): Promise<void> {
  const p = this.pick();
  if (!p) throw new Error('No supported wallet found (Phantom or TL extension).');
  await this.finishConnect(p);
}

/** Force-use a specific provider kind (e.g. user selection). */
async useProvider(kind: WalletKind): Promise<void> {
  const p = this.available().find(x => x.kind === kind);
  if (!p) throw new Error(`Wallet provider ${kind} not available`);
  await this.finishConnect(p);
}

/**
 * Finalize the connection logic with optional network switch fallback.
 */
private async finishConnect(p: IWalletProvider) {
  const net = this.providerNet();

  await p.connect?.(net);

  this.provider$.next(p);

  // Resolve addresses (some wallets ignore network param)
  const addrs = await p.getAddresses(net);
  this.addresses$.next(addrs);
  this.address$.next(addrs[0] ?? null);

  // Re-wire event listeners safely
  p.on?.('accountsChanged', (accs: string[]) => {
    this.addresses$.next(accs || []);
    this.address$.next(accs?.[0] ?? null);
  });

  p.on?.('networkChanged', (newNet?: any) => {
    console.log('[wallet] networkChanged event', newNet);
    // optional: trigger re-sync / UI update
  });
}

  // ---- Public API (clean, de-duped) ----------------------------------------

  isWalletAvailable(): boolean {
    return this.available().length > 0;
  }

 async requestAccounts(network?: string): Promise<{ address: string; pubkey?: string }[]> {
  // Prefer Phantom for BTC so we always get a pubkey
  const isBTC = network === 'BTC' || network === 'BITCOIN';
  const phantomBtc = (window as any)?.phantom?.bitcoin;

  if (isBTC && phantomBtc?.requestAccounts) {
    try {
      const btcAccounts = await phantomBtc.requestAccounts(); // prompts connect if needed
      return btcAccounts.map((a: { address: string; publicKey: string }) => ({
        address: a.address,
        pubkey: a.publicKey, // <- normalize to your shape
      }));
    } catch (e) {
      console.warn('[wallet] Phantom requestAccounts failed, falling back to myWallet', e);
      // fall through to myWallet
    }
  }

  // Non-BTC (or Phantom unavailable): original Layer Extension path
  try {
    const accounts = await window.myWallet!.sendRequest('requestAccounts', { network });
    if (!accounts || accounts.length === 0) {
      throw new Error('No accounts returned by the wallet');
    }

    // Normalize to { address, pubkey? }
    return accounts.map((account: { address: string; pubkey?: string }) => ({
      address: account.address,
      pubkey: account.pubkey, // may be undefined for now if your extension doesn't fill it
    }));
  } catch (error: any) {
    console.error('Error requesting accounts:', error?.message || error);
    throw new Error('Failed to request accounts');
  }
}



  async signMessage(message: string, scheme: 'bip322' | 'ecdsa' = 'bip322'): Promise<string> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet not connected');
    const addr = this.address$.value || (await this.requestAnyAddress());
    return p.signMessage(addr, message, scheme);
  }

  /** Canonical PSBT signer: base64 in → base64 out */
  async signPsbt(psbtBase64: string, opts?: { autoFinalize?: boolean; broadcast?: boolean }): Promise<string> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet not connected');

    // Phantom path is already base64; custom path converts internally
    return p.signPsbt(psbtBase64, opts);
  }

  // ---- Legacy aliases (kept to avoid widespread refactors) -----------------
  /** Legacy name – delegates to signPsbt */
  async signPSBT(psbtBase64: string, opts?: { autoFinalize?: boolean; broadcast?: boolean }) {
    return this.signPsbt(psbtBase64, opts);
  }

  async signTransaction(transactionHex: string, network: string): Promise<string> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet not connected');
    if (p.kind !== 'custom' || !p.signTransactionHex) {
      throw new Error('signTransaction is not supported by this wallet');
    }
    return p.signTransactionHex(transactionHex, network);
  }

  async addMultisig(m: number, pubkeys: string[]): Promise<{ address: string; redeemScript?: string }> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet not connected');
    if (p.kind !== 'custom' || !p.addMultisig) {
      throw new Error('addMultisig is not supported by this wallet');
    }
    const network = this.rpc.NETWORK || 'LTC';
    return p.addMultisig(m, pubkeys, network);
  }

  async checkIP(): Promise<{ ip: string; isVpn: boolean; countryCode: string }> {
    if (!window.myWallet) throw new Error('fetchUserIP not supported by this wallet');
    return window.myWallet!.sendRequest('fetchUserIP', {});
  }

  // ---- helpers -------------------------------------------------------------

  private async requestAnyAddress(): Promise<string> {
    const accs = await this.requestAccounts();
    if (!accs.length) throw new Error('No accounts available');
    return accs[0].address;
  }
}

// ---------------- utils: hex/base64 ----------------

function isHex(s: string): boolean {
  return typeof s === 'string' && /^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0;
}
function base64ToHex(b64: string): string {
  const bin = atob(b64);
  let out = '';
  for (let i = 0; i < bin.length; i++) out += bin.charCodeAt(i).toString(16).padStart(2, '0');
  return out;
}
function hexToBase64(hex: string): string {
  if (!isHex(hex)) return hex;
  const bytes = hex.match(/.{1,2}/g)!.map(h => parseInt(h, 16));
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin);
}
