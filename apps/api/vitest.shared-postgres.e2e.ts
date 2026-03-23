import { PostgreSqlContainer } from "@testcontainers/postgresql";
import { Wait } from "testcontainers";
import { SHARED_POSTGRES_CONNECTION_URI_ENV } from "./src/e2e/utils/shared-api-runtime/types";

let sharedPostgresContainer: PostgreSqlContainer | null = null;

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

function logSharedPostgres(message: string): void {
  if (!isTruthyEnv(process.env.E2E_SHARED_RUNTIME_LOGS)) {
    return;
  }

  const now = new Date().toISOString();
  console.log(`[e2e-runtime-global ${now}] ${message}`);
}

function summarizeDbUrl(connectionUri: string): string {
  const parsed = new URL(connectionUri);
  return `${parsed.protocol}//${parsed.hostname}:${parsed.port}${parsed.pathname}`;
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

export async function startSharedPostgresContainer(): Promise<void> {
  if (sharedPostgresContainer) {
    process.env[SHARED_POSTGRES_CONNECTION_URI_ENV] =
      sharedPostgresContainer.getConnectionUri();
    return;
  }

  logSharedPostgres("globalSetup start: starting shared Postgres container");

  sharedPostgresContainer = await new PostgreSqlContainer("postgres:16-alpine")
    .withDatabase("deployer_e2e")
    .withUsername("deployer")
    .withPassword("deployer")
    .withWaitStrategy(
      Wait.forLogMessage("database system is ready to accept connections"),
    )
    .withStartupTimeout(180_000)
    .start();

  process.env[SHARED_POSTGRES_CONNECTION_URI_ENV] =
    sharedPostgresContainer.getConnectionUri();

  logSharedPostgres(
    `globalSetup ready: shared Postgres URI set (${summarizeDbUrl(sharedPostgresContainer.getConnectionUri())})`,
  );
}

export async function stopSharedPostgresContainer(): Promise<void> {
  if (!sharedPostgresContainer) {
    return;
  }

  logSharedPostgres("globalTeardown start: stopping shared Postgres container");
  logSharedPostgres(`globalTeardown pre-stop handles: ${describeActiveHandles()}`);
  logSharedPostgres(`globalTeardown pre-stop requests: ${describeActiveRequests()}`);

  await sharedPostgresContainer.stop().catch(() => undefined);
  sharedPostgresContainer = null;
  delete process.env[SHARED_POSTGRES_CONNECTION_URI_ENV];

  logSharedPostgres(`globalTeardown post-stop handles: ${describeActiveHandles()}`);
  logSharedPostgres(`globalTeardown post-stop requests: ${describeActiveRequests()}`);
  logSharedPostgres("globalTeardown complete: shared Postgres container stopped");
}