// src/app/@core/services/wallet.service.ts
import { Injectable } from '@angular/core';
import { BehaviorSubject } from 'rxjs';
import { RpcService } from './rpc.service';

type WalletKind = 'phantom-btc' | 'custom';

type PhantomBtc = {
  request: (args: { method: string; params?: any }) => Promise<any>;
  on?: (ev: string, cb: (...a: any[]) => void) => void;
};
const getPhantomBtc = (): PhantomBtc | undefined => window.phantom?.bitcoin as PhantomBtc | undefined;



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
  constructor(private rpc: RpcService) {}

  // Reactive state (handy if you bind in header/futures)
  public provider$  = new BehaviorSubject<IWalletProvider | null>(null);
  public addresses$ = new BehaviorSubject<string[]>([]);
  public address$   = new BehaviorSubject<string | null>(null);

  // ---- Providers ------------------------------------------------------------

  private phantomBtc: IWalletProvider = {
    kind: 'phantom-btc',
    name: 'Phantom (Bitcoin)',
  isAvailable: () => !!getPhantomBtc(),

  connect: async (net) => {
    const ph = getPhantomBtc();
    if (!ph) throw new Error('Phantom Bitcoin provider not available');
    await ph.request({ method: 'btc_connect', params: { network: net } });
  },

  getAddresses: async () => {
    const ph = getPhantomBtc();
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

    addMultisig: async (m, pubkeys, network) => {
      return await window.myWallet!.sendRequest('addMultisig', { m, pubkeys, network });
    },

    on: (ev, cb) => window.myWallet?.on?.(ev, cb),
  };

  // ---- Selection & connection ----------------------------------------------

  private available(): IWalletProvider[] {
    return [this.phantomBtc, this.customExt].filter(p => p.isAvailable());
  }

  private providerNet(): 'mainnet' | 'testnet' {
    // if you later add BTC testnet UI, toggle here
    return (this.rpc.NETWORK === 'LTCTEST') ? 'testnet' : 'mainnet';
  }

  private pick(): IWalletProvider | null {
    const options = this.available();
    const phantom = options.find(p => p.kind === 'phantom-btc');
    return phantom || options[0] || null;
  }

  /** For a dropdown UI */
  getDetectedProviders(): { primary: IWalletProvider | null; options: IWalletProvider[] } {
    const options = this.available();
    const primary = options.find(p => p.kind === 'phantom-btc') || options[0] || null;
    return { primary, options };
  }

  async connectPreferred(): Promise<void> {
    const p = this.pick();
    if (!p) throw new Error('No supported wallet found (Phantom or TL extension).');
    await this.finishConnect(p);
  }

  async useProvider(kind: WalletKind): Promise<void> {
    const p = this.available().find(x => x.kind === kind);
    if (!p) throw new Error(`Wallet provider ${kind} not available`);
    await this.finishConnect(p);
  }

  private async finishConnect(p: IWalletProvider) {
    const net = this.providerNet();
    await p.connect?.(net);

    this.provider$.next(p);

    const addrs = await p.getAddresses(net);
    this.addresses$.next(addrs);
    this.address$.next(addrs[0] ?? null);

    p.on?.('accountsChanged', (accs: string[]) => {
      this.addresses$.next(accs || []);
      this.address$.next(accs?.[0] ?? null);
    });

    p.on?.('networkChanged', () => {
      // hook if you want to react (e.g., reload)
    });
  }

  // ---- Public API (clean, de-duped) ----------------------------------------

  isWalletAvailable(): boolean {
    return this.available().length > 0;
  }

  async requestAccounts(network?: string): Promise<{ address: string; pubkey?: string }[]> {
    const p = this.provider$.value || this.pick();
    if (!p) throw new Error('Wallet extension not detected');

    const net = network
      ? (network.toLowerCase().includes('test') ? 'testnet' : 'mainnet')
      : this.providerNet();

    const addrs = await p.getAddresses(net);
    return addrs.map(a => ({ address: a, pubkey: undefined }));
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
