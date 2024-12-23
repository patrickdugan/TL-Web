export {}; // Ensure the file is treated as a module

declare global {
  interface Window {
    myWallet?: {
      sendRequest: (method: string, params: any) => Promise<any>;
      on?: (event: string, callback: (...args: any[]) => void) => void;
    };
  }
}
