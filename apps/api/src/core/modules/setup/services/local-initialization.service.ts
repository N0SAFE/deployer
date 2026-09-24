import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Logger as DrizzleLogger } from "drizzle-orm/logger";
import { fileURLToPath } from "node:url";
import { eq } from "drizzle-orm";
import { Roles } from "@repo/auth/permissions";
import type { SetupInitializeLocalInput } from "@repo/contracts-entities";
import * as globalSchema from "@repo/nest-schema/global";
import { user } from "@repo/nest-schema/global/auth";
import { createBetterAuth } from "@/config/auth/auth";
import {
    PostgresServiceProvisioner,
    MANAGED_POSTGRES_ALIAS,
    MANAGED_POSTGRES_PORT,
    MANAGED_POSTGRES_VOLUME_NAME,
    managedPostgresServiceName,
    resolvePostgresIdentity,
} from "@/core/modules/docker/containers/postgres/postgres-service.provisioner";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
    platformNetworkName,
    platformOverlayNetworkName,
} from "@/core/modules/docker/services/docker-supervisor-runtime";
import { EnvService } from "@/config/env/env.module";
import { SwarmBootstrapService } from "@/core/modules/swarm/services/swarm-bootstrap.service";
import { SwarmClusterService } from "@/core/modules/swarm/services/swarm-cluster.service";
import { SupervisorOrchestratorService } from "@repo/nest-supervisor-core/supervisor-orchestrator.service";
import { SWARM_APP_WIRING_SUPERVISOR_ID } from "@/core/modules/supervisors/platform/swarm-app-wiring.supervisor.service";
import { generateMeshSharedSecret } from "@repo/auth/mesh";
import { NodeConfigRepository } from "@repo/nest-nodes/node-config.repository";
import {
    SetupStepTracker,
    listMigrationNames,
    redactUrl,
    runStep,
    slugify,
    type EmitEvent,
} from "../utils/setup-runner.utils";
import { resolveDockerHostIp } from "../utils/docker-host.utils";
import { DEPLOYER_VERSION } from "@/core/utils/deployer-version";

import { AppError, ConflictError } from "@repo/errors";
/**
 * Local bootstrap flow.
 *
 * Owns the business logic of bringing a fresh node online:
 *  1. Provision a Postgres database (existing URL, or a new SWARM SERVICE
 *     scheduled through `PostgresServiceProvisioner`).
 *  2. Verify the database is empty.
 *  3. Apply Drizzle migrations.
 *  4. Seed the initial admin user.
 *  5. Persist the node config.
 *  6. Finalize.
 *
 * The flow is a pure side-effecting pipeline: the orchestration layer
 * hands us a {@link SetupStepTracker} (state holder) and an
 * {@link EmitEvent} closure (already bound to the core event
 * service's `progress` channel). We walk the steps, mutating the
 * tracker and emitting events at every transition. We never create
 * our own subjects — the core event service already does buffering,
 * persistence and subject management.
 */
@Injectable()
export class LocalInitializationService {
    private readonly logger = new Logger(LocalInitializationService.name);

    /** The env var set by globalSetup (e2e) pointing at a shared Postgres. */
    private static readonly SHARED_PG_ENV = "E2E_SHARED_POSTGRES_CONNECTION_URI";

    constructor(
        private readonly postgresProvisioner: PostgresServiceProvisioner,
        private readonly dockerService: DockerService,
        private readonly env: EnvService,
        private readonly nodeConfigRepository: NodeConfigRepository,
        /**
         * FOUNDS the cluster. Provisioning Postgres as a SWARM SERVICE needs an
         * active swarm, so this runs BEFORE the database step — the previous
         * ordering called the provisioner while the engine was still inactive.
         */
        private readonly swarmBootstrap: SwarmBootstrapService,
        /** Read-back of the engine state for the setup stream's report. */
        private readonly swarmCluster: SwarmClusterService,
        /**
         * On-demand convergence of the app-wiring supervisor, so the overlay
         * attach below happens BEFORE the DSN is used rather than on the
         * supervisor's 30s cadence (see the call site).
         */
        private readonly supervisors: SupervisorOrchestratorService,
    ) {}

    /**
     * Run the full local bootstrap flow.
     *
     * Returns the final `nodeId` and `databaseUrl` so the orchestration
     * layer can emit the terminal `completed` event.
     */
    async initialize(
        input: SetupInitializeLocalInput,
        tracker: SetupStepTracker,
        emit: EmitEvent,
    ): Promise<{ nodeId: string; databaseUrl: string }> {
        const nodeId = randomUUID();

        // ── Database source resolution ───────────────────────────────────
        // 1. existingDatabaseUrl in the request → operator-supplied URL
        //    (the wizard's "Use an existing PostgreSQL database" path).
        // 2. Otherwise, a URL already persisted for this node as a SETUP
        //    CANDIDATE (compose-managed global DB via MANAGED_GLOBAL_DB_*,
        //    or a Phase-0 explicit URL) → the node was GIVEN a database, so
        //    initialization must target it ("select managed → use this
        //    node's provided DB") instead of provisioning another container.
        // 3. Otherwise → the API spawns its own Postgres container ("local",
        //    supervised by GlobalDbSupervisorService).
        const explicitUrl = input.existingDatabaseUrl?.trim() ?? "";

        const providedUrl = (() => {
            if (explicitUrl) return "";
            const cfg = this.nodeConfigRepository.find();
            const alreadyDone =
                cfg?.setupState === "setup_done" || Boolean(cfg?.configuredAt);
            if (
                !alreadyDone &&
                cfg?.databaseUrl?.trim() &&
                cfg.databaseProvisioning === "external"
            ) {
                return cfg.databaseUrl.trim();
            }
            return "";
        })();

        // Read ONCE at method scope: the swarm step founds the cluster from it,
        // `register_node` persists it, and `finalize` reports it — all three must
        // see the SAME operator choice.
        const swarmChoice = input.swarm;

        const databaseProvisioning =
            explicitUrl || providedUrl ? "external" : "local";

        // ── Swarm FIRST ────────────────────────────────────────────────────────
        // Locally-managed Postgres is a SWARM SERVICE, so the engine must be a
        // cluster BEFORE the database step runs. Founding it here (not in
        // `finalize`) is what removes the former deadlock: provisioning called
        // `createSwarmService` while the engine was still inactive.
        //
        // Skipped for an externally-provided URL: that node consumes someone
        // else's database and joins a fleet (which converges from the fleet's
        // grant), so it must not invent a cluster of its own.
        if (databaseProvisioning === "local") {
            await runStep(tracker, emit, "initialize_swarm", "Create the Swarm cluster", async (stepLog) => {
                stepLog("▸ Initializing Docker Swarm…");
                stepLog(`  mode    = ${swarmChoice?.mode ?? "create"}`);
                stepLog(`  policy  = ${swarmChoice?.policy ?? "auto"}`);
                if (swarmChoice?.advertiseAddr) {
                    stepLog(`  advertise = ${swarmChoice.advertiseAddr}`);
                }
                if (swarmChoice?.joinAddrs?.length) {
                    stepLog(`  join    = ${swarmChoice.joinAddrs.join(", ")}`);
                }

                // PERSIST THE OPERATOR'S CHOICE BEFORE CONVERGING.
                // `converge()` resolves the participation from
                // `node_config.swarmConfig` (SwarmParticipationService
                // .effectiveConfig), NOT from the request — so without this the
                // engine would converge from env defaults and a wizard choice of
                // `join` would be silently ignored, founding a cluster the
                // operator explicitly did not ask for. `register_node` writes the
                // same values later; this earlier write is what makes the DECISION
                // authoritative at the moment it is acted on.
                const cfg = this.nodeConfigRepository.find();
                const nowIso = new Date().toISOString();
                this.nodeConfigRepository.upsert({
                    ...(cfg ?? {}),
                    nodeId,
                    strategy: "local",
                    // Not `setup_done` yet — setup is still running; this row is
                    // completed by `register_node` below.
                    setupState: cfg?.setupState ?? "not_started",
                    deployerVersion: DEPLOYER_VERSION,
                    swarmConfig: {
                        mode: swarmChoice?.mode ?? "create",
                        policy: swarmChoice?.policy ?? "auto",
                        advertiseAddr: swarmChoice?.advertiseAddr ?? null,
                        joinToken: swarmChoice?.joinToken ?? null,
                        joinAddrs: swarmChoice?.joinAddrs ?? [],
                    },
                    updatedAt: nowIso,
                });
                stepLog("  → participation persisted (node_config.swarmConfig)");

                await this.swarmBootstrap.converge("setup");
                const snapshot = await this.swarmCluster.getLocalClusterSnapshot();

                if (snapshot.localNodeState !== "active") {
                    // A service-based database CANNOT be provisioned without a
                    // swarm, so this is fatal for the local path — surface it
                    // now rather than failing later with a confusing engine error.
                    throw new AppError(
                        `Swarm cluster did not become active (state=${snapshot.localNodeState}); ` +
                            "a locally-managed Postgres is scheduled as a swarm service and cannot be provisioned without it",
                        "SWARM_UNAVAILABLE",
                        { localNodeState: snapshot.localNodeState },
                    );
                }

                stepLog("✅ Swarm cluster active");
                stepLog(`  role    = ${snapshot.localNode.swarmRole}`);
                stepLog(`  master  = ${snapshot.master?.nodeId ?? "self"}`);
                stepLog(`  nodes   = ${String(snapshot.nodeCount)} (managers ${String(snapshot.managerCount)})`);
            });
        }

        const databaseUrl = await runStep(tracker, emit, "provision_database", "Set up the database", async (stepLog) => {
            if (explicitUrl) {
                stepLog("▸ Using database URL supplied in the setup request");
                stepLog(`  host = ${redactUrl(explicitUrl)}`);
                stepLog("▸ Opening probe connection (max 1 client)…");
                return await this.probeExistingDatabase(explicitUrl, stepLog);
            }
            if (providedUrl) {
                stepLog("▸ Using the database URL provided for this node (MANAGED_GLOBAL_DB_ENABLED / SETUP_AUTO)");
                stepLog(`  host = ${redactUrl(providedUrl)}`);
                stepLog("▸ Opening probe connection (max 1 client)…");
                return await this.probeExistingDatabase(providedUrl, stepLog);
            }
            stepLog("▸ Bootstrapping Docker Postgres 16…");
            stepLog("  image  = postgres:16-alpine");
            stepLog("  volume = deployer_postgres_data");
            stepLog("  port   = 5432 (host-assigned)");
            stepLog("▸ Pulling image (cached if present)…");
            return await this.provisionDockerDatabase(stepLog);
        });
        const readyLine = `✅ Database ready at ${redactUrl(databaseUrl)}`;
        tracker.log("provision_database", readyLine);
        const readyEvent = tracker.logEvent("provision_database", readyLine);
        if (readyEvent) emit(readyEvent);

        const existingTables = await runStep(tracker, emit, "ensure_empty", "Ensure database is empty", async (stepLog) => {
            stepLog("▸ Querying information_schema.tables …");
            stepLog("  schema = public");
            stepLog("  type   = BASE TABLE");
            const tables = await this.ensureDatabaseEmpty(databaseUrl);
            if (tables.length === 0) {
                stepLog("  result = 0 tables");
                stepLog("✅ Database is empty");
            } else {
                stepLog(`  result = ${String(tables.length)} tables`);
                stepLog(`  tables = ${tables.join(", ")}`);
                stepLog("✅ Database already initialized");
            }
            return tables;
        });

        // If the database was already initialized (tables exist), skip migration and seed
        if (existingTables.length === 0) {
            await runStep(tracker, emit, "run_migrations", "Run migrations", async (stepLog) => {
                const migrationsFolder = fileURLToPath(
                    new URL("../../../../config/drizzle/global/migrations", import.meta.url),
                );
                const migrationNames = listMigrationNames(migrationsFolder);
                stepLog(`▸ Migration folder: ${migrationsFolder}`);
                stepLog(`▸ Found ${String(migrationNames.length)} migration file(s):`);
                for (const [i, name] of migrationNames.entries()) {
                    stepLog(`  [${String(i + 1).padStart(2, "0")}/${String(migrationNames.length)}] ${name}`);
                }
                stepLog("▸ Handing off to drizzle migrator (every statement will be streamed below)…");
                await this.runMigrations(databaseUrl, migrationsFolder, stepLog);
                stepLog(`✅ All ${String(migrationNames.length)} migration(s) applied successfully`);
            }, "Connecting to the database and applying every Drizzle migration one statement at a time.");

            await runStep(tracker, emit, "seed_initial_data", "Initialize workspace data", async (stepLog) => {
                stepLog(`▸ Creating super-admin user: ${input.email}`);
                stepLog("  name  = " + input.name);
                stepLog("  role  = super-admin");
                stepLog("▸ Hashing password (bcrypt, cost 12)…");
                stepLog("▸ Inserting user record…");
                stepLog("▸ Inserting credentials account…");
                const seedResult = await this.seedInitialData(databaseUrl, input, stepLog);
                stepLog(`✅ User ${input.email} created with super-admin role`);
                stepLog(`  user.id  = ${seedResult.userId}`);
            });
        } else {
            this.logger.log("⏭️  Database already initialized — skipping migration and seed steps");
        }

        await runStep(tracker, emit, "register_node", "Register this node", (stepLog) => {
            stepLog(`▸ Assigning node ID ${nodeId}…`);
            stepLog("  strategy = local");
            stepLog("  mesh     = (none)");
            stepLog("  database = " + (databaseProvisioning === "local" ? "locally managed (supervised)" : "external (provided URL)"));
            if (swarmChoice) {
                stepLog(
                    `  swarm    = ${swarmChoice.mode ?? "create"} cluster (policy=${swarmChoice.policy ?? "auto"})`,
                );
            }
            stepLog("▸ Generating mesh shared secret…");
            const meshSharedSecret = generateMeshSharedSecret();
            stepLog("▸ Persisting node config to global database…");
            const now = new Date().toISOString();
            this.nodeConfigRepository.upsert({
                nodeId,
                strategy: "local",
                setupState: "setup_done",
                deployerVersion: DEPLOYER_VERSION,
                meshUrlsSnapshot: [],
                configuredAt:     now,
                updatedAt:        now,
                databaseUrl,
                databaseProvisioning,
                meshSharedSecret,
                meshSharedSecretUpdatedAt: now,
                swarmConfig: swarmChoice
                    ? {
                          mode: swarmChoice.mode ?? "create",
                          policy: swarmChoice.policy ?? "auto",
                          advertiseAddr: swarmChoice.advertiseAddr ?? null,
                          joinToken: swarmChoice.joinToken ?? null,
                          joinAddrs: swarmChoice.joinAddrs ?? [],
                      }
                    : undefined,
            });
            stepLog("✅ Node config persisted");
        });

        await runStep(tracker, emit, "finalize", "Finalize setup", async (stepLog) => {
            stepLog("▸ Marking setup as completed…");
            stepLog(`  nodeId  = ${nodeId}`);
            stepLog(`  dbUrl   = ${redactUrl(databaseUrl)}`);
            stepLog("▸ Generating readiness summary…");
            stepLog("  database  = ready");
            stepLog("  migrations = applied");
            stepLog("  workspace  = seeded");

            // ── Swarm summary — the LAST step always reports the cluster
            // outcome, so the operator sees the decision they made (create +
            // policy, or join + the fleet's granted role) in the same stream
            // that ran the setup. Reported from the LIVE engine snapshot rather
            // than the earlier step's result, so a cluster that degraded since
            // is reported honestly instead of echoing a stale success.
            stepLog("▸ Swarm summary…");
            const swarmSnapshot = await this.swarmCluster.getLocalClusterSnapshot();
            if (swarmSnapshot.localNodeState === "active") {
                stepLog("✅ Swarm cluster active");
                stepLog(`  mode    = ${swarmChoice?.mode ?? "create"}`);
                stepLog(`  policy  = ${swarmChoice?.policy ?? "auto"}`);
                stepLog(`  role    = ${swarmSnapshot.localNode.swarmRole}`);
                stepLog(`  master  = ${swarmSnapshot.master?.nodeId ?? "self"}`);
                stepLog(`  nodes   = ${String(swarmSnapshot.nodeCount)} (managers ${String(swarmSnapshot.managerCount)})`);
                stepLog("  → every platform service is scheduled on Swarm");
            } else {
                stepLog(`⚠️  Swarm not active (state=${swarmSnapshot.localNodeState})`);
                stepLog("  → re-converge from the Cluster page");
            }

            stepLog("✅ Setup complete");
        });

        return { nodeId, databaseUrl };
    }

    // ─── Database helpers ─────────────────────────────────────────────────────

    private async probeExistingDatabase(
        databaseUrl: string,
        log: (message: string) => void,
    ): Promise<string> {
        const t0 = Date.now();
        const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
        try {
            log("dispatching SELECT 1 …");
            await pool.query("SELECT 1");
            log(`reply received in ${String(Date.now() - t0)} ms`);
            return databaseUrl;
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private async provisionDockerDatabase(
        log: (message: string) => void,
    ): Promise<string> {
        // If a shared Postgres URI is available (e.g., from e2e globalSetup),
        // create a database namespace inside it instead of a new service.
        // This keeps database isolation without spawning many services.
        const sharedUri = process.env[LocalInitializationService.SHARED_PG_ENV];
        if (sharedUri) {
            log("detected E2E_SHARED_POSTGRES_CONNECTION_URI — using namespace mode");
            return await this.provisionDatabaseNamespace(sharedUri, log);
        }

        // The global database is a SWARM SERVICE — the same object the
        // GlobalDbSupervisorService converges for the rest of the platform's
        // life, built from the same spec builder and the same credential
        // resolver, so setup and the supervisor can never drift into two
        // different Postgres instances (or two different credential sets).
        log("▸ Scheduling the global Postgres as a swarm service …");
        const prefix = this.env.get("DEPLOYER_PREFIX");
        const serviceName = managedPostgresServiceName(prefix);
        const identity = resolvePostgresIdentity(this.env);
        log(`  service = ${serviceName}`);
        log(`  image   = ${identity.image}`);
        log(`  volume  = ${MANAGED_POSTGRES_VOLUME_NAME}`);
        log(`  user    = ${identity.username}`);
        log(`  db      = ${identity.databaseName}`);
        log("  port    = 5432 (host mode, node-local)");

        const spec = await this.postgresProvisioner.ensure({ prefix, identity });
        log(`✅ Service ${spec.name} has a running task`);

        // ── Attach THIS container to the overlay BEFORE using the DSN ──────
        // The DSN below addresses the database by its overlay alias
        // (`global-db`), which only resolves for containers attached to the
        // overlay. `SwarmAppWiringSupervisorService` does that wiring, but it
        // converges on a 30s CADENCE — so on a fresh setup the probe below
        // could run first and fail with `getaddrinfo ENOTFOUND global-db` even
        // though the database was healthy (observed: wiring at 3:55:06, probe
        // failure at 3:54:54). Converging it ON DEMAND here removes the race:
        // the dependency is established before it is used, not eventually.
        //
        // The supervisor is the canonical owner of this concern (it resolves
        // the aliases, handles the stale-endpoint re-attach case, and skips
        // cleanly when the engine is not swarm-active), so this triggers its
        // idempotent reconcile rather than duplicating the network call here.
        await this.supervisors.convergeNow(SWARM_APP_WIRING_SUPERVISOR_ID);
        log("▸ Wired this container onto the platform overlay (global-db resolvable)");

        // Replay the task logs so the user sees Postgres booting.
        log("▸ Replaying recent service output …");
        const initialLogs = await this.dockerService.getSwarmServiceLogs(spec.name, {
            stdout: true,
            stderr: true,
            tail: 30,
        });
        const initialLines = initialLogs
            .split("\n")
            .map((line) => line.trim())
            .filter(Boolean);
        if (initialLines.length === 0) {
            log("  (no prior output)");
        } else {
            for (const line of initialLines) log(line);
        }

        // DNS name of the database on the platform overlay — every consumer
        // (this API included, once it is attached to the overlay) resolves it.
        // The DSN is assembled from the SAME identity the service was created
        // with, so the credentials can never disagree with the cluster.
        const { username, password, databaseName } = identity;
        const url = `postgresql://${encodeURIComponent(username)}:${encodeURIComponent(password)}@${MANAGED_POSTGRES_ALIAS}:${String(MANAGED_POSTGRES_PORT)}/${databaseName}`;
        log(`✅ Database ready at postgresql://${username}:***@${MANAGED_POSTGRES_ALIAS}:${String(MANAGED_POSTGRES_PORT)}/${databaseName}`);
        return url;
    }

    private async provisionDatabaseNamespace(
        sharedUri: string,
        log: (message: string) => void,
    ): Promise<string> {
        const adminUrl = this.buildAdminDatabaseUrl(sharedUri);
        const databaseName = `deployer_bootstrap_${randomUUID().replace(/-/g, "").slice(0, 8)}`;

        log(`target database = ${databaseName}`);
        log(`admin URL       = ${redactUrl(adminUrl)}`);

        const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
        try {
            log("▸ Probing shared Postgres admin endpoint …");
            await this.waitForPostgres(adminUrl, log);

            const escapedName = `"${databaseName.replaceAll('"', '""')}"`;
            log(`▸ CREATE DATABASE ${escapedName} …`);
            await adminPool.query(`CREATE DATABASE ${escapedName}`);
            log("  database created");
        } finally {
            await adminPool.end().catch(() => undefined);
        }

        const parsed = new URL(sharedUri);
        parsed.pathname = `/${databaseName}`;
        log(`namespace ready at ${parsed.hostname}:${parsed.port}${parsed.pathname}`);
        return parsed.toString();
    }

    private buildAdminDatabaseUrl(connectionUri: string): string {
        const parsed = new URL(connectionUri);
        if (parsed.hostname === "localhost") {
            parsed.hostname = "127.0.0.1";
        }
        parsed.pathname = "/postgres";
        return parsed.toString();
    }

    private async waitForPostgres(
        connectionString: string,
        log?: (message: string) => void,
    ): Promise<void> {
        const maxRetries = 30;
        const baseDelay = 1_000;
        let lastError: Error | undefined;
        for (let attempt = 1; attempt <= maxRetries; attempt++) {
            const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 3_000 });
            try {
                await pool.query("SELECT 1");
                return;
            } catch (err: unknown) {
                lastError = err instanceof Error ? err : new Error(String(err));
                if (lastError.message.includes("does not exist")) {
                    throw lastError;
                }
                const msg = `Postgres not ready (attempt ${String(attempt)}/${String(maxRetries)}): ${lastError.message}`;
                this.logger.debug(msg);
                log?.(msg);
            } finally {
                await pool.end().catch(() => undefined);
            }
            await new Promise((r) => setTimeout(r, baseDelay * attempt));
        }
        throw lastError ?? new Error("Timed out waiting for Postgres to become ready");
    }

    private async ensureDatabaseEmpty(databaseUrl: string): Promise<string[]> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1, connectionTimeoutMillis: 5_000 });
        try {
            const res = await pool.query<{
                table_name: string
            }>(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
            `);
            const tables = res.rows.map((r) => r.table_name);
            // If tables exist, check if the database was already initialized
            // (has __drizzle_migrations or schema_version). If so, this is a
            // container reuse — not a fresh database. Let the flow proceed.
            if (tables.length > 0) {
                const hasMigrations = tables.includes('__drizzle_migrations') || tables.includes('schema_version');
                if (hasMigrations) {
                    // Database was already initialized — allow proceeding
                    this.logger.log(`Database already initialized (${tables.length} tables found) — skipping fresh setup`);
                } else {
                    // Tables exist but no migration tracking — this is a leftover database, block
                    throw new ConflictError(`Database is not empty. Found tables: ${tables.join(", ")}`);
                }
            }
            return tables;
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private async runMigrations(
        databaseUrl: string,
        migrationsFolder: string,
        log: (message: string) => void,
    ): Promise<void> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        // Custom logger pipes every SQL statement Drizzle executes — including
        // each migration's CREATE TABLE / CREATE INDEX / ALTER / DO blocks,
        // plus the migrator's own bookkeeping queries against
        // drizzle.__drizzle_migrations — into the setup progress stream, so
        // the user can watch every single statement land instead of staring
        // at a silent spinner.
        //
        // Each statement is emitted on its own line (multi-line SQL preserved
        // with leading indentation), with bound parameters attached when
        // present. No truncation — the stream buffers everything.
        const migrationLogger: DrizzleLogger = {
            logQuery: (query: string, params: unknown[]) => {
                // Collapse only leading/trailing whitespace per line; keep
                // statement structure intact (e.g. multi-line DO $$ ... $$).
                const formatted = query
                    .split("\n")
                    .map((line) => line.replace(/\s+$/, ""))
                    .filter((line, idx, arr) => !(line === "" && (idx === 0 || arr[idx - 1] === "")))
                    .join("\n");
                const indented = formatted
                    .split("\n")
                    .map((line) => (line.length > 0 ? `    ${line}` : line))
                    .join("\n");
                log(indented);
                if (params.length > 0) {
                    log(`    -- params: ${JSON.stringify(params)}`);
                }
            },
        };
        const db = drizzle(pool, { schema: globalSchema, logger: migrationLogger });
        try {
            log("acquiring pool connection");
            await pool.query("SELECT 1");
            log("acquired — handing off to drizzle migrator");
            const t0 = Date.now();
            await migrate(db, { migrationsFolder });
            log(`drizzle migrator returned in ${String(Date.now() - t0)} ms`);
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private async seedInitialData(
        databaseUrl: string,
        input: SetupInitializeLocalInput,
        log: (message: string) => void,
    ): Promise<{ userId: string }> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        const db = drizzle(pool, { schema: globalSchema });

        try {
            // Idempotent seed: if the admin already exists (e.g. two nodes
            // racing against a shared database, or a heal that left the DB
            // partially provisioned) never call signUpEmail a second time —
            // just promote the existing user to super-admin.
            log("▸ Checking whether the admin already exists…");
            const existing = await db
                .select({ id: user.id, role: user.role })
                .from(user)
                .where(eq(user.email, input.email))
                .limit(1);
            if (existing[0]) {
                log(`  user ${input.email} already exists — promoting to super-admin instead of re-seeding`);
                await db.update(user)
                    .set({ emailVerified: true, role: Roles.superAdmin })
                    .where(eq(user.id, existing[0].id));
                return { userId: existing[0].id };
            }

            // Create the super-admin user + credential account through the
            // Better Auth service-side API. This is the single source of truth
            // for user/account creation: Better Auth's internal adapter writes
            // the credential account with `issuer = createLocalAccountIssuer(
            // "credential")` ("local:credential") and hashes the password with
            // the configured algorithm. Hardcoding those values here would
            // drift from what Better Auth actually writes and break
            // sign-in/email (INVALID_EMAIL_OR_PASSWORD).
            log("▸ Creating Better Auth instance (service-side API)…");
            const { auth } = createBetterAuth(db, {
                DEV_AUTH_KEY: process.env.DEV_AUTH_KEY,
                DEFAULT_ADMIN_EMAIL: process.env.DEFAULT_ADMIN_EMAIL,
                NODE_ENV: process.env.NODE_ENV ?? "development",
                BETTER_AUTH_SECRET: process.env.BETTER_AUTH_SECRET ?? process.env.AUTH_SECRET,
                BASE_URL: process.env.NEXT_PUBLIC_API_URL,
                APP_URL: process.env.APP_URL,
                NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
                TRUSTED_ORIGINS: process.env.TRUSTED_ORIGINS,
                AUTH_BASE_DOMAIN: process.env.AUTH_BASE_DOMAIN,
            });

            log("▸ Calling auth.api.signUpEmail …");
            let userId: string;
            try {
                const signUpResult = await auth.api.signUpEmail({
                    body: {
                        name: input.name,
                        email: input.email,
                        password: input.password,
                    },
                });
                userId = signUpResult.user.id;
            } catch (seedError: unknown) {
                // Another node created the same admin concurrently (unique
                // email constraint) — recover by promoting the winner instead
                // of failing the whole setup.
                const message = seedError instanceof Error ? seedError.message : String(seedError);
                if (!/duplicate|already exists|unique/i.test(message)) throw seedError;
                log(`  concurrent seed detected (${message}) — promoting the existing user instead`);
                const raced = await db
                    .select({ id: user.id })
                    .from(user)
                    .where(eq(user.email, input.email))
                    .limit(1);
                const racedId = raced[0]?.id;
                if (!racedId) throw seedError;
                userId = racedId;
            }
            log(`  user.id  = ${userId}`);
            log("  user + credential account written (issuer handled by Better Auth)");

            log("▸ Promoting role to super-admin + marking email as verified …");
            await db.update(user)
                .set({ emailVerified: true, role: Roles.superAdmin })
                .where(eq(user.id, userId));
            log("  role = superAdmin, email_verified = true");

            return { userId };
        } finally {
            await pool.end().catch(() => undefined);
        }
    }
}

