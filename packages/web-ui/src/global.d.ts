// src/global.d.ts
export {};

declare global {
  interface Window {
    phantom?: {
      bitcoin?: {
        isPhantom: true;
        request: (args: {
          method: string;
          params?: any;
        }) => Promise<any>;
        requestAccounts?: () => Promise<any>;
        on?: (ev: string, cb: (...a: any[]) => void) => void;
        off?: (ev: string, cb: (...a: any[]) => void) => void;
      };
    };
    tradelayer?: {
      providerId: 'tradelayer';
      isTradeLayer: true;
      version?: string;
      request: (args: {
        method: string;
        params?: any;
      }) => Promise<any>;
      on?: (ev: string, cb: (...a: any[]) => void) => void;
      off?: (ev: string, cb: (...a: any[]) => void) => void;
    };
  }
}
