export type TEndpoint = {
    [k: string]: {
        orderbookApiUrl: string,
        relayerUrl: string,
    } 
};

const ORDERBOOK_URL = "wss://ws.layerwallet.com/ws";
const RELAYER_URL = "https://ws.layerwallet.com/relayer";

export const ENDPOINTS: TEndpoint = {
    LTC: {
        orderbookApiUrl: ORDERBOOK_URL,
        relayerUrl: RELAYER_URL,
    },
    BTC: {
      orderbookApiUrl: ORDERBOOK_URL,
      relayerUrl: RELAYER_URL,
    },
    LTCTEST: {
        orderbookApiUrl: ORDERBOOK_URL,
        relayerUrl: RELAYER_URL,
    },
};
