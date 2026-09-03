import { Injectable, type OnModuleDestroy, Logger } from "@nestjs/common";
import { EnvService } from "@/config/env/env.service";
import { DockerService } from "./docker.service";
import { AppError } from "@repo/errors";
import { isRecord, isObjectLike } from "@repo/type-guards"
import fs from "node:fs";
import path from "node:path";

// ============================================================================
// Types
// ============================================================================



export type ScannerType = "trivy" | "grype" | "dive";

export interface ScannerExecResult {
  exitCode: number;
  output: string;
  durationMs: number;
}

// ============================================================================
// Per-scanner container metadata
// ============================================================================

interface ScannerContainerState {
  /** Docker container ID once running. */
  containerId: string | null;
  /** Timestamp of the last command executed (epoch ms). */
  lastActivityAt: number;
  /** Timer handle for the app-level idle shutdown. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** In-flight start promise to serialise concurrent ensure calls. */
  startLock: Promise<boolean> | null;
}

const SCANNER_META: Record<ScannerType, { containerName: string }> = {
  trivy: { containerName: "deployer-scanner-trivy" },
  grype: { containerName: "deployer-scanner-grype" },
  dive:  { containerName: "deployer-scanner-dive" },
};

const SCANNER_TYPES: ScannerType[] = ["trivy", "grype", "dive"];

// ============================================================================
// Constants (env-overridable via getter methods below)
// ============================================================================

/** How long to wait for a container to become responsive after start (ms). */
const CONTAINER_READY_TIMEOUT_MS = 15_000;

/** Interval between readiness checks (ms). */
const CONTAINER_READY_POLL_MS = 500;

/** App-level idle timeout: 10 minutes without activity → container is stopped. */
const DEFAULT_APP_IDLE_TIMEOUT_MS = 10 * 60 * 1_000;

/** Image cleanup threshold: 10 days without activity → cached images are pruned. */
const IMAGE_CLEANUP_THRESHOLD_MS = 10 * 24 * 60 * 60 * 1_000;

/** Check interval for image pruning (once per hour). */
const IMAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1_000;

/** Default scanner-runner image tag. */
const DEFAULT_SCANNER_RUNNER_IMAGE = "deployer-scanner-runner:latest";

// ============================================================================
// Service
// ============================================================================

@Injectable()
export class ScannerContainerManagerService implements OnModuleDestroy {
  private readonly logger = new Logger(ScannerContainerManagerService.name);

  /** Per-scanner state (indexed by scanner type). */
  private readonly scanners: Record<ScannerType, ScannerContainerState> = {
    trivy: { containerId: null, lastActivityAt: 0, idleTimer: null, startLock: null },
    grype: { containerId: null, lastActivityAt: 0, idleTimer: null, startLock: null },
    dive:  { containerId: null, lastActivityAt: 0, idleTimer: null, startLock: null },
  };

  /** Global image-cleanup interval handle. */
  private imageCleanupTimer: ReturnType<typeof setInterval> | null = null;

  /**
   * One build attempt per process lifetime, keyed by image tag.
   * The promise resolves once the build finished (true) or failed (false);
   * failed builds are NOT retried — a later local `inspect` still succeeds
   * if the operator builds the image manually in the meantime.
   */
  private readonly imageBuildAttempts = new Map<string, Promise<boolean>>();

  /** Tags for which the "image unavailable" warning was already emitted. */
  private readonly imageUnavailableWarned = new Set<string>();

  constructor(
    private readonly dockerService: DockerService,
    private readonly envService: EnvService,
  ) {}

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /**
   * Ensure the shared container for a given scanner type is running.
   * Creates it on first invocation; subsequent calls are no-ops if alive.
   *
   * The Docker socket bind mount is sourced from `DockerService.getDockerSocketBindMount()`
   * rather than being hardcoded, so it respects whatever socket path the
   * platform is actually using.
   *
   * Returns `true` if the container is ready, `false` if scanning is
   * disabled or the container could not be started.
   */
  async ensureContainerRunning(scanner: ScannerType): Promise<boolean> {
    if (this.isAutoScanDisabled()) {
      this.logger.debug(`Auto-scan is disabled — not starting ${scanner} container`);
      return false;
    }

    const state = this.scanners[scanner];
    if (state.containerId) {
      const alive = await this.isContainerAlive(state.containerId);
      if (alive) {
        return true;
      }
      this.logger.warn(`${scanner} container is no longer running — will recreate`);
      state.containerId = null;
    }

    // Serialise concurrent start requests
    if (state.startLock) {
      return state.startLock;
    }

    state.startLock = this.startContainer(scanner).finally(() => {
      state.startLock = null;
    });

    return state.startLock;
  }

  /**
   * Execute a scanner command inside the shared container for the given type.
   * Call `ensureContainerRunning(scanner)` first; if it returns `false`, do not
   * call this method.
   *
   * @param scanner - Which scanner container to run in.
   * @param cmd - The command + arguments (e.g. `["trivy", "image", "--quiet", …]`).
   */
  async execInScanner(scanner: ScannerType, cmd: string[]): Promise<ScannerExecResult> {
    const state = this.scanners[scanner];
    if (!state.containerId) {
      throw new AppError(
        `${scanner} shared container is not running — call ensureContainerRunning("${scanner}") first`,
        "INTERNAL_ERROR",
      );
    }

    const startedAt = Date.now();
    this.trackActivity(scanner);

    const result = await this.dockerService.execInContainerCapture(state.containerId, cmd);

    return {
      exitCode: result.exitCode,
      output: result.output,
      durationMs: Date.now() - startedAt,
    };
  }

  /**
   * Stop the shared container for a specific scanner type.
   */
  async stopContainer(scanner: ScannerType): Promise<void> {
    const state = this.scanners[scanner];
    this.clearIdleTimer(scanner);

    const cid = state.containerId;
    state.containerId = null;

    if (!cid) {
      return;
    }

    try {
      await this.dockerService.getDockerClient().getContainer(cid).stop({ t: 5 });
      this.logger.log(`Stopped ${scanner} shared container ${cid}`);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes("already") || msg.includes("No such container") || msg.includes("not running")) {
        this.logger.debug(`${scanner} container ${cid} already stopped: ${msg}`);
      } else {
        this.logger.warn(`Error stopping ${scanner} container ${cid}: ${msg}`);
      }
    }
  }

  /**
   * Stop all scanner containers (called on module destroy).
   */
  async stopAllContainers(): Promise<void> {
    await Promise.all(SCANNER_TYPES.map((s) => this.stopContainer(s)));
  }

  // -----------------------------------------------------------------------
  // Lifecycle
  // -----------------------------------------------------------------------

  async onModuleDestroy(): Promise<void> {
    this.cancelImageCleanupTimer();
    await this.stopAllContainers();
  }

  // -----------------------------------------------------------------------
  // Internal — per-scanner container lifecycle
  // -----------------------------------------------------------------------

  private async startContainer(scanner: ScannerType): Promise<boolean> {
    const image = this.getScannerRunnerImage();
    const state = this.scanners[scanner];
    const meta = SCANNER_META[scanner];

    // 1. Ensure image exists (build attempted at most once per process)
    const imageExists = await this.ensureImageExists(image);
    if (!imageExists) {
      if (!this.imageUnavailableWarned.has(image)) {
        this.imageUnavailableWarned.add(image);
        this.logger.error(
          `Cannot start ${scanner} container — image "${image}" not available and build failed. ` +
          `Scanners fall back to ephemeral per-scan containers until the image exists. ` +
          `Build manually with: bun --bun run docker:build:scanner-runner`,
        );
      } else {
        this.logger.debug(`Cannot start ${scanner} container — image "${image}" still unavailable`);
      }
      return false;
    }

    // 2. Adopt an already-running shared container (e.g. left over from a
    //    previous API run). Reusing it avoids a name conflict on create and
    //    keeps ONE long-lived container across API restarts.
    const adopted = await this.tryAdoptExistingContainer(meta.containerName);
    if (adopted) {
      state.containerId = adopted;
      this.logger.log(`Adopted existing ${scanner} shared container ${adopted} (${meta.containerName})`);
      await this.dockerService.startContainer(state.containerId).catch(() => undefined);

      const ready = await this.waitForContainerReady(state.containerId);
      if (!ready) {
        this.logger.warn(`${scanner} adopted container did not become responsive in time`);
      }

      this.trackActivity(scanner);
      this.resetIdleTimer(scanner);
      this.startImageCleanupTimer();
      return true;
    }

    // 3. Determine socket bind mount from DockerService (never hardcoded)
    const socketBind = this.dockerService.getDockerSocketBindMount();
    const envVars: string[] = [];

    if (socketBind) {
      // Extract the host-side path for DOCKER_HOST
      const hostPath = socketBind.split(":")[0];
      envVars.push(`DOCKER_HOST=unix://${hostPath}`);
    } else {
      // TCP mode — attempt to reconstruct DOCKER_HOST from the dockerode client
      const dockerClient = this.dockerService.getDockerClient();
      const host = Reflect.get(isRecord(dockerClient) ? dockerClient : {}, "host") as string | undefined;
      const port = Reflect.get(isRecord(dockerClient) ? dockerClient : {}, "port") as number | undefined;
      if (host && port) {
        envVars.push(`DOCKER_HOST=tcp://${host}:${String(port)}`);
      }
    }

    try {
      const container = await this.dockerService.createContainer({
        Image: image,
        name: meta.containerName,
        Env: envVars.length > 0 ? envVars : undefined,
        HostConfig: {
          AutoRemove: true,
          Binds: socketBind ? [socketBind] : undefined,
        },
        Tty: false,
      });

      state.containerId = container.id;
      this.logger.log(`Created ${scanner} shared container ${container.id} (${meta.containerName})`);

      await this.dockerService.startContainer(state.containerId);

      // Wait for the container to become responsive
      const ready = await this.waitForContainerReady(state.containerId);
      if (!ready) {
        this.logger.warn(`${scanner} container started but did not become responsive in time`);
      }

      this.trackActivity(scanner);
      this.resetIdleTimer(scanner);

      // Start the global image-cleanup timer (once)
      this.startImageCleanupTimer();

      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.error(`Failed to start ${scanner} shared container: ${msg}`);
      state.containerId = null;
      return false;
    }
  }

  /**
   * Wait for a container to become responsive by exec-ing a simple
   * command (`true`) until it succeeds or we time out.
   */
  private async waitForContainerReady(containerId: string): Promise<boolean> {
    const deadline = Date.now() + CONTAINER_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const result = await this.dockerService.execInContainerCapture(containerId, ["true"]);
        if (result.exitCode === 0) {
          return true;
        }
      } catch {
        // Not ready yet
      }

      await new Promise((r) => setTimeout(r, CONTAINER_READY_POLL_MS));
    }

    return false;
  }

  private async isContainerAlive(containerId: string): Promise<boolean> {
    try {
      const info = await this.dockerService.getDockerClient().getContainer(containerId).inspect();
      return info.State.Running;
    } catch {
      return false;
    }
  }

  private trackActivity(scanner: ScannerType): void {
    const state = this.scanners[scanner];
    state.lastActivityAt = Date.now();

    // Also update the activity marker inside the container so the internal cron
    // sees recent activity and does not self-destruct prematurely.
    if (state.containerId) {
      this.dockerService
        .execInContainerCapture(state.containerId, [
          "sh", "-c", "date +%s > /var/run/scanner/last-activity",
        ])
        .catch(() => {
          // Best-effort — the scanner-wrapper.sh scripts already log timestamps
        });
    }
  }

  // -----------------------------------------------------------------------
  // Idle timer (app-level: 10 min per scanner)
  // -----------------------------------------------------------------------

  private resetIdleTimer(scanner: ScannerType): void {
    this.clearIdleTimer(scanner);

    const state = this.scanners[scanner];
    const timeoutMs = this.getAppIdleTimeoutMs();

    state.idleTimer = setTimeout(() => {
      this.logger.log(
        `No ${scanner} activity for ${String(timeoutMs / 1_000 / 60)}m — stopping shared container`,
      );
      void this.stopContainer(scanner);
    }, timeoutMs);

    // Allow the timer to not keep the process alive
    if (state.idleTimer && typeof state.idleTimer === "object" && "unref" in state.idleTimer) {
      state.idleTimer.unref();
    }
  }

  private clearIdleTimer(scanner: ScannerType): void {
    const state = this.scanners[scanner];
    if (state.idleTimer) {
      clearTimeout(state.idleTimer);
      state.idleTimer = null;
    }
  }

  // -----------------------------------------------------------------------
  // Image cleanup (10 day threshold — shared across all scanners)
  // -----------------------------------------------------------------------

  private startImageCleanupTimer(): void {
    if (this.imageCleanupTimer) {
      return;
    }

    this.imageCleanupTimer = setInterval(() => {
      void this.cleanStaleScannerImages();
    }, IMAGE_CLEANUP_INTERVAL_MS);

    if (typeof this.imageCleanupTimer === "object" && "unref" in this.imageCleanupTimer) {
      this.imageCleanupTimer.unref();
    }
  }

  private cancelImageCleanupTimer(): void {
    if (this.imageCleanupTimer) {
      clearInterval(this.imageCleanupTimer);
      this.imageCleanupTimer = null;
    }
  }

  /**
   * Prune cached scanner layers inside every running scanner container
   * if the entire feature has been inactive for more than 10 days.
   */
  async cleanStaleScannerImages(): Promise<void> {
    const now = Date.now();
    const anyActivity = Math.max(
      ...SCANNER_TYPES.map((s) => this.scanners[s].lastActivityAt),
    );

    if (now - anyActivity < IMAGE_CLEANUP_THRESHOLD_MS) {
      return; // Still within the 10-day window
    }

    this.logger.log("No scanner activity for 10 days — cleaning up cached scanner image layers");

    for (const scanner of SCANNER_TYPES) {
      const state = this.scanners[scanner];
      if (!state.containerId) {
        continue;
      }

      try {
        await this.dockerService.execInContainerCapture(state.containerId, [
          "sh", "-c",
          "rm -rf /root/.cache/trivy/* /root/.cache/grype/* 2>/dev/null; " +
          "docker image prune -f 2>/dev/null || true",
        ]);
      } catch (error: unknown) {
        this.logger.warn(`Failed to clean stale images in ${scanner} container`, error);
      }
    }

    this.logger.log("Stale scanner images cleaned up");
  }

  // -----------------------------------------------------------------------
  // Helpers
  // -----------------------------------------------------------------------

  private getScannerRunnerImage(): string {
    try {
      return (this.envService.get("SCANNER_RUNNER_IMAGE")) ?? DEFAULT_SCANNER_RUNNER_IMAGE;
    } catch {
      return DEFAULT_SCANNER_RUNNER_IMAGE;
    }
  }

  private getAppIdleTimeoutMs(): number {
    try {
      return (this.envService.get("SCANNER_APP_IDLE_TIMEOUT_MS")) ?? DEFAULT_APP_IDLE_TIMEOUT_MS;
    } catch {
      return DEFAULT_APP_IDLE_TIMEOUT_MS;
    }
  }

  private isAutoScanDisabled(): boolean {
    try {
      return this.envService.get("DISABLE_AUTO_SCAN");
    } catch {
      return false;
    }
  }

  /**
   * Ensure the scanner-runner image exists locally.
   *
   * - Inspects first (covers images built manually or by a previous run).
   * - If missing, builds it — but at most ONCE per process lifetime, no
   *   matter how many scans arrive. Concurrent callers share the same
   *   in-flight attempt; failed attempts are not retried (a later manual
   *   `docker:build:scanner-runner` still succeeds via the inspect path).
   */
  private async ensureImageExists(image: string): Promise<boolean> {
    try {
      await this.dockerService.getDockerClient().getImage(image).inspect();
      return true;
    } catch {
      // Not found locally — fall through to the one-shot build.
    }

    let attempt = this.imageBuildAttempts.get(image);
    if (!attempt) {
      attempt = this.buildScannerRunnerImageOnce(image);
      this.imageBuildAttempts.set(image, attempt);
    }
    return attempt;
  }

  /** Single build attempt for the scanner-runner image. Never throws. */
  private async buildScannerRunnerImageOnce(image: string): Promise<boolean> {
    const context = this.resolveScannerBuildContext();

    if (!context) {
      this.logger.warn(
        `Scanner-runner build context "docker/scanner-runner/" not found from cwd "${process.cwd()}" — ` +
        `skipping build (one attempt per process). In docker dev, ensure the compose file mounts ` +
        `the repo's docker/ directory into /app/docker. Manual fallback: bun --bun run docker:build:scanner-runner`,
      );
      return false;
    }

    try {
      this.logger.log(`Building scanner-runner image "${image}" from ${context} (single attempt)`);
      await this.dockerService.buildImage(context, image, { dockerfileName: "Dockerfile" });
      this.logger.log(`Scanner-runner image "${image}" built successfully`);
      return true;
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Scanner-runner image "${image}" could not be built: ${msg}. ` +
        `Scanners will use ephemeral containers as fallback. ` +
        `To build manually: bun --bun run docker:build:scanner-runner`,
      );
      return false;
    }
  }

  /**
   * Locate the `docker/scanner-runner/` build context without relying on the
   * process cwd being the repo root (in containers cwd is `/app`; locally it
   * is often `apps/api`). Checks an env override first, then walks up from
   * cwd. Returns the absolute directory containing the Dockerfile, or null.
   */
  private resolveScannerBuildContext(): string | null {
    const candidates: string[] = [];

    try {
      const override = this.envService.get("SCANNER_RUNNER_BUILD_CONTEXT");
      if (typeof override === "string" && override.trim().length > 0) {
        candidates.push(path.resolve(override.trim()));
      }
    } catch {
      // Env service unavailable — ignore the override.
    }

    let dir = path.resolve(process.cwd());
    for (let depth = 0; depth < 6; depth += 1) {
      candidates.push(path.join(dir, "docker", "scanner-runner"));
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }

    for (const candidate of candidates) {
      if (fs.existsSync(path.join(candidate, "Dockerfile"))) {
        return candidate;
      }
    }
    return null;
  }

  /**
   * Reuse a shared container left over from a previous API run instead of
   * colliding with its fixed name on create. Running containers are adopted
   * as-is; stopped/exited ones are force-removed so a fresh one can be
   * created under the same name.
   */
  private async tryAdoptExistingContainer(name: string): Promise<string | null> {
    try {
      const existing = this.dockerService.getDockerClient().getContainer(name);
      const info = await existing.inspect();
      if (info.State.Running) {
        return info.Id;
      }
      await existing.remove({ force: true });
      this.logger.debug(`Removed stopped shared container "${name}" before recreating`);
    } catch {
      // No container with that name — nothing to adopt.
    }
    return null;
  }
}
