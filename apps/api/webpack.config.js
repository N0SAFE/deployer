const ESLintPlugin = require("eslint-webpack-plugin");
const nodeExternals = require("webpack-node-externals");
const { RunScriptWebpackPlugin } = require("run-script-webpack-plugin");
const CopyWebpackPlugin = require("copy-webpack-plugin");
const path = require("path");

module.exports = function (options, webpack) {
  return {
    ...options,
    watchOptions: {
      ...options.watchOptions,
      ignored: /node_modules/,
      aggregateTimeout: 300,
      poll: false,
    },
    cache: {
      ...options.cache,
      type: "filesystem",
      buildDependencies: {
        config: [__filename],
      },
    },
    entry: ["webpack/hot/poll?100", options.entry],
    externals: [
      nodeExternals({
        allowlist: ["webpack/hot/poll?100"],
      }),
    ],
    plugins: [
      ...options.plugins,
      new ESLintPlugin({
        extensions: ["ts"],
        failOnError: true, // ❗ Fait échouer le build si erreur ESLint
        failOnWarning: false,
        emitError: true,
        emitWarning: true,
        exclude: [
          "node_modules",
          "dist",
          "test",
          "**/*.test.ts",
          "**/*.spec.ts",
        ],
      }),
      new webpack.HotModuleReplacementPlugin(),
      new webpack.WatchIgnorePlugin({
        paths: [/\.js$/, /\.d\.ts$/],
      }),
      new RunScriptWebpackPlugin({
        name: options.output.filename,
        autoRestart: false, // Disable auto-restart, let HMR handle it
      }),
      // Copy nestjs-flub mustache templates to dist
      new CopyWebpackPlugin({
        patterns: [
          {
            from: path.resolve(
              __dirname,
              "../../node_modules/nestjs-flub/dist/themes"
            ),
            to: path.resolve(__dirname, "dist/themes"),
            noErrorOnMissing: true,
          },
        ],
      }),
    ],
    devtool: "eval-cheap-module-source-map",
  };
};
