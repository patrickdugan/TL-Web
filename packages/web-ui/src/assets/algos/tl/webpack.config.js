// webpack.config.js
const path = require('path');

module.exports = {
  entry: './algoAPI.js',
  output: {
    filename: 'algoAPI.bundle.js',
    path: path.resolve(__dirname, './'),
    library: {
      name: 'ApiWrapper',       // exposed as self.ApiWrapper
      type: 'umd',              // <-- allows import() and <script> usage
    },
    globalObject: 'self',       // <-- ensures it works in worker or window
  },
  target: 'webworker',          // builds for browser/worker environment
  mode: 'production',
  resolve: {
    fallback: {
      fs: false,
      path: false,
      net: false,
      tls: false,
      http: require.resolve('stream-http'),
      https: require.resolve('https-browserify'),
      crypto: require.resolve('crypto-browserify'),
      stream: require.resolve('stream-browserify'),
    },
  },
};