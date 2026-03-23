import nextjsConfig from "@repo/config-eslint/nextjs";
import { defineConfig } from "@repo/config-eslint";

export default defineConfig([
  {
    extends: [nextjsConfig.configs.base()],
    files: ["src/**/*.{ts,tsx,js,jsx}"],
    ignores: ["**/node_modules/**", "**/.next/**"],
  },
]);
