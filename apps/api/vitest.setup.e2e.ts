import "reflect-metadata";
import { afterAll, beforeEach, vi } from "vitest";

function isTruthyEnv(value: string | undefined): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  return (
    normalized === "1" ||
    normalized === "true" ||
    normalized === "yes" ||
    normalized === "on"
  );
}

function logSetup(message: string): void {
  if (!isTruthyEnv(process.env.E2E_SHARED_RUNTIME_LOGS)) {
    return;
  }

  const now = new Date().toISOString();
  console.log(`[e2e-runtime-setup ${now}] ${message}`);
}

function describeActiveHandles(): string {
  const handles =
    (
      process as typeof process & {
        _getActiveHandles?: () => unknown[];
      }
    )._getActiveHandles?.() ?? [];

  if (handles.length === 0) {
    return "none";
  }

  return handles
    .map((handle) => {
      const typed = handle as {
        constructor?: { name?: string };
        hasRef?: () => boolean;
      };
      const name = typed.constructor?.name ?? "unknown";
      const ref = typeof typed.hasRef === "function" ? ` ref=${String(typed.hasRef())}` : "";
      return `${name}${ref}`;
    })
    .join(", ");
}

function describeActiveRequests(): string {
  const requests =
    (
      process as typeof process & {
        _getActiveRequests?: () => unknown[];
      }
    )._getActiveRequests?.() ?? [];

  if (requests.length === 0) {
    return "none";
  }

  return requests
    .map((request) => {
      const typed = request as { constructor?: { name?: string } };
      return typed.constructor?.name ?? "unknown";
    })
    .join(", ");
}

process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-auth-secret-key-for-testing-only";
process.env.BETTER_AUTH_SECRET = process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET;
process.env.NEXT_PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
process.env.API_PORT = process.env.API_PORT ?? "3001";
process.env.NEXT_PUBLIC_APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";
process.env.DEFAULT_ADMIN_EMAIL = process.env.DEFAULT_ADMIN_EMAIL ?? "admin@test.com";
process.env.DEFAULT_ADMIN_PASSWORD = process.env.DEFAULT_ADMIN_PASSWORD ?? "testpassword";
process.env.NODE_LOCAL_DB_PATH = process.env.NODE_LOCAL_DB_PATH ?? "/tmp/deployer-api-e2e-local.db";

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

afterAll(async () => {
  logSetup("worker afterAll teardown start: stopAllSharedApiRuntimes");
  const { stopAllSharedApiRuntimes } = await import(
    "./src/e2e/utils/shared-api-runtime"
  );
  await stopAllSharedApiRuntimes();
  logSetup(`worker active handles after runtime cleanup: ${describeActiveHandles()}`);
  logSetup(`worker active requests after runtime cleanup: ${describeActiveRequests()}`);
  logSetup("worker afterAll teardown complete: stopAllSharedApiRuntimes");
});
