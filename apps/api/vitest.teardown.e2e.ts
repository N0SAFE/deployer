import { stopAllSharedApiRuntimes } from "./src/e2e/utils/shared-api-runtime";
import { stopSharedPostgresContainer } from "./vitest.shared-postgres.e2e";

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

export default async function globalTeardown() {
  logGlobalTeardown("globalTeardown start: stopAllSharedApiRuntimes");
  await stopAllSharedApiRuntimes();
  logGlobalTeardown("globalTeardown complete: stopAllSharedApiRuntimes");

  logGlobalTeardown("globalTeardown start: stopSharedPostgresContainer");
  await stopSharedPostgresContainer();
  logGlobalTeardown("globalTeardown complete: stopSharedPostgresContainer");
}
