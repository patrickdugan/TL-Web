// webpack.config.js
const path = require('path');

module.exports = {
  mode: 'production',
  target: 'webworker', // ensures no Node built-ins
  entry: './algoAPI.js',

  output: {
    filename: 'algoAPI.bundle.js',
    path: path.resolve(__dirname, '../'),
    library: {
      name: 'ApiWrapper', // will expose as self.ApiWrapper
      type: 'umd',        // <- crucial: UMD, not ESM
    },
    globalObject: 'self', // makes it work in Worker & Window
    clean: true,
  },

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

  experiments: {
    outputModule: false, // make absolutely sure it doesn't emit `import`
  },
};
