declare global {
  interface Window {
    myWallet?: {
      sendRequest: (method: string, params: any) => Promise<any>;
    };
  }
}

// Ensure this file is treated as a module by adding an empty export
export {};
