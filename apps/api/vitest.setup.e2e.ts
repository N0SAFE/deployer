import { execSync } from "node:child_process";
import "reflect-metadata";
import { afterAll, beforeEach, vi } from "vitest";
import { stopAllSharedApiRuntimes } from "./src/e2e/utils/shared-api-runtime";
import { SHARED_POSTGRES_CONNECTION_URI_ENV } from "./src/e2e/utils/shared-api-runtime/types";

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

// Disable vulnerability auto-scan during e2e tests by default.
// The DockerImageAutoScanListenerService spawns trivy/grype/dive containers for every image
// on startup, which is unnecessary for most e2e tests and leaves orphaned containers if
// the test process is aborted. Override this env var per-test when scanning is explicitly needed.
process.env.DISABLE_AUTO_SCAN = process.env.DISABLE_AUTO_SCAN ?? "true";

// Enable Docker safety-net cleanup by default: force-removes any deployer containers
// that survive the graceful runtime teardown (e.g., when app.close() hangs).
process.env.E2E_DOCKER_CLEANUP = process.env.E2E_DOCKER_CLEANUP ?? "true";

// Set shared runtime max concurrency (default 4). Must be set in the worker process because
// Bun may not propagate process.env modifications from vitest.config.mts to worker children.
process.env.E2E_SHARED_RUNTIME_MAX_CONCURRENCY =
  process.env.E2E_SHARED_RUNTIME_MAX_CONCURRENCY ?? String(4);

// Discover shared Postgres container: check env var first, then temp file written by
// globalSetup. This lets workers reuse a single Postgres container started by the
// main vitest process instead of each worker spinning up its own.
//
// Under Bun, process.env modifications from globalSetup may not propagate to forked
// workers, so the temp file provides a reliable fallback.
if (!process.env[SHARED_POSTGRES_CONNECTION_URI_ENV]) {
  const { readSharedPostgresUriFromFile } = await import("./vitest.shared-postgres.e2e");
  const uri = readSharedPostgresUriFromFile();
  if (uri) {
    process.env[SHARED_POSTGRES_CONNECTION_URI_ENV] = uri;
    logSetup(
      `read shared Postgres URI from temp file: ${uri.slice(0, 30)}...`,
    );
  } else {
    logSetup(
      `no shared Postgres URI found in temp file — worker will create its own container`,
    );
  }
} else {
  logSetup(
    `shared Postgres URI already set via env var: ${process.env[SHARED_POSTGRES_CONNECTION_URI_ENV]!.slice(0, 30)}...`,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  vi.restoreAllMocks();
});

/**
 * Forcefully remove any deployer containers that survived runtime cleanup.
 * This is a safety net for cases where the runtime manager's graceful stop
 * fails (e.g., NestJS app.close() hangs, process receives SIGTERM).
 */
function cleanupOrphanedDeployerContainers(): void {
  if (!isTruthyEnv(process.env.E2E_DOCKER_CLEANUP)) {
    return;
  }

  try {
    // Remove ALL deployer-* containers — catches Postgres containers, nginx
    // containers, scanner containers, and any other testcontainers orphans.
    const containerIds = execSync(
      `docker ps --filter "name=deployer" --format "{{.ID}}" 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 10_000 },
    )
      .split("\n")
      .map((id) => id.trim())
      .filter(Boolean);

    if (containerIds.length > 0) {
      logSetup(
        `cleanupOrphanedDeployerContainers: force-removing ${containerIds.length} orphaned container(s)`,
      );
      execSync(`docker rm -f ${containerIds.join(" ")} 2>/dev/null || true`, {
        timeout: 30_000,
      });
      logSetup(
        `cleanupOrphanedDeployerContainers: removed ${containerIds.length} container(s)`,
      );
    }
  } catch (error) {
    logSetup(
      `cleanupOrphanedDeployerContainers: failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

afterAll(async () => {
  logSetup("worker afterAll teardown start: stopAllSharedApiRuntimes");
  await stopAllSharedApiRuntimes();
  logSetup(`worker active handles after runtime cleanup: ${describeActiveHandles()}`);
  logSetup(`worker active requests after runtime cleanup: ${describeActiveRequests()}`);

  cleanupOrphanedDeployerContainers();

  // Clean up the shared Postgres URI temp file. This file was written by
  // globalSetup and read by workers to discover the shared container. Since
  // all workers are done and the container is already removed (either by the
  // cleanup above or by graceful runtime shutdown), the temp file is stale.
  // If multiple workers try to delete it, the second one gets ENOENT (ignored).
  const { deleteSharedPostgresUriFile } = await import("./vitest.shared-postgres.e2e");
  deleteSharedPostgresUriFile();

  logSetup("worker afterAll teardown complete: stopAllSharedApiRuntimes");
});
