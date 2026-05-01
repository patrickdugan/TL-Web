import { ENDPOINTS } from "./endpoints.conf";
export const environment = {
  production: true,
  apiBase: '/api',       // or your deployed API URL
  algoDefaults: true,
  algoRunner: {
    enabled: true,
    origin: 'https://algo.layerwallet.com',
    path: '/host.html',
    handshakeTimeoutMs: 4000,
    requestTimeoutMs: 15000,
    allowLocalExecution: false,
  },
  homeApiUrl: "http://localhost:1986",
  ENDPOINTS,
};
