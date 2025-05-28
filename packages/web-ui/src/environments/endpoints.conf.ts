export type TEndpoint = {
    [k: string]: {
        orderbookApiUrl: string,
        relayerUrl: string,
    } 
};

export const ENDPOINTS: TEndpoint = {
    LTC: {
        orderbookApiUrl: "https://ws.layerwallet.com:443",
        relayerUrl: "https://api.layerwallet.com", // Use the masked HTTPS domain for production
    },
    LTCTEST: {
        orderbookApiUrl: "https://ws.layerwallet.com:443",
        relayerUrl: "https://testnet-api.layerwallet.com", // Use the masked HTTPS domain for production
    },
};
