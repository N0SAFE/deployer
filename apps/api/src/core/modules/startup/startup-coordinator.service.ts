/**
 * Startup Coordinator Service
 *
 * Implements the complete node startup protocol as specified by the user:
 *
 * ```
 * onNodeStartup() {
 *   const deployerVersion = extract from package.json (readFileSync + JSON.parse)
 *   const nodeStatus = check local DB for setup state (configuredAt + setupState)
 *
 *   if (nodeStatus is not done) {
 *     run setup state with setup form
 *     if (selected setup strategy is local) {
 *       run setup: create/connect DB, run migrations, register first node as itself
 *     } else {
 *       selected setup is remote
 *       try connecting to the node URL provided
 *       when connected check if all nodes of the mesh are in the same version
 *       if not compatible → throw error with actionable message
 *       if self is less → tell user to use mesh version
 *       if self is more → prompt super admin with button to upgrade all mesh sequentially
 *       with migration + rollback strategy if one fails
 *       if everything works → store state in local DB
 *     }
 *   }
 *
 *   when nodeStatus is marked as done:
 *     connect to mesh using local DB info
 *     gather all node versions
 *     if deployerVersion == same as all → run normally
 *     else → node was updated solo → trigger upgrade button
 *
 *   start mesh and everything
 * }
 * ```
 *
 * This service is called from the entrypoint scripts (entrypoint.dev.ts,
 * entrypoint.prod.ts) and from the NestJS InitializationService lifecycle.
 * It coordinates between:
 *   - NodeConfigRepository (local SQLite state)
 *   - MeshInitializationService (mesh connectivity)
 *   - MeshVersionService (version comparison)
 *   - LocalInitializationService / RemoteInitializationService (setup flows)
 */

import { Injectable, Logger } from "@nestjs/common";
import { DEPLOYER_VERSION, semverCompare } from "@/core/utils/deployer-version";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import { SetupState, type NodeConfigRow } from "@/config/drizzle/local/schema/node-config";
import { MeshInitializationService } from "@/core/modules/mesh/initialization/services/mesh-initialization.service";
import { MeshVersionService, type VersionComparisonResult } from "./mesh-version.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type StartupPhase =
  | "version_check"
  | "setup_state_check"
  | "local_setup"
  | "remote_setup_connect"
  | "remote_setup_version_check"
  | "post_setup_mesh_connect"
  | "post_setup_version_compare"
  | "mesh_start"
  | "upgrade_trigger"
  | "upgrade_execute";

export type StartupStatus =
  | { phase: StartupPhase; status: "running"; message: string }
  | { phase: StartupPhase; status: "completed"; message: string }
  | { phase: StartupPhase; status: "blocked"; message: string; code: string }
  | { phase: StartupPhase; status: "failed"; message: string; code: string }
  | { phase: "setup_required"; status: "blocked"; message: string }
  | { phase: "upgrade_required"; status: "blocked"; message: string; comparison: VersionComparisonResult; meshUrls: string[] }
  | { phase: "ready"; status: "completed"; message: string; nodeId: string; version: string };

/**
 * Callback signature for the entrypoint to report progress.
 * The entrypoint can log, emit, or ignore these events.
 */
export type StatusCallback = (status: StartupStatus) => void;

// ─── Service ──────────────────────────────────────────────────────────────────

@Injectable()
export class StartupCoordinatorService {
  private readonly logger = new Logger(StartupCoordinatorService.name);

  constructor(
    private readonly nodeConfigRepository: NodeConfigRepository,
    private readonly meshInitializationService: MeshInitializationService,
    private readonly meshVersionService: MeshVersionService,
  ) {}

  // ─── Public API ────────────────────────────────────────────────────────────

  /**
   * Run the full startup protocol.
   *
   * @param onStatus - Optional callback invoked on each phase transition
   * @returns The final startup status
   */
  async execute(onStatus?: StatusCallback): Promise<StartupStatus> {
    return this.runStartupProtocol(onStatus);
  }

  /**
   * Non-blocking check of the current node's setup state.
   * Returns the phase the node is in without running any setup.
   */
  getSetupStatus(): { setupState: SetupState; configuredAt: string | null; version: string } {
    const config = this.nodeConfigRepository.find();
    return {
      setupState: (config?.setupState as SetupState) ?? "not_started",
      configuredAt: config?.configuredAt ?? null,
      version: DEPLOYER_VERSION,
    };
  }

  /**
   * Upgrade this node to a target version.
   * Called by the upgrade flow when the super admin authorizes an upgrade.
   */
  async upgradeNode(targetVersion: string): Promise<StartupStatus> {
    this.emit({ phase: "upgrade_execute", status: "running", message: `Upgrading node to version ${targetVersion}...` }, undefined);

    try {
      // Update local state
      const config = this.nodeConfigRepository.find();
      if (config) {
        this.nodeConfigRepository.upsert({
          ...config,
          setupState: "upgrade_in_progress",
          upgradedAtVersion: targetVersion,
          updatedAt: new Date().toISOString(),
          // Preserve all existing fields
          nodeId: config.nodeId,
          strategy: config.strategy,
          meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
          databaseUrl: config.databaseUrl,
          configuredAt: config.configuredAt,
          peerServiceToken: config.peerServiceToken ?? undefined,
          peerServiceTokenExpiresAt: config.peerServiceTokenExpiresAt ?? undefined,
          meshSharedSecret: config.meshSharedSecret ?? undefined,
          meshSharedSecretUpdatedAt: config.meshSharedSecretUpdatedAt ?? undefined,
          deployerVersion: config.deployerVersion ?? undefined,
        });
      }

      return {
        phase: "upgrade_execute",
        status: "completed",
        message: `Node upgraded to version ${targetVersion}. Restart to apply.`,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        phase: "upgrade_execute",
        status: "failed",
        message: `Upgrade failed: ${message}`,
        code: "UPGRADE_FAILED",
      };
    }
  }

  // ─── Internal Protocol ─────────────────────────────────────────────────────

  private async runStartupProtocol(onStatus?: StatusCallback): Promise<StartupStatus> {
    // ── Phase 1: Version Extraction ────────────────────────────────────────
    this.emit({ phase: "version_check", status: "running", message: `Deployer version: ${DEPLOYER_VERSION}` }, onStatus);
    this.logger.log(`📦 Deployer version: ${DEPLOYER_VERSION}`);

    // ── Phase 2: Setup State Check ────────────────────────────────────────
    this.emit({ phase: "setup_state_check", status: "running", message: "Checking node setup state..." }, onStatus);

    const config = this.nodeConfigRepository.find();

    if (!config || !config.configuredAt || config.setupState === "not_started") {
      // Node has never been set up — needs setup wizard
      this.emit({
        phase: "setup_required",
        status: "blocked",
        message:
          `Node is not configured. A setup wizard is required. ` +
          `Deployer version: ${DEPLOYER_VERSION}. ` +
          `Please choose a bootstrap strategy (local or remote).`,
      }, onStatus);

      return {
        phase: "setup_required",
        status: "blocked",
        message:
          `Node setup has not been completed. Run the setup wizard ` +
          `(local or remote strategy) before starting the mesh.`,
      };
    }

    if (config.setupState === "setup_in_progress") {
      // Setup was interrupted — needs to restart or be retried
      return {
        phase: "setup_state_check",
        status: "blocked",
        message:
          `Setup was in progress but did not complete. ` +
          `This may be due to an interruption. Run the setup wizard again.`,
        code: "SETUP_INTERRUPTED",
      };
    }

    if (config.setupState === "setup_done") {
      return this.handlePostSetup(config, onStatus);
    }

    if (config.setupState === "upgrade_pending" || config.setupState === "upgrade_in_progress") {
      return this.handleUpgradeFlow(config, onStatus);
    }

    if (config.setupState === "upgrade_failed") {
      return {
        phase: "setup_state_check",
        status: "failed",
        message:
          `A previous upgrade attempt failed. ` +
          `Manual intervention or rollback is required before the node can start.`,
        code: "UPGRADE_FAILED_PREVIOUS",
      };
    }

    // Fallback: unknown state
    return {
      phase: "setup_state_check",
      status: "failed",
      message: `Unknown setup state: ${config.setupState}. Cannot proceed.`,
      code: "UNKNOWN_SETUP_STATE",
    };
  }

  /**
   * Handle the post-setup path: connect to mesh, gather versions, compare.
   */
  private async handlePostSetup(
    config: NodeConfigRow,
    onStatus?: StatusCallback,
  ): Promise<StartupStatus> {
    this.emit({
      phase: "post_setup_mesh_connect",
      status: "running",
      message: "Setup is done. Connecting to mesh to gather versions...",
    }, onStatus);

    const meshUrls = config.meshUrlsSnapshot ?? [];

    if (meshUrls.length === 0) {
      // Local strategy node with no mesh URLs — it's the first/only node
      this.logger.log("✅ No mesh peers to check — this is the first/only node");
      return this.completeStartup(config);
    }

    // ── Phase: Connect to mesh and gather version info ───────────────────
    try {
      const comparison = await this.meshVersionService.compareLocalWithMesh(
        meshUrls,
        config.peerServiceToken,
      );

      this.emit({
        phase: "post_setup_version_compare",
        status: "running",
        message: comparison.message,
      }, onStatus);

      switch (comparison.status) {
        case "same":
          this.logger.log(`✅ Version match: all nodes on ${DEPLOYER_VERSION}`);
          return this.completeStartup(config);

        case "no_peers":
          this.logger.log("ℹ️  No peers reachable — starting standalone");
          return this.completeStartup(config);

        case "local_behind":
          // This node is outdated — must upgrade
          return {
            phase: "upgrade_required",
            status: "blocked",
            message: comparison.message,
            comparison,
            meshUrls,
          };

        case "local_ahead":
          // This node is ahead — can trigger mesh upgrade
          return {
            phase: "upgrade_required",
            status: "blocked",
            message: comparison.message,
            comparison,
            meshUrls,
          };

        case "inconsistent_mesh":
          // Mesh has multiple versions — this is an error state
          return {
            phase: "post_setup_version_compare",
            status: "failed",
            message: comparison.message,
            code: "INCONSISTENT_MESH_VERSIONS",
          };
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to check mesh versions: ${message}`);
      return {
        phase: "post_setup_mesh_connect",
        status: "failed",
        message: `Could not connect to mesh peers for version check: ${message}`,
        code: "MESH_CONNECT_FAILED",
      };
    }
  }

  /**
   * Handle the upgrade flow when version mismatch is detected.
   */
  private async handleUpgradeFlow(
    config: NodeConfigRow,
    onStatus?: StatusCallback,
  ): Promise<StartupStatus> {
    this.emit({
      phase: "upgrade_trigger",
      status: "running",
      message: `Upgrade flow triggered. Current version: ${DEPLOYER_VERSION}`,
    }, onStatus);

    // Connect to mesh and check current state
    const meshUrls = config.meshUrlsSnapshot ?? [];

    if (meshUrls.length === 0) {
      // Solo node — just mark as done
      this.logger.log("✅ Solo node upgrade — no peers to coordinate with");
      return this.completeStartup(config);
    }

    try {
      const comparison = await this.meshVersionService.compareLocalWithMesh(
        meshUrls,
        config.peerServiceToken,
      );

      if (comparison.status === "same") {
        // Upgrade completed — mesh is now consistent
        this.logger.log("✅ Upgrade confirmed — mesh is consistent");
        this.nodeConfigRepository.upsert({
          ...config,
          setupState: "setup_done",
          updatedAt: new Date().toISOString(),
          nodeId: config.nodeId,
          strategy: config.strategy,
          meshUrlsSnapshot: config.meshUrlsSnapshot ?? [],
          databaseUrl: config.databaseUrl,
          configuredAt: config.configuredAt,
          peerServiceToken: config.peerServiceToken ?? undefined,
          peerServiceTokenExpiresAt: config.peerServiceTokenExpiresAt ?? undefined,
          meshSharedSecret: config.meshSharedSecret ?? undefined,
          meshSharedSecretUpdatedAt: config.meshSharedSecretUpdatedAt ?? undefined,
          deployerVersion: DEPLOYER_VERSION,
          upgradedAtVersion: DEPLOYER_VERSION,
        });
        return this.completeStartup(config);
      }

      // Still mismatched — report to user
      return {
        phase: "upgrade_trigger",
        status: "blocked",
        message: comparison.message,
        comparison,
        meshUrls,
      };
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Upgrade version check failed: ${message}`);
      return {
        phase: "upgrade_trigger",
        status: "failed",
        message: `Upgrade flow check failed: ${message}`,
        code: "UPGRADE_CHECK_FAILED",
      };
    }
  }

  /**
   * Complete the startup flow — mark node as ready.
   */
  private completeStartup(config: NodeConfigRow): StartupStatus {
    const ready: StartupStatus = {
      phase: "ready",
      status: "completed",
      message:
        `Node ${config.nodeId} (v${DEPLOYER_VERSION}) is ready. ` +
        `Strategy: ${config.strategy}. Setup state: ${config.setupState}.`,
      nodeId: config.nodeId,
      version: DEPLOYER_VERSION,
    };

    this.emit(ready, undefined);
    this.logger.log(`✅ Startup complete: ${config.nodeId} v${DEPLOYER_VERSION}`);
    return ready;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────────

  private emit(status: StartupStatus, onStatus?: StatusCallback): void {
    if (onStatus) {
      onStatus(status);
    }
  }
}
