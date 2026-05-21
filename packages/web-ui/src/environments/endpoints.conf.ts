export type TEndpoint = {
    [k: string]: {
        orderbookApiUrl: string,
        relayerUrl: string,
    } 
};

export const ENDPOINTS: TEndpoint = {
    LTC: {
        orderbookApiUrl: "wss://api.layerwallet.com/ws",
        relayerUrl: "https://api.layerwallet.com/relayer",
    },
    BTC: {
      orderbookApiUrl: "wss://btc-api.layerwallet.com/ws",
      relayerUrl: "https://btc-api.layerwallet.com/relayer",
    },
    LTCTEST: {
        orderbookApiUrl: "wss://testnet-api.layerwallet.com/ws",
        relayerUrl: "https://testnet-api.layerwallet.com/relayer",
    },
};
