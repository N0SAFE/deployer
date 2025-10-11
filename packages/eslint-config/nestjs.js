const typescript = require("@typescript-eslint/eslint-plugin");
const typescriptParser = require("@typescript-eslint/parser");
const nestjsConfig = require("eslint-config-nestjs");

/** @type {import("eslint").Linter.Config} */
module.exports = {
  languageOptions: {
    parser: typescriptParser,
    parserOptions: {
      project: "./tsconfig.json",
      sourceType: "module",
    },
  },
  plugins: {
    "@typescript-eslint": typescript,
  },
  rules: {
    ...nestjsConfig.rules,
    "@typescript-eslint/interface-name-prefix": "off",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-unused-vars": ["warn", { argsIgnorePattern: "^_" }],
    "no-unused-vars": "off",
    "@typescript-eslint/consistent-type-imports": [
      "error",
      {
        prefer: "type-imports",
      },
    ],
    "no-restricted-imports": [
      "error",
      {
        patterns: [
          {
            group: ["./core/*", "./config/*", "./modules/*"],
            message:
              "Use path aliases instead of relative imports that traverse parent directories (../).",
          },
        ],
      },
    ],
  },
};
