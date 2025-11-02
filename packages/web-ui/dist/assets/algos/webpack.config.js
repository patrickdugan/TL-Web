// webpack.config.js
const path = require('path');

module.exports = {
  entry: './algoAPI.js',             // your current main file
  output: {
    filename: 'algoAPI.bundle.js',   // output bundle name
    path: path.resolve(__dirname, '../'), // write one folder up: /assets/algos/
    library: 'ApiWrapper',           // will become self.ApiWrapper
    libraryTarget: 'self',           // exposes it in the WebWorker global
  },
  target: 'webworker',               // so no Node built-ins are assumed
  mode: 'production',
  resolve: {
    fallback: {
      fs: false,
      path: false,
      net: false,
      tls: false,
    },
  },
};
