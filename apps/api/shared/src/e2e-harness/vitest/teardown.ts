import { execSync } from "node:child_process";

import { stopAllSharedApiRuntimes } from "../shared-api-runtime";

import { E2E_CONTAINER_LABEL, stopSharedPostgresContainer } from "./shared-postgres";

console.log("[e2e-teardown-load] vitest.teardown.e2e.ts module loaded");

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

function logGlobalTeardown(message: string): void {
  if (!isTruthyEnv(process.env.E2E_SHARED_RUNTIME_LOGS)) {
    return;
  }

  const now = new Date().toISOString();
  console.log(`[e2e-runtime-teardown ${now}] ${message}`);
}

/**
 * Forcefully remove any deployer containers that survived all cleanup attempts.
 * This is the ultimate safety net — it runs in the main vitest process after
 * all workers have completed, and uses the Docker CLI directly.
 */
function cleanupOrphanedDeployerContainers(): void {
  try {
    // Removal is by LABEL, not by name.
    //
    // ── WHY THE `name=deployer` FILTER IS GONE ──────────────────────────────
    // It did not match the containers this harness starts — those had random
    // Docker names (`relaxed_edison`), so a killed worker's Postgres was never
    // swept and twenty-one of them were still running on the reference machine.
    // What it DID match was the development stack's own database
    // (`deployer-postgres.1.ug83g3esp…`), so every e2e teardown deleted a
    // container the run never created. The label is set by
    // `startSharedPostgresContainer` and matches only harness containers.
    const containerIds = execSync(
      `docker ps --filter "label=${E2E_CONTAINER_LABEL}" --format "{{.ID}}" 2>/dev/null || true`,
      { encoding: "utf-8", timeout: 10_000 },
    )
      .split("\n")
      .map((id) => id.trim())
      .filter(Boolean);

    if (containerIds.length > 0) {
      logGlobalTeardown(
        `global Docker safety net: force-removing ${containerIds.length} orphaned container(s)`,
      );
      execSync(`docker rm -f ${containerIds.join(" ")} 2>/dev/null || true`, {
        timeout: 30_000,
      });
      logGlobalTeardown(
        `global Docker safety net: removed ${containerIds.length} container(s)`,
      );
    }
  } catch (error) {
    logGlobalTeardown(
      `global Docker safety net failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

export default async function globalTeardown() {
  console.log("[e2e-global-teardown] globalTeardown called");

  // Attempt graceful cleanup first — this runs in the main process and will
  // be a no-op if workers already cleaned up their own runtimes, but catches
  // any that were missed.
  logGlobalTeardown("globalTeardown start: stopAllSharedApiRuntimes");
  await stopAllSharedApiRuntimes();
  logGlobalTeardown("globalTeardown complete: stopAllSharedApiRuntimes");

  logGlobalTeardown("globalTeardown start: stopSharedPostgresContainer");
  await stopSharedPostgresContainer();
  logGlobalTeardown("globalTeardown complete: stopSharedPostgresContainer");

  // Docker safety net: remove any deployer containers that survived the
  // graceful cleanup (e.g., because worker processes crashed or handles hung).
  cleanupOrphanedDeployerContainers();
  console.log("[e2e-global-teardown] globalTeardown complete");
}
