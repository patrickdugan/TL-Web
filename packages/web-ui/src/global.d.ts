// src/global.d.ts
export {};

declare global {
  interface Window {
    phantom?: {
      bitcoin?: {
        request: (args: {
          method: string;
          params?: any;
        }) => Promise<any>;
        on?: (ev: string, cb: (...a: any[]) => void) => void;
      };
    };
    myWallet?: {
      sendRequest: (method: string, params?: any) => Promise<any>;
      on?: (ev: string, cb: (...a: any[]) => void) => void;
      off?: (ev: string, cb: (...a: any[]) => void) => void;
    };
    tradelayer?: {
      providerId?: string;
      isTradeLayer?: boolean;
      request: (args: { method: string; params?: any }) => Promise<any>;
      connect?: (network?: string) => Promise<any>;
      requestAccounts?: (network?: string) => Promise<any>;
      requestAccountsForNetwork?: (network?: string) => Promise<any>;
      on?: (ev: string, cb: (...a: any[]) => void) => void;
      off?: (ev: string, cb: (...a: any[]) => void) => void;
    };
  }
}
