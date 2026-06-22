import { Injectable, type OnModuleDestroy, Logger } from "@nestjs/common";
import { EnvService } from "@/config/env/env.service";
import { DockerService } from "./docker.service";

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
      throw new Error(
        `${scanner} shared container is not running — call ensureContainerRunning("${scanner}") first`,
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

    // 1. Ensure image exists
    const imageExists = await this.ensureImageExists(image);
    if (!imageExists) {
      this.logger.error(`Cannot start ${scanner} container — image "${image}" not available`);
      return false;
    }

    // 2. Determine socket bind mount from DockerService (never hardcoded)
    const socketBind = this.dockerService.getDockerSocketBindMount();
    const envVars: string[] = [];

    if (socketBind) {
      // Extract the host-side path for DOCKER_HOST
      const hostPath = socketBind.split(":")[0];
      envVars.push(`DOCKER_HOST=unix://${hostPath}`);
    } else {
      // TCP mode — attempt to reconstruct DOCKER_HOST from the dockerode client
      const dockerClient = this.dockerService.getDockerClient();
      const host = (dockerClient as Record<string, unknown>).host as string | undefined;
      const port = (dockerClient as Record<string, unknown>).port as number | undefined;
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
   * Tries to inspect first; if not found, attempts a local Docker build
   * (since this is a custom image not published on any registry).
   */
  private async ensureImageExists(image: string): Promise<boolean> {
    try {
      await this.dockerService.getDockerClient().getImage(image).inspect();
      return true;
    } catch {
      // Not found — try building locally
    }

    try {
      this.logger.log(`Attempting to build scanner-runner image "${image}" locally`);
      await this.dockerService.buildImage(
        "docker/scanner-runner/",
        image,
        { dockerfileName: "docker/scanner-runner/Dockerfile" },
      );
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
}
