import { Injectable, Logger } from "@nestjs/common";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import type { SetupStateSnapshot } from "@repo/contracts-entities";

/**
 * The wizard's PRE-GATE state, answered locally.
 *
 * ── WHY THIS EXISTS: THE GATE MEANS THE API DOES NOT EXIST YET ───────────────
 * Setup's gate opens when the wizard's details are collected, and the API starts
 * *behind* that gate. But the wizard's FIRST action is to read `/setup/state` to
 * decide which step to show. Proxying that to the API is therefore a race the
 * design guarantees to lose: the operator's very first page load asks a question
 * that only a process which has not started yet could answer.
 *
 * That is not a bug in the ordering — it is the ordering working as intended. The
 * mistake was routing a LOCAL question through the API. `node_config` is shared
 * (setup WRITES it, the API reads it), so setup can answer from the same row the
 * API would have read.
 *
 * ── THE SPLIT, AND WHY IT IS WHERE IT IS ────────────────────────────────────
 *   | endpoint           | answerable before the gate? | where              |
 *   |--------------------|-----------------------------|--------------------|
 *   | `/setup/state`      | YES — it is a node_config read | HERE            |
 *   | `/setup/node-status`| YES — same row                | HERE            |
 *   | `/setup/probe/*`    | YES — pure network probes     | HERE            |
 *   | `/setup/trigger`    | no — it NEEDS the API         | the API          |
 *   | `/setup/stream`     | no — it reports API work      | the API          |
 *
 * The rule: setup answers what it can know on its own; everything that requires
 * the provisioning engine (the Drizzle schema, migrations, auth) still goes to
 * the API. That keeps ONE implementation of provisioning while removing the
 * pointless round-trip for a question setup already has the answer to.
 *
 * ── WHY DUPLICATING THIS READ IS NOT A SECOND IMPLEMENTATION ────────────────
 * This mirrors `InitializationService.getSetupState()`, and the overlap is
 * deliberate but bounded: both derive the same three outcomes from the same row
 * using the same predicate (`configuredAt && databaseUrl`). It is not a second
 * SOURCE OF TRUTH — `node_config` is — and the alternative (the wizard cannot
 * load before the gate) is strictly worse.
 *
 * What must NOT be duplicated is the provisioning flow, and it is not.
 */
@Injectable()
export class WizardStateService {
  private readonly logger = new Logger(WizardStateService.name);

  constructor(private readonly nodeConfig: NodeConfigRepository) {}

  /**
   * Whether this node has a COMPLETED platform.
   *
   * The same predicate the API uses: a row with `configuredAt` but no
   * `databaseUrl` is a stale/partial write from an interrupted attempt, and must
   * report as needing setup so the wizard can re-provision rather than showing a
   * dashboard over an empty schema.
   */
  isConfigured(): boolean {
    const config = this.nodeConfig.find();
    return Boolean(config?.configuredAt && config.databaseUrl?.trim());
  }

  /** The wizard's state snapshot, from the shared `node_config` row. */
  getState(): SetupStateSnapshot {
    const config = this.nodeConfig.find();

    if (config === null || config === undefined) {
      return this.notStarted();
    }

    if (this.isConfigured()) {
      return {
        state: "completed",
        needsSetup: false,
        // Optimistically true: this is the honest answer for a CONFIGURED node
        // (the overwhelmingly common case), and a false negative would hide the
        // sign-in step from an operator who has an account. The API performs the
        // real probe once it is up — setup has no database connection to do it
        // with, and inventing one would mean carrying the pg client here.
        hasUsers: true,
        bootstrapStrategy: config.strategy,
        availableStrategies: ["local", "remote"],
        currentStep: null,
        progressPercent: 100,
        steps: [],
        completedAt: config.configuredAt === null ? null : new Date(config.configuredAt),
      };
    }

    return this.notStarted();
  }

  /**
   * Network identity of this node.
   *
   * `isConfigured` uses the same predicate as `getState`, so the wizard's two
   * pre-gate reads can never disagree about whether setup is needed — a
   * divergence that would show the wizard and the done page at once.
   */
  getNodeStatus(): {
    isConfigured: boolean;
    nodeId: string | null;
    strategy: string | null;
    meshUrlsSnapshot: string[];
    configuredAt: Date | null;
  } {
    const config = this.nodeConfig.find();
    const configured = this.isConfigured();

    return {
      isConfigured: configured,
      nodeId: config?.nodeId ?? null,
      strategy: config?.strategy ?? null,
      meshUrlsSnapshot: config?.meshUrlsSnapshot ?? [],
      configuredAt:
        configured && config?.configuredAt !== null && config?.configuredAt !== undefined
          ? new Date(config.configuredAt)
          : null,
    };
  }

  /** The fresh-install snapshot. One definition, so both callers agree. */
  private notStarted(): SetupStateSnapshot {
    return {
      state: "not_started",
      needsSetup: true,
      hasUsers: false,
      bootstrapStrategy: null,
      availableStrategies: ["local", "remote"],
      currentStep: "choose_strategy",
      progressPercent: 0,
      steps: [
        { id: "choose_strategy", title: "Choose bootstrap strategy", status: "pending" },
        { id: "configure_account", title: "Configure account", status: "pending" },
      ],
      completedAt: null,
    };
  }

  /** Log once, so a wizard served from a stale row is visible in the logs. */
  describe(): string {
    const status = this.getNodeStatus();
    return status.isConfigured
      ? `configured (node ${status.nodeId ?? "unknown"})`
      : "not configured — the wizard will collect the details";
  }
}
