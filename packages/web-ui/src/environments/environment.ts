import { ENDPOINTS } from "./endpoints.conf";

export const environment = {
  production: false,
  apiBase: '/api',       // where your BE routes are mounted
  algoDefaults: true,     // preload default algos if index is empty
  algoRunner: {
    enabled: false,
    origin: '',
    path: '/assets/algo-runner/host.html',
    handshakeTimeoutMs: 4000,
    requestTimeoutMs: 15000,
    allowLocalExecution: true,
  },
  homeApiUrl: "http://localhost:1986",
  ENDPOINTS,
};

