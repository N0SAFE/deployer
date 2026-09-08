/**
 * Custom ESM loader to intercept `bun:sqlite` imports under Node.js runtime.
 *
 * The VS Code vitest extension spawns vitest under Node.js (not Bun), and
 * Node's default ESM loader rejects the `bun:` protocol before Vite's plugin
 * system can intercept it. This loader is registered via `--import` so it
 * runs before any module resolution happens.
 *
 * Usage: node --import ./vitest-shims/bun-sqlite-loader.mjs vitest.mjs ...
 */

import { pathToFileURL } from "node:url";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { register } from "node:module";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SHIM_PATH = resolve(__dirname, "bun-sqlite.ts");

register(pathToFileURL(SHIM_PATH).href, import.meta.url);

// Also register a data: URL handler for the bun: protocol
// This allows the shim to be loaded when the import is resolved
const dataLoader = `
  export function resolve(specifier, context, nextResolve) {
    if (specifier === 'bun:sqlite') {
      return nextResolve('file://${SHIM_PATH}', context);
    }
    return nextResolve(specifier, context);
  }
`;

register(`data:text/javascript,${encodeURIComponent(dataLoader)}`, import.meta.url);
