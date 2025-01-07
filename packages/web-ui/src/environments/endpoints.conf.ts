type TEnpoint = {
    [k: string]: {
        orderbookApiUrl: string,
        relayerUrl: string,
    } 
};

export const ENDPOINTS: TEnpoint = {
    LTC: {
        orderbookApiUrl: "https://ws.layerwallet.com", // Use wss for secure communication
        relayerUrl: "http://172.81.181.19:9191",   // Ensure the relayer URL uses https if applicable
    },
    LTCTEST: {
        orderbookApiUrl: "https://ws.layerwallet.com", // Use wss for secure communication
        relayerUrl: "http://172.81.181.19:8191",   // Ensure the relayer URL uses https if applicable
    },
};
