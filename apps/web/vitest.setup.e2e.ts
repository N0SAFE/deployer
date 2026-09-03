import { existsSync, readFileSync } from "node:fs";
import { WEB_E2E_BASE_URL_FILE } from "./vitest.shared-web.e2e";

/**
 * Per-worker setup for the web e2e project.
 *
 * Reads the containerized production server's base URL from the temp file
 * written by globalSetup (env vars don't propagate to Bun fork workers) and
 * exports it for the specs.
 */
export function getWebE2eBaseUrl(): string {
  if (!existsSync(WEB_E2E_BASE_URL_FILE)) {
    throw new Error(
      `[web-e2e] base URL file not found at ${WEB_E2E_BASE_URL_FILE} — ` +
        "globalSetup did not run or the server failed to start.",
    );
  }
  return readFileSync(WEB_E2E_BASE_URL_FILE, "utf-8").trim();
}
