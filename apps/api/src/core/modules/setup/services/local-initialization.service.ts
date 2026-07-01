import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import type { Logger } from "drizzle-orm/logger";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { Roles } from "@repo/auth/permissions";
import type { SetupInitializeLocalInput } from "@repo/contracts-entities";
import * as globalSchema from "@/config/drizzle/global/schema";
import { member, organization, user } from "@/config/drizzle/global/schema/auth";
import { PostgresContainerService } from "@/core/modules/docker/containers/postgres/postgres-container.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import { generateMeshSharedSecret } from "@repo/auth/mesh";
import { NodeConfigRepository } from "../repositories/node-config.repository";
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

/**
 * Local bootstrap flow.
 *
 * Owns the business logic of bringing a fresh node online:
 *  1. Provision a Postgres database (existing URL or new Docker
 *     container).
 *  2. Verify the database is empty.
 *  3. Apply Drizzle migrations.
 *  4. Seed the initial admin user + organization.
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
        private readonly postgresContainerService: PostgresContainerService,
        private readonly dockerService: DockerService,
        private readonly nodeConfigRepository: NodeConfigRepository,
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

        const databaseUrl = await runStep(tracker, emit, "provision_database", "Set up the database", async (stepLog) => {
            if (input.existingDatabaseUrl?.trim()) {
                stepLog("▸ Using existing database URL");
                stepLog(`  host = ${redactUrl(input.existingDatabaseUrl.trim())}`);
                stepLog("▸ Opening probe connection (max 1 client)…");
                return await this.probeExistingDatabase(input.existingDatabaseUrl.trim(), stepLog);
            }
            stepLog("▸ Bootstrapping Docker Postgres 16…");
            stepLog("  image  = postgres:16-alpine");
            stepLog("  volume = deployer_postgres_data");
            stepLog("  port   = 5432 (host-assigned)");
            stepLog("▸ Pulling image (cached if present)…");
            return await this.provisionDockerDatabase(stepLog);
        });
        const readyLine = `✅ Container ready at ${redactUrl(databaseUrl)}`;
        tracker.log("provision_database", readyLine);
        const readyEvent = tracker.logEvent("provision_database", readyLine);
        if (readyEvent) emit(readyEvent);

        await runStep(tracker, emit, "ensure_empty", "Ensure database is empty", async (stepLog) => {
            stepLog("▸ Querying information_schema.tables …");
            stepLog("  schema = public");
            stepLog("  type   = BASE TABLE");
            const existingTables = await this.ensureDatabaseEmpty(databaseUrl);
            if (existingTables.length === 0) {
                stepLog("  result = 0 tables");
                stepLog("✅ Database is empty");
            } else {
                stepLog(`  result = ${String(existingTables.length)} tables`);
                stepLog(`  tables = ${existingTables.join(", ")}`);
                stepLog("✅ Database verified");
            }
        });

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
            stepLog(`▸ Creating organization "${input.organizationName}"…`);
            stepLog("▸ Linking owner membership…");
            const seedResult = await this.seedInitialData(databaseUrl, input, stepLog);
            stepLog(`✅ User ${input.email} created with super-admin role`);
            stepLog(`  user.id  = ${seedResult.userId}`);
            stepLog(`✅ Organization "${input.organizationName}" created`);
            stepLog(`  org.id   = ${seedResult.organizationId}`);
            stepLog(`  org.slug = ${seedResult.organizationSlug}`);
            stepLog("✅ Admin membership linked");
        });

        await runStep(tracker, emit, "register_node", "Register this node", (stepLog) => {
            stepLog(`▸ Assigning node ID ${nodeId}…`);
            stepLog("  strategy = local");
            stepLog("  mesh     = (none)");
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
                meshSharedSecret,
                meshSharedSecretUpdatedAt: now,
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
            stepLog("  node       = registered");
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
        // create a database namespace inside it instead of a new container.
        // This keeps database isolation without spawning many containers.
        const sharedUri = process.env[LocalInitializationService.SHARED_PG_ENV];
        if (sharedUri) {
            log("detected E2E_SHARED_POSTGRES_CONNECTION_URI — using namespace mode");
            return await this.provisionDatabaseNamespace(sharedUri, log);
        }

        // Production / no shared Postgres: create a new container as before.
        log("no shared Postgres URI — creating a dedicated Docker container");
        log("calling docker.createContainer …");
        const container = await this.postgresContainerService.startPostgresContainer();
        log(`container.id = ${container.id}`);
        log(`container.name = ${container.name ?? "(unnamed)"}`);

        // Replay tail of container logs to give the user some startup context
        // before we attach the live log stream.
        log("▸ Replaying last 30 lines of container output …");
        const initialLogs = await this.dockerService.getContainerLogs(container.id, {
            stdout: true,
            stderr: true,
            tail: 30,
        });
        const initialLines = initialLogs
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean);
        if (initialLines.length === 0) {
            log("  (no prior output)");
        } else {
            for (const line of initialLines) {
                log(line);
            }
        }

        // Attach the live log stream so the user can see Postgres booting.
        log("▸ Attaching to live container log stream …");
        const liveStream = this.dockerService.streamContainerLogs$(container.id, {
            stdout: true,
            stderr: true,
            tail: 0,
        });
        const liveSubscription = liveStream.subscribe({
            next: (line) => {
                const trimmed = line.trim();
                if (trimmed.length > 0) log(trimmed);
            },
            error: (err: unknown) => {
                const msg = err instanceof Error ? err.message : String(err);
                log(`log stream error: ${msg}`);
            },
        });

        // Use Docker's built-in HEALTHCHECK instead of polling SELECT 1
        log("▸ Waiting for Docker HEALTHCHECK (up to 30 × 2s) …");
        const healthy = await this.dockerService.waitForContainerHealth(container.id, 30, 2000);
        if (!healthy) {
            liveSubscription.unsubscribe();
            throw new Error(`Postgres container ${container.id} failed health check after 30 attempts`);
        }
        log("HEALTHCHECK = healthy");

        const hostPort = await this.postgresContainerService.getMappedPort(container.id, 5432);
        // From inside the API Docker container, `127.0.0.1` resolves to the
        // container's own loopback — NOT the host where the Postgres port is
        // mapped. Resolve the default gateway (the Docker host) instead.
        const hostIp = resolveDockerHostIp();
        const connectionString = `postgres://deployer:deployer@${hostIp}:${String(hostPort)}/deployer`;
        log(`host port = ${String(hostPort)}`);
        log(`host IP   = ${hostIp}`);
        log(`dsn       = ${redactUrl(connectionString)}`);

        // Docker HEALTHCHECK uses pg_isready (Unix socket) which can pass before
        // Postgres accepts TCP connections. Probe with a real TCP connection to
        // avoid ECONNREFUSED on the first migration/seed query.
        log("▸ Probing TCP with SELECT 1 …");
        await this.waitForPostgres(connectionString, log);
        log("Postgres is accepting TCP connections");

        // Stop streaming — Postgres is now idle.
        liveSubscription.unsubscribe();
        log("log stream detached");

        return connectionString;
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
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        try {
            const res = await pool.query<{
                table_name: string
            }>(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
            `);
            const tables = res.rows.map((r) => r.table_name);
            if (tables.length > 0) {
                throw new Error(`Database is not empty. Found tables: ${tables.join(", ")}`);
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
        const migrationLogger: Logger = {
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
    ): Promise<{ userId: string; organizationId: string; organizationSlug: string }> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        const db = drizzle(pool, { schema: globalSchema });
        const userId = randomUUID();
        const organizationId = randomUUID();
        const memberId = randomUUID();
        const accountId = randomUUID();
        const now = new Date();
        const slug = slugify(input.organizationName);
        log(`generated user.id      = ${userId}`);
        log(`generated org.id       = ${organizationId}`);
        log(`generated member.id    = ${memberId}`);
        log(`generated account.id   = ${accountId}`);
        log(`slug                   = ${slug}`);

        const passwordHash = await hashPassword(input.password);
        log("bcrypt hash computed");

        try {
            log("INSERT user …");
            await db.insert(user).values({
                id: userId, name: input.name, email: input.email,
                emailVerified: true, role: Roles.superAdmin,
                createdAt: now, updatedAt: now,
            });
            log("  user row written");

            log("INSERT account …");
            await db.insert(globalSchema.account).values({
                id: accountId, accountId: input.email,
                providerId: "credentials", userId,
                password: passwordHash, createdAt: now, updatedAt: now,
            });
            log("  account row written");

            log("INSERT organization …");
            await db.insert(organization).values({
                id: organizationId, name: input.organizationName,
                slug, createdAt: now, metadata: null,
            });
            log("  organization row written");

            log("INSERT member …");
            await db.insert(member).values({
                id: memberId, organizationId, userId,
                role: "owner", createdAt: now,
            });
            log("  member row written");
        } finally {
            await pool.end().catch(() => undefined);
        }
        return {
            userId,
            organizationId,
            organizationSlug: slug,
        };
    }
}
