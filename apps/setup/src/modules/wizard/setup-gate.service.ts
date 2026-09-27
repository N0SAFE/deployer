import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";

import { EnvService } from "@/config/env/env.module";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";
import { ClusterOrchestratorService } from "@/modules/cluster/services/cluster-orchestrator.service";
import type { ClusterEntryMode } from "@/modules/cluster/cluster.types";

/**
 * The gate that decides when the API may start.
 *
 * ── WHAT THE GATE IS ────────────────────────────────────────────────────────
 * `GET /setup/health` is the compose healthcheck on this app, and compose starts
 * the API *behind* it (`depends_on: setup: service_healthy`). So "setup is
 * healthy" means exactly **"the API may start"** — and this service is the only
 * thing that opens it.
 *
 * ── WHY IT OPENS ON THE TRIGGER, AND AFTER THE SWARM ────────────────────────
 * An earlier design gated on the API's readiness. That is a cycle: compose starts
 * the API behind this healthcheck, so setup cannot wait for the API before
 * reporting healthy. The escape would be starting the API early in a degraded
 * mode — which is the arrangement this refactor deleted.
 *
 * The trigger breaks the cycle, and the SWARM comes first within it:
 *
 *   trigger → swarm → gate opens → API scheduled onto that swarm → ingress
 *
 * The swarm must precede the gate for a mechanical reason: the API's supervisors
 * schedule their services onto the cluster, and a swarm GLOBAL service cannot be
 * created on an engine that is not a swarm. So `open()` does not publish
 * `launching` itself — it converges the engine, and the CLUSTER PIPELINE opens the
 * gate when the engine reports active.
 *
 * ── WHY IT PERSISTS BEFORE CONVERGING ───────────────────────────────────────
 * The gate's meaning is "the API may start", and the API starts by reading
 * `node_config.databaseUrl` and `node_config.swarmConfig`. Converging the engine
 * before those rows exist would build a cluster from defaults the operator never
 * chose. So the choices are written first, then the swarm is converged.
 *
 * ── WHO OWNED THIS BEFORE ───────────────────────────────────────────────────
 * The API did: `SetupDevService` (Phase 0) probed `MANAGED_GLOBAL_DB_*` /
 * `SETUP_AUTO_DATABASE_URL` and persisted a "setup candidate". That module was
 * never registered in any module graph (nothing imported it), so the candidate
 * was never written on a modern boot — and none of it is needed once setup owns
 * the decision: there is no pre-setup API to feed.
 */
@Injectable()
export class SetupGateService implements OnApplicationBootstrap {
  private readonly logger = new Logger(SetupGateService.name);

  constructor(
    private readonly phases: SetupPhaseService,
    private readonly nodeConfig: NodeConfigRepository,
    private readonly env: EnvService,
    private readonly cluster: ClusterOrchestratorService,
  ) {}

  /**
   * The wizard's trigger payload, retained until the API can receive it.
   *
   * ── WHY THIS IS HELD IN MEMORY AND NOT PERSISTED ────────────────────────
   * The payload carries the operator's admin PASSWORD. `node_config` is a
   * plaintext SQLite file on a shared volume, so writing it there would leave
   * a credential at rest for the lifetime of the install — and the API reads
   * that file on every boot. Holding it in memory keeps the secret in the one
   * place it is needed, for the only window it is needed.
   *
   * The consequence is honest and bounded: if setup dies between the gate
   * opening and the trigger being delivered, the operator re-enters the
   * credentials. That is strictly better than persisting them, and the wizard
   * is already the surface they are looking at.
   */
  private pendingTrigger: unknown = null;

  /** The payload the handover must deliver, or `null` when a restart skipped it. */
  triggerPayload(): unknown {
    return this.pendingTrigger;
  }

  /**
   * Open the gate immediately when setup was already completed by a previous run.
   *
   * ── WHY THIS IS THE SAME CODE PATH AND NOT A SEPARATE "MODE" ──────────────
   * A restart has nothing to collect, so the wizard is not shown — but that is
   * the ONLY difference. Once the gate is open, the machinery is identical: the
   * API starts, provisions the delta (migrations and seed are idempotent), turns
   * green, and setup retargets the ingress and exits.
   *
   * ── WHY `setup_done` IS THE RIGHT FLAG ─────────────────────────────────────
   * It is written by the API, after provisioning actually succeeded. So it
   * means "this node has a working platform", which is exactly the condition
   * under which skipping the wizard is safe. A row that merely has a
   * `databaseUrl` does not qualify — that is an unprovisioned candidate, and
   * skipping the wizard there would leave an empty schema with no one to fix it.
   */
  onApplicationBootstrap(): void {
    const existing = this.nodeConfig.find();

    if (existing?.setupState !== "setup_done") {
      // Nothing has been collected yet, so the wizard has work to do. The gate
      // stays CLOSED and `open()` is not called: converging the swarm before the
      // operator has chosen how to join would be the auto-founding this ordering
      // exists to prevent.
      this.logger.log(
        existing === null
          ? "No previous setup found — the wizard will collect the details"
          : `Setup state is "${existing.setupState}" — the wizard will collect the details`,
      );
      this.phases.record("collecting", "Serving the wizard — waiting for the setup details");
      return;
    }

    this.logger.log("Setup already completed on this node — converging without the wizard");
    // The same path as a fresh install, minus the collecting step: `open()`
    // converges the swarm from the PERSISTED participation, and the cluster
    // pipeline opens the gate when the engine reports active. Skipping straight
    // to `launching` here would let compose start the API against a swarm that
    // does not exist yet.
    this.open(undefined);
  }

  /**
   * Open the gate: persist the operator's choices, then converge the SWARM.
   *
   * ── THE ORDER, AND WHY IT IS THIS ORDER ─────────────────────────────────────
   *   1. persist the choices            (so the API finds them when it boots)
   *   2. converge the swarm             (the engine must exist to schedule on)
   *   3. the gate opens                 (cluster success publishes `launching`)
   *   4. the API is started onto it     (compose `depends_on`, or setup in prod)
   *   5. the API converges the ingress  (traefik becomes a swarm GLOBAL service)
   *
   * Step 2 precedes step 3 for a mechanical reason, not a stylistic one: the API's
   * supervisors schedule their services onto the swarm, and a swarm GLOBAL service
   * cannot be created on an engine that is not a swarm. Auto-founding at APP BOOT
   * (what this did before) also broke the opposite case — a node about to join a
   * fleet had already invented a cluster of its own.
   *
   * ── WHY THIS RETURNS IMMEDIATELY ────────────────────────────────────────────
   * Convergence takes seconds (init, membership settle, policy apply). Blocking
   * the HTTP request on it would hold the operator's browser open and make a
   * slow engine look like a hung wizard. Instead the cluster pipeline publishes
   * the phase, and the wizard watches it — the same event-driven contract every
   * other phase uses.
   */
  async open(input: unknown): Promise<void> {
    if (this.phases.isReady()) {
      // Idempotent: a double-click, a retry after a partial failure, or a
      // replayed request must all converge. Re-persisting is harmless (the write
      // is an upsert) but re-publishing would emit a spurious transition.
      this.logger.log("Gate is already open — keeping the persisted choices");
      return;
    }

    // ── WHY A REPEAT RUN DOES NOT RE-PERSIST ──────────────────────────────
    // `node_config` is the single source of truth, and a completed setup has
    // already written it. Overwriting from an EMPTY payload (a restart passes
    // `undefined`) would erase the swarm participation and the database URL
    // the API is about to read — turning a healthy restart into a broken node.
    const completed = this.nodeConfig.find()?.setupState === "setup_done";
    if (!completed) {
      this.persist(input);
    }

    // Retained for the handover to deliver once the API is reachable. On a
    // restart there is nothing to deliver — the API re-provisions from the
    // persisted row and the idempotency of migrate/seed.
    this.pendingTrigger = completed ? null : input;

    // ── STEP 2: THE SWARM ──────────────────────────────────────────────────
    // Started here, not at boot. The cluster pipeline publishes `launching` when
    // the engine reports active, which is what opens the gate — so the API cannot
    // be scheduled onto a swarm that does not exist yet.
    this.phases.record("clustering", "Founding the cluster…");
    this.cluster.start(this.entryModeFrom(input));

    this.logger.log(
      "🚀 Setup trigger accepted — converging the swarm; the gate opens when it is active",
    );
  }

  /**
   * How this node enters the cluster, from the operator's wizard payload.
   *
   * `found` in both cases, and that is deliberate rather than a stub:
   *
   *   - **local** — the node creates the swarm. This is the only mode setup can
   *     act on, because it needs no external input.
   *   - **remote** — the node will JOIN a fleet, but the join token and the
   *     control-plane addresses come from the TARGET cluster's grant, which the
   *     API obtains via `remoteAuth` during provisioning. Setup does not have
   *     them yet, so it cannot join; it founds the engine so the API has a swarm
   *     to be scheduled on, and the API's own `SwarmBootstrapService.converge()`
   *     LEAVES that lone cluster when it applies the grant's `mode=join`. That
   *     handling is in `SwarmParticipationService.converge()`, which is
   *     deliberately restricted to a lone auto-founded cluster — a single
   *     manager with a single node is by construction this node's own, so no
   *     peer state can be lost.
   *
   * Inventing a join here would mean guessing a token, which is worse than the
   * (already-handled) two-phase case above.
   */
  private entryModeFrom(input: unknown): ClusterEntryMode {
    const swarm =
      typeof input === "object" && input !== null
        ? (input as { swarm?: { joinToken?: unknown; joinAddrs?: unknown } }).swarm
        : undefined;

    const joinToken = typeof swarm?.joinToken === "string" ? swarm.joinToken.trim() : "";
    const joinAddrs = Array.isArray(swarm?.joinAddrs)
      ? swarm.joinAddrs.filter((entry): entry is string => typeof entry === "string" && entry.length > 0)
      : [];

    // Only join when the operator's payload carries BOTH pieces. A token without
    // addresses (or the reverse) cannot complete a join, so it is treated as
    // "found" and the API finishes the join from the grant.
    if (joinToken.length > 0 && joinAddrs.length > 0) {
      this.logger.log(`Wizard supplied a join target (${joinAddrs.join(", ")})`);
      return { kind: "join", joinToken, remoteAddrs: joinAddrs };
    }

    return { kind: "found" };
  }

  /**
   * Write the wizard's choices into the shared `node_config` row.
   *
   * ── SINGLE-WRITER RULE ─────────────────────────────────────────────────────
   * Setup is the only writer of this row during onboarding; the API only reads
   * it. That is what makes sharing the SQLite volume safe without a lock — the
   * two processes never write concurrently, because the API does not exist while
   * setup is writing.
   *
   * ── WHY `setupState` STAYS `not_started` ───────────────────────────────────
   * The operator has stated an INTENT, not completed an install. Marking it
   * `setup_done` here would make the API's own provisioning think it had nothing
   * to do — no migrations, no seed, no admin — and would make a retry skip the
   * wizard on a node whose database was never actually built. The API flips it
   * to `setup_done` once provisioning succeeds, which is the only moment it is
   * true.
   */
  private persist(input: unknown): void {
    const existing = this.nodeConfig.find();
    // The operator's explicit URL wins; otherwise fall back to a database the
    // compose profile PROVIDED (`MANAGED_GLOBAL_DB_*`). Both mean "use this
    // database"; only the source differs.
    const databaseUrl = this.databaseUrlFrom(input) ?? this.managedDatabaseUrl();

    this.nodeConfig.upsert({
      nodeId: existing?.nodeId ?? crypto.randomUUID(),
      strategy: existing?.strategy ?? "local",
      setupState: existing?.setupState ?? "not_started",
      // Cosmetic version stamp: it records which build wrote the row. Left
      // undefined rather than invented — this app does not ship the version
      // resolver (that lives with the API's build metadata), and a made-up
      // value would be worse than an absent one.
      deployerVersion: existing?.deployerVersion,
      // The operator's chosen database. `null` means "provision one for me",
      // which is a legitimate answer — the API's provisioner handles it.
      databaseUrl,
      // An operator-supplied URL is externally managed; a URL we will provision
      // is not. Recording the distinction here is what stops the API's global-db
      // supervisor from trying to supervise a database it does not own.
      databaseProvisioning: databaseUrl === null ? "local" : "external",
      configuredAt: existing?.configuredAt ?? null,
      meshUrlsSnapshot: existing?.meshUrlsSnapshot ?? [],
      meshSharedSecret: existing?.meshSharedSecret,
      meshSharedSecretUpdatedAt: existing?.meshSharedSecretUpdatedAt,
      peerServiceToken: existing?.peerServiceToken,
      peerServiceTokenExpiresAt: existing?.peerServiceTokenExpiresAt,
      upgradedAtVersion: existing?.upgradedAtVersion,
      postSetupFlags: existing?.postSetupFlags,
      updatedAt: new Date().toISOString(),
    });

    this.logger.log(
      `Choices persisted (databaseUrl=${databaseUrl === null ? "provision" : "provided"})`,
    );
  }

  /**
   * Extract the database URL from the trigger payload.
   *
   * Read defensively but NOT silently coerced: the payload is the wizard's own
   * output, and `existingDatabaseUrl` is optional by contract (`undefined`
   * meaning "provision one"). Anything that is not a non-empty string is treated
   * as absent rather than passed through as a malformed URL, which the API would
   * fail on with a driver error far from the actual mistake.
   */
  private databaseUrlFrom(input: unknown): string | null {
    if (typeof input !== "object" || input === null) return null;
    const candidate = (input as { existingDatabaseUrl?: unknown }).existingDatabaseUrl;
    if (typeof candidate !== "string") return null;
    const trimmed = candidate.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  /**
   * The database the API should use when the operator PROVIDED nothing.
   *
   * `MANAGED_GLOBAL_DB_*` is how a compose profile hands the platform a
   * Postgres it manages itself (dev does exactly that). It is not an operator
   * choice, so it is not part of the wizard's payload — but it IS the URL the
   * API must read, and this is the one place that knows both.
   *
   * Returns `null` when nothing is configured, which is the honest answer: the
   * API then provisions its own.
   */
  managedDatabaseUrl(): string | null {
    const url = this.env.get("MANAGED_GLOBAL_DB_URL");
    return typeof url === "string" && url.trim().length > 0 ? url.trim() : null;
  }
}
