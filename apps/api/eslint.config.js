const eslintConfigNestjs = require("@repo/eslint-config/nestjs");

/** @type {import("eslint").Linter.Config[]} */
module.exports = [
  // Global ignores
  {
    files: ["src/**/*.ts", "src/**/*.js"],
    ignores: ["dist/**", "node_modules/**", "*.config.js", "*.config.ts"],
  },
  eslintConfigNestjs,
];
