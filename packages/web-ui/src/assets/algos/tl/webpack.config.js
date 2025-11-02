const path = require('path');

module.exports = {
  entry: './algoAPI.js',
  output: {
    filename: 'algoAPI.bundle.js',
    path: path.resolve(__dirname, './'),
    library: 'ApiWrapper',          // exported global name
    libraryTarget: 'umd',           // forces webpackUniversalModuleDefinition wrapper
    globalObject: 'self',           // works in workers + window
    umdNamedDefine: true,           // ensure AMD name matches
  },
  mode: 'production',
  devtool: false,
  target: 'webworker',
  experiments: {
    outputModule: false,            // prevents ESM stub
  },
  module: {
    rules: [
      {
        test: /\.m?js$/,
        exclude: /(node_modules)/,
        use: {
          loader: 'babel-loader',
          options: {
            presets: ['@babel/preset-env'],
          },
        },
      },
    ],
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
};
