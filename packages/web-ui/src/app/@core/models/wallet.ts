export type WalletKind = 'phantom-btc' | 'custom';

export interface IWalletProvider {
  kind: WalletKind;
  name: string;
  isAvailable(): boolean;
  connect(network: 'mainnet' | 'testnet'): Promise<void>;
  getAddresses(): Promise<string[]>;
  signMessage(address: string, message: string, opts?: { scheme?: 'bip322' | 'ecdsa' }): Promise<string>; // base64 or hex
  signPsbt(psbtBase64: string, opts?: { autoFinalize?: boolean; broadcast?: boolean }): Promise<string>; // base64
  on?(event: 'accountsChanged' | 'networkChanged', cb: (...a: any[]) => void): void;
}
