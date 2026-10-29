import libraryConfig from "@deployer/config-eslint/library";
import { defineConfig } from "@deployer/config-eslint";

export default defineConfig([
  { ignores: ["eslint.config.ts", "scripts/**", "*.config.ts"] },
  {
    extends: [libraryConfig.configs.base()],
    files: ["**/*.{ts,tsx}"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "CallExpression[callee.object.name='oc'][callee.property.name='route']",
          message:
            "Direct `oc.route(...)` usage is forbidden. Use `route(...)` from `@deployer/orpc-utils/builder` (RouteBuilder fluent API) instead.",
        },
      ],
    },
  },
]);