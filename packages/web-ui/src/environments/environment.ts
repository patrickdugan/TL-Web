import { ENDPOINTS } from "./endpoints.conf";

export const environment = export const environment = {
  production: false,
  apiBase: '/api',       // where your BE routes are mounted
  algoDefaults: true,     // preload default algos if index is empty
  homeApiUrl: "http://localhost:1986",
  ENDPOINTS,
};

