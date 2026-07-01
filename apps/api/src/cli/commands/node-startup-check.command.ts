/**
 * Node Startup Check CLI Command
 *
 * Called by entrypoint scripts to determine the current node's setup state
 * and version before deciding whether to start normally, run setup, or
 * trigger an upgrade.
 *
 * Exit codes:
 *   0  Setup is done and version is consistent — ready to start
 *   1  Setup is done but version mismatch detected (see stdout for details)
 *   2  Setup has never been started (setup wizard required)
 *   3  Setup was in progress but interrupted
 *   4  Setup failed / upgrade failed previous
 *   5  Error reading config or other unexpected failure
 *
 * stdout output: JSON with { setupState, deployerVersion, nodeId, strategy,
 *   configuredAt, message }
 */

import { Command, CommandRunner } from "nest-commander";
import { Injectable, Logger } from "@nestjs/common";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { NodeConfigRepository } from "@/core/modules/setup/repositories/node-config.repository";
import type { SetupState } from "@/config/drizzle/local/schema/node-config";

// ─── Resolve version from package.json ─────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const PKG_PATH = join(__dirname, "..", "..", "..", "..", "package.json");

function resolveDeployerVersion(): string {
  try {
    const raw = readFileSync(PKG_PATH, "utf-8");
    return JSON.parse(raw).version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

const DEPLOYER_VERSION = resolveDeployerVersion();

// ─── Output type ───────────────────────────────────────────────────────────────

export interface StartupCheckOutput {
  /** The current setup state (not_started | setup_in_progress | setup_done | upgrade_pending | upgrade_in_progress | upgrade_failed) */
  setupState: SetupState | "unknown";
  /** Deployer version from package.json */
  deployerVersion: string;
  /** Node ID from config (null if not configured) */
  nodeId: string | null;
  /** Bootstrap strategy (null if not configured) */
  strategy: "local" | "remote" | null;
  /** ISO timestamp of when the node was configured (null if not configured) */
  configuredAt: string | null;
  /** Human-readable message */
  message: string;
  /** Suggested exit code for the caller */
  exitCode: number;
}

// ─── Command ───────────────────────────────────────────────────────────────────

@Command({
  name: "node-startup-check",
  description: "Check the node's setup state and version before starting",
})
@Injectable()
export class NodeStartupCheckCommand extends CommandRunner {
  private readonly logger = new Logger(NodeStartupCheckCommand.name);

  constructor(
    private readonly nodeConfigRepository: NodeConfigRepository,
  ) {
    super();
  }

  async run(): Promise<void> {
    const output = this.performCheck();
    // Write JSON to stdout so the entrypoint can parse it
    console.log(JSON.stringify(output, null, 2));
    process.exit(output.exitCode);
  }

  // ─── Internal check ─────────────────────────────────────────────────────────

  private performCheck(): StartupCheckOutput {
    try {
      const config = this.nodeConfigRepository.find();

      if (!config) {
        // No config at all — setup has never been started
        return {
          setupState: "not_started",
          deployerVersion: DEPLOYER_VERSION,
          nodeId: null,
          strategy: null,
          configuredAt: null,
          message:
            `Node has no local configuration. Setup wizard is required. ` +
            `Deployer version: ${DEPLOYER_VERSION}.`,
          exitCode: 2,
        };
      }

      const setupState = (config.setupState ?? "not_started") as SetupState;
      const configuredAt = config.configuredAt ?? null;

      switch (setupState) {
        case "setup_done": {
          return {
            setupState: "setup_done",
            deployerVersion: DEPLOYER_VERSION,
            nodeId: config.nodeId,
            strategy: config.strategy,
            configuredAt,
            message:
              `Setup is done. Node ${config.nodeId}, strategy: ${config.strategy}, ` +
              `deployer version: ${DEPLOYER_VERSION}.` +
              (config.deployerVersion && config.deployerVersion !== DEPLOYER_VERSION
                ? ` Note: last setup was at version ${config.deployerVersion}, ` +
                  `current is ${DEPLOYER_VERSION}. Version check on startup recommended.`
                : ""),
            exitCode: config.deployerVersion && config.deployerVersion !== DEPLOYER_VERSION ? 1 : 0,
          };
        }

        case "not_started": {
          return {
            setupState: "not_started",
            deployerVersion: DEPLOYER_VERSION,
            nodeId: config.nodeId,
            strategy: config.strategy,
            configuredAt,
            message:
              `Node has not been set up yet. Run the setup wizard. ` +
              `Deployer version: ${DEPLOYER_VERSION}.`,
            exitCode: 2,
          };
        }

        case "setup_in_progress": {
          return {
            setupState: "setup_in_progress",
            deployerVersion: DEPLOYER_VERSION,
            nodeId: config.nodeId,
            strategy: config.strategy,
            configuredAt,
            message:
              `Setup was in progress but did not complete. ` +
              `This may be due to an interruption. Retry the setup wizard.`,
            exitCode: 3,
          };
        }

        case "upgrade_failed": {
          return {
            setupState: "upgrade_failed",
            deployerVersion: DEPLOYER_VERSION,
            nodeId: config.nodeId,
            strategy: config.strategy,
            configuredAt,
            message:
              `A previous upgrade attempt failed. ` +
              `Manual intervention or rollback is required.`,
            exitCode: 4,
          };
        }

        case "upgrade_pending":
        case "upgrade_in_progress": {
          return {
            setupState,
            deployerVersion: DEPLOYER_VERSION,
            nodeId: config.nodeId,
            strategy: config.strategy,
            configuredAt,
            message:
              `Upgrade is ${setupState === "upgrade_pending" ? "pending" : "in progress"}. ` +
              `Current version: ${DEPLOYER_VERSION}. ` +
              `Previous setup at version: ${config.deployerVersion ?? "unknown"}.`,
            exitCode: 1,
          };
        }

        default: {
          return {
            setupState: "unknown",
            deployerVersion: DEPLOYER_VERSION,
            nodeId: config.nodeId,
            strategy: config.strategy,
            configuredAt,
            message: `Unknown setup state: ${config.setupState}. Cannot determine startup path.`,
            exitCode: 5,
          };
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.error(`Failed to read node config: ${message}`);
      return {
        setupState: "unknown",
        deployerVersion: DEPLOYER_VERSION,
        nodeId: null,
        strategy: null,
        configuredAt: null,
        message: `Failed to read node config: ${message}. Cannot determine startup path.`,
        exitCode: 5,
      };
    }
  }
}
