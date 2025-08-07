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
    };
  }
}
