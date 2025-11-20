// src/app/@core/services/wallet.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
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
    this.baseUrl = net.includes('TEST')
      ? 'https://testnet-api.layerwallet.com'
      : 'https://api.layerwallet.com';
  }

  public provider$ = new BehaviorSubject<IWalletProvider | null>(null);
  public addresses$ = new BehaviorSubject<string[]>([]);
  public address$ = new BehaviorSubject<string | null>(null);

  public baseUrl: string;

  public isWalletAvailable(): boolean {
    return this.available().length > 0;
  }

  // In-memory + persistent cache for multisig
  private multisigCache = new Map<string, MultisigRecord>();

  // -------------------------------------------------------------------------
  // Multisig helpers ---------------------------------------------------------
  // -------------------------------------------------------------------------

    async checkIP(): Promise<{ ip: string; isVpn: boolean; countryCode: string }> {
      /*if (this.activeWallet === 'custom') {
        return window.myWallet!.sendRequest("fetchUserIP", {});
      }*/

      // Phantom fallback: server-side check
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

  // -------------------------------------------------------------------------
  // Final unified addMultisig entrypoint (Option A + Option 1)
  // -------------------------------------------------------------------------

  /** Canonical multisig builder */
  async addMultisig(m: number, pubKeys: string[]): Promise<MultisigRecord> {
    const provider = this.provider$.value || this.pick();
    if (!provider) throw new Error('Wallet not connected');

    const key = this.msigKey(m, pubKeys);

    //
    // 1. Check in-memory cache
    //
    let cached = this.multisigCache.get(key);
    if (cached) return cached;

    //
    // 2. Check localStorage
    //
    const local = this.loadLocalMsig(key);
    if (local) {
      this.multisigCache.set(key, local);
      return local;
    }

    //
    // 3. Phantom: must compute via relayer first, then cache
    //
    if (provider.kind === 'phantom-btc') {
      const msRec = await this.fetchMsDataFromRelayer(m, pubKeys);
      this.saveLocalMsig(key, msRec);
      this.multisigCache.set(key, msRec);
      return msRec;
    }

    //
    // 4. Custom extension: use wallet RPC, then cache
    //
    if (provider.kind === 'custom' && provider.addMultisig) {
      const network = this.rpc.NETWORK || 'LTC';
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

  // -------------------------------------------------------------------------
  // Utils
  // -------------------------------------------------------------------------
}

//
// Hex/Base64 Utils
//

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
