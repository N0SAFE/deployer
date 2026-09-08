import { existsSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { tmpdir } from "node:os";
import Dockerode from "dockerode";

/**
 * Shared web-app test container for the Vitest e2e project.
 *
 * Same pattern as vitest.shared-postgres.e2e.ts in apps/api: globalSetup
 * starts ONE container via dockerode with a fully controlled environment,
 * polls it until ready, and publishes its base URL through a temp file
 * (process.env does not reliably propagate to forked workers under Bun).
 *
 * The container runs the PRODUCTION build produced by `bun --bun run build`
 * (the package.json `test:e2e` script chains it before the tests):
 *
 *   - Image:    oven/bun:1.4.2 (Debian/glibc — same bun version as the repo's
 *               Dockerfiles; glibc so host-built native binaries stay loadable)
 *   - Mount:    the whole monorepo, read-only, at /app (hoisted node_modules
 *               symlinks resolve identically inside the container)
 *   - Workdir:  /app/apps/web
 *   - Command:  `bun node_modules/next/dist/bin/next start --port 3000`
 *   - User:     host UID/GID so any runtime writes (.next/cache) land as the
 *               invoking user instead of root
 */

export const WEB_E2E_BASE_URL_FILE = resolve(
  tmpdir(),
  "deployer-e2e-web-base-url.txt",
);

const WEB_E2E_IMAGE = "oven/bun:1.4.2";
const CONTAINER_PORT = "3000";
/**
 * Preferred host port — only used when free. Like apps/api's shared Postgres
 * (PublishAllPorts), we fall back to a random free host port so parallel or
 * crashed-and-orphaned runs can never block a new one.
 */
const PREFERRED_HOST_PORT = Number.parseInt(
  process.env.WEB_E2E_PORT ?? "3300",
  10,
);

interface SharedWebContainer {
  container: Dockerode.Container;
  baseUrl: string;
  docker: Dockerode;
}

let sharedWebContainer: SharedWebContainer | null = null;

function logWeb(message: string): void {
  const now = new Date().toISOString();
  console.log(`[web-e2e ${now}] ${message}`);
}

async function pullWebImage(docker: Dockerode): Promise<void> {
  const images = await docker.listImages();
  const hasImage = images.some((img) =>
    img.RepoTags?.some((tag) => tag === WEB_E2E_IMAGE),
  );
  if (hasImage) return;

  logWeb(`pulling image: ${WEB_E2E_IMAGE}`);
  await new Promise<void>((resolvePull, reject) => {
    docker.pull(WEB_E2E_IMAGE, (error: Error | null, stream?: NodeJS.ReadableStream) => {
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
        else resolvePull();
      });
    });
  });
  logWeb(`image pulled: ${WEB_E2E_IMAGE}`);
}

/**
 * Environment for the containerized server. Every value is overridable from
 * the invoking shell so a run can point at a specific API instance.
 */
function buildServerEnv(appUrl: string): string[] {
  const defaults: Record<string, string> = {
    NODE_ENV: "production",
    NEXT_TELEMETRY_DISABLED: "1",
    BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? "web-e2e-secret",
    AUTH_SECRET: process.env.AUTH_SECRET ?? "web-e2e-secret",
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3005",
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL ?? appUrl,
    API_URL: process.env.API_URL ?? "http://localhost:3001",
    PORT: CONTAINER_PORT,
  };
  return Object.entries(defaults).map(([key, value]) => `${key}=${value}`);
}

/**
 * Remove any orphaned e2e web containers from a previous crashed run.
 * AutoRemove cleans up on normal stops, but a SIGKILLed daemon leaves them
 * behind holding resources. Label-scoped, so it can never touch anything else.
 */
async function cleanupOrphans(docker: Dockerode): Promise<void> {
  const orphans = await docker.listContainers({
    all: true,
    filters: { label: ["deployer.e2e=web"] },
  });
  for (const info of orphans) {
    logWeb(`removing orphaned container ${info.Id.slice(0, 12)}`);
    const container = docker.getContainer(info.Id);
    await container.stop({ t: 5 }).catch(() => undefined);
    await container.remove({ force: true }).catch(() => undefined);
  }
}

export function writeBaseUrlToFile(baseUrl: string): void {
  writeFileSync(WEB_E2E_BASE_URL_FILE, baseUrl, { encoding: "utf-8" });
}

export function deleteBaseUrlFile(): void {
  try {
    rmSync(WEB_E2E_BASE_URL_FILE, { force: true });
  } catch {
    // already gone — fine
  }
}

async function waitForServerReady(baseUrl: string): Promise<void> {
  const deadline = Date.now() + 60_000;
  let lastError: Error | null = null;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseUrl}/`, { redirect: "manual" });
      if (res.status > 0) return;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
    await new Promise((r) => setTimeout(r, 300));
  }

  throw new Error(
    `web container not ready in time on ${baseUrl}: ${lastError?.message ?? "unknown"}`,
  );
}

export async function startSharedWebContainer(): Promise<string> {
  if (sharedWebContainer) {
    writeBaseUrlToFile(sharedWebContainer.baseUrl);
    return sharedWebContainer.baseUrl;
  }

  const cwd = resolve(import.meta.dirname ?? ".");
  const buildIdPath = resolve(cwd, ".next/BUILD_ID");
  if (!existsSync(buildIdPath)) {
    throw new Error(
      `[web-e2e] No production build found at ${buildIdPath}.\n` +
        "Run the build first — e.g. `bun --bun run build && bun --bun run test:e2e` " +
        "(the package.json `test:e2e` script already chains both).",
    );
  }

  // Repo root is two levels up from apps/web.
  const repoRoot = resolve(cwd, "../..");

  logWeb("globalSetup start: starting shared web container");
  const docker = new Dockerode();

  await cleanupOrphans(docker);
  await pullWebImage(docker);

  const container = await docker.createContainer({
    Image: WEB_E2E_IMAGE,
    Env: buildServerEnv(`http://localhost:${PREFERRED_HOST_PORT}`),
    Labels: { "deployer.e2e": "web" },
    // The base image declares no EXPOSE — without this, PublishAllPorts
    // publishes nothing.
    ExposedPorts: { [`${CONTAINER_PORT}/tcp`]: {} },
    HostConfig: {
      // Repo read-only; apps/web writable so `next start` can write its
      // compiled config and .next/cache at runtime (runs as host UID, so
      // writes land as the invoking user).
      Binds: [`${repoRoot}:/app:ro`, `${cwd}:/app/apps/web`],
      // Random free host port — no conflicts with orphans/parallel runs
      // (same approach as apps/api's shared Postgres container).
      PublishAllPorts: true,
      AutoRemove: true,
    },
    WorkingDir: "/app/apps/web",
    User: `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
    Cmd: [
      "bun",
      "node_modules/next/dist/bin/next",
      "start",
      "--port",
      CONTAINER_PORT,
    ],
  });

  await container.start();

  // Discover the allocated host port.
  const data = await container.inspect();
  const hostPort =
    data.NetworkSettings.Ports?.[`${CONTAINER_PORT}/tcp`]?.[0]?.HostPort;
  if (!hostPort) {
    logWeb(`inspect Ports: ${JSON.stringify(data.NetworkSettings.Ports)}`);
    await container.stop({ t: 5 }).catch(() => undefined);
    closeDockerClient(docker);
    throw new Error("Could not determine web container host port");
  }

  const baseUrl = `http://localhost:${hostPort}`;
  logWeb(`container started, waiting for server at ${baseUrl}`);
  await waitForServerReady(baseUrl);

  sharedWebContainer = { container, baseUrl, docker };
  writeBaseUrlToFile(baseUrl);

  logWeb(`globalSetup ready: web server at ${baseUrl}`);
  return baseUrl;
}

export async function stopSharedWebContainer(): Promise<void> {
  deleteBaseUrlFile();

  if (!sharedWebContainer) return;

  const { container, docker } = sharedWebContainer;
  logWeb("globalTeardown start: stopping shared web container");

  await container.stop({ t: 10 }).catch(() => undefined);
  await container.remove({ force: true }).catch(() => undefined);

  sharedWebContainer = null;
  closeDockerClient(docker);

  logWeb("globalTeardown complete: shared web container stopped");
}

/**
 * Close the docker client's keep-alive sockets so vitest can exit cleanly.
 * dockerode v5 removed modem.close(); guard instead of pinning the version.
 */
function closeDockerClient(docker: Dockerode): void {
  const modem = docker.modem as unknown as { close?: () => void };
  modem.close?.();
}
