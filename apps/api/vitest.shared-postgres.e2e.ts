import { readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import Dockerode from "dockerode";
import { Pool } from "pg";
import { SHARED_POSTGRES_CONNECTION_URI_ENV } from "./src/e2e/utils/shared-api-runtime/types";

/**
 * Temp file path used to pass the shared Postgres connection URI from globalSetup
 * (main vitest process) to worker processes. This is needed because under Bun,
 * process.env modifications in globalSetup may not propagate to fork workers.
 * The file is written by startSharedPostgresContainer() and consumed by
 * readSharedPostgresUriFromFile() in vitest.setup.e2e.ts.
 */
export const SHARED_POSTGRES_URI_FILE = resolve(tmpdir(), "deployer-e2e-shared-postgres-uri.txt");

const POSTGRES_IMAGE = "postgres:16-alpine";

interface SharedPostgresContainer {
  container: Dockerode.Container;
  connectionUri: string;
  docker: Dockerode;
}

let sharedPostgresContainer: SharedPostgresContainer | null = null;

/**
 * Close the docker client's keep-alive sockets so vitest can exit cleanly.
 * dockerode v5 removed modem.close(); guard instead of pinning the version.
 */
function closeDockerClient(docker: Dockerode): void {
  const modem = docker.modem as unknown as { close?: () => void };
  modem.close?.();
}

async function waitForPostgresReady(connectionUri: string): Promise<void> {
  const deadline = Date.now() + 180_000;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    const pool = new Pool({ connectionString: connectionUri, max: 1 });
    try {
      await pool.query("SELECT 1");
      return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      await new Promise((resolve) => setTimeout(resolve, 500));
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  throw new Error(
    `Postgres container not ready in time: ${lastError?.message ?? "unknown"}`,
  );
}

async function pullPostgresImage(docker: Dockerode): Promise<void> {
  // Check if image is already available locally
  const images = await docker.listImages();
  const hasImage = images.some((img) =>
    img.RepoTags?.some((tag) => tag === POSTGRES_IMAGE),
  );
  if (hasImage) return;

  logSharedPostgres(`pulling Postgres image: ${POSTGRES_IMAGE}`);
  await new Promise<void>((resolve, reject) => {
    docker.pull(POSTGRES_IMAGE, (error: Error | null, stream?: NodeJS.ReadableStream) => {
      if (error) {
        reject(error);
        return;
      }
      if (!stream) {
        reject(new Error("No stream returned from docker.pull"));
        return;
      }
      docker.modem.followProgress(stream, (err: Error | null) => {
        if (err) reject(err);
        else resolve();
      });
    });
  });
  logSharedPostgres(`Postgres image pulled: ${POSTGRES_IMAGE}`);
}

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

/**
 * Write the shared Postgres connection URI to a temp file so worker processes
 * can discover it even if process.env modifications don't propagate across
 * vitest's fork boundary under Bun.
 */
export function writeSharedPostgresUriToFile(uri: string): void {
  try {
    writeFileSync(SHARED_POSTGRES_URI_FILE, uri, { encoding: "utf-8", mode: 0o644 });
    logSharedPostgres(`wrote shared Postgres URI to ${SHARED_POSTGRES_URI_FILE}`);
  } catch (error) {
    logSharedPostgres(
      `failed to write shared Postgres URI file: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/**
 * Read the shared Postgres connection URI from the temp file written by
 * startSharedPostgresContainer(). Returns null if the file does not exist
 * or cannot be read.
 */
export function readSharedPostgresUriFromFile(): string | null {
  try {
    return readFileSync(SHARED_POSTGRES_URI_FILE, { encoding: "utf-8" }).trim();
  } catch {
    return null;
  }
}

/**
 * Remove the temp file written by startSharedPostgresContainer().
 * Called during globalTeardown.
 */
export function deleteSharedPostgresUriFile(): void {
  try {
    unlinkSync(SHARED_POSTGRES_URI_FILE);
    logSharedPostgres(`deleted shared Postgres URI file: ${SHARED_POSTGRES_URI_FILE}`);
  } catch (error) {
    // File may already be deleted — ignore
    if (
      error &&
      typeof error === "object" &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code !== "ENOENT"
    ) {
      logSharedPostgres(
        `failed to delete shared Postgres URI file: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
}

/**
 * Get the shared Postgres connection URI, checking the env var first and
 * falling back to the temp file. This is the primary entry point for workers
 * to discover the shared container.
 */
export function resolveSharedPostgresUri(): string | null {
  const fromEnv = process.env[SHARED_POSTGRES_CONNECTION_URI_ENV];
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }

  return readSharedPostgresUriFromFile();
}

export async function startSharedPostgresContainer(): Promise<void> {
  if (sharedPostgresContainer) {
    process.env[SHARED_POSTGRES_CONNECTION_URI_ENV] =
      sharedPostgresContainer.connectionUri;
    writeSharedPostgresUriToFile(sharedPostgresContainer.connectionUri);
    return;
  }

  logSharedPostgres("globalSetup start: starting shared Postgres container");

  const docker = new Dockerode();

  // Ensure image is available
  await pullPostgresImage(docker);

  const container = await docker.createContainer({
    Image: POSTGRES_IMAGE,
    Env: [
      "POSTGRES_DB=deployer_e2e",
      "POSTGRES_USER=deployer",
      "POSTGRES_PASSWORD=deployer",
    ],
    HostConfig: {
      PublishAllPorts: true,
      AutoRemove: true,
    },
    Cmd: [
      "postgres",
      "-c", "listen_addresses=*",
      "-c", "max_connections=300",
      "-c", "superuser_reserved_connections=10",
    ],
  });

  await container.start();

  // Wait for container to be ready by polling PostgreSQL
  const data = await container.inspect();
  const hostPort = data.NetworkSettings.Ports?.["5432/tcp"]?.[0]?.HostPort;
  if (!hostPort) {
    await container.stop({ t: 5 }).catch(() => undefined);
    await container.remove({ force: true }).catch(() => undefined);
    closeDockerClient(docker);
    throw new Error("Could not determine Postgres container host port");
  }

  const connectionUri = `postgres://deployer:deployer@localhost:${hostPort}/deployer_e2e`;

  // Wait for Postgres to accept connections
  await waitForPostgresReady(connectionUri);

  sharedPostgresContainer = { container, connectionUri, docker };

  process.env[SHARED_POSTGRES_CONNECTION_URI_ENV] = connectionUri;
  writeSharedPostgresUriToFile(connectionUri);

  logSharedPostgres(
    `globalSetup ready: shared Postgres URI set (127.0.0.1:${hostPort}/deployer_e2e)`,
  );
}

export async function stopSharedPostgresContainer(): Promise<void> {
  deleteSharedPostgresUriFile();

  if (!sharedPostgresContainer) {
    return;
  }

  const { container, docker } = sharedPostgresContainer;

  logSharedPostgres("globalTeardown start: stopping shared Postgres container");
  logSharedPostgres(`globalTeardown pre-stop handles: ${describeActiveHandles()}`);
  logSharedPostgres(`globalTeardown pre-stop requests: ${describeActiveRequests()}`);

  // Stop and remove the container
  await container.stop({ t: 10 }).catch(() => undefined);
  await container.remove({ force: true }).catch(() => undefined);

  sharedPostgresContainer = null;
  delete process.env[SHARED_POSTGRES_CONNECTION_URI_ENV];

  // Cleanly disconnect the Docker client to prevent hanging handles
  closeDockerClient(docker);

  logSharedPostgres(`globalTeardown post-stop handles: ${describeActiveHandles()}`);
  logSharedPostgres(`globalTeardown post-stop requests: ${describeActiveRequests()}`);
  logSharedPostgres("globalTeardown complete: shared Postgres container stopped");
}