import { Injectable, Logger, type OnApplicationBootstrap } from "@nestjs/common";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";

import { EnvService } from "@/config/env/env.module";
import { SetupPhaseService } from "@/modules/health/setup-phase.service";

/**
 * The gate that decides when the API may start.
 *
 * ── WHAT THE GATE IS ────────────────────────────────────────────────────────
 * `GET /setup/health` is the compose healthcheck on this app, and compose starts
 * the API *behind* it (`depends_on: setup: service_healthy`). So "setup is
 * healthy" means exactly **"the API may start"** — and this service is the only
 * thing that opens it.
 *
 * ── WHY IT OPENS ON THE TRIGGER, NOT ON THE API BEING GREEN ─────────────────
 * An earlier design gated on the API's readiness. That is a cycle: compose starts
 * the API behind this healthcheck, so setup cannot wait for the API before
 * reporting healthy. The escape would be starting the API early in a degraded
 * mode — which is the arrangement this refactor deleted.
 *
 * Opening on the trigger keeps the dependency a straight line
 * (`setup → api → web`) and gives the gate an honest meaning: the operator has
 * supplied everything the API needs, so the API's boot has a database URL to
 * read.
 *
 * ── WHY IT PERSISTS BEFORE OPENING ──────────────────────────────────────────
 * The gate's meaning is "the API may start", and the API starts by reading
 * `node_config.databaseUrl`. Opening the gate before that row exists would start
 * an API that immediately finds nothing and reports not-ready — a gate that lies
 * about what it guarantees. So the choices are written first, then the gate
 * opens.
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
      this.logger.log(
        existing === null
          ? "No previous setup found — the wizard will collect the details"
          : `Setup state is "${existing.setupState}" — the wizard will collect the details`,
      );
      return;
    }

    this.logger.log("Setup already completed on this node — opening the gate without the wizard");
    this.open(undefined);
  }

  /**
   * Open the gate: persist the operator's choices, then publish `launching`.
   *
   * Awaited by the controller BEFORE it forwards `/setup/trigger`, because the
   * forward is the call that needs the API to exist. See the controller for why
   * that order is forced.
   */
  async open(input: unknown): Promise<void> {
    if (this.phases.isReady()) {
      // Idempotent: a double-click, a retry after a partial failure, or a
      // replayed request must all converge. Re-persisting is harmless (the write
      // is an upsert) but re-publishing would emit a spurious transition.
      this.logger.log("Gate is already open — keeping the persisted choices");
      return;
    }

    // Persist FIRST: the gate's promise is "the API will find what it needs".
    const completed = this.nodeConfig.find()?.setupState === "setup_done";
    if (!completed) {
      this.persist(input);
    }

    // Retained for the handover to deliver once the API is reachable. On a
    // restart there is nothing to deliver — the API re-provisions from the
    // persisted row and the idempotency of migrate/seed.
    this.pendingTrigger = completed ? null : input;

    this.phases.record(
      "launching",
      completed
        ? "Setup already complete — the platform API may start"
        : "Setup details collected — the platform API may now start",
    );
    this.logger.log("🚪 Gate OPEN — compose may start the API");
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
