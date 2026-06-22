import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import type { SetupStepId } from "@repo/contracts-entities";
import * as globalSchema from "@/config/drizzle/global/schema";
import { member, organization, user } from "@/config/drizzle/global/schema/auth";
import { Roles } from "@repo/auth/permissions";
import type { SetupStepEmitter } from "../services/setup-step-emitter";

/**
 * The full set of step IDs that the local flow walks. Imported by both
 * the service (for type-checking runStep calls) and the test (for
 * asserting step ordering).
 */
export const LOCAL_STEP_IDS = [
    "provision_database",
    "ensure_empty",
    "run_migrations",
    "seed_initial_data",
    "register_node",
    "finalize",
] as const satisfies readonly SetupStepId[];

export const REMOTE_STEP_IDS = [
    "mesh_handshake",
    "register_node",
    "finalize",
] as const satisfies readonly SetupStepId[];

export type LocalStepId = (typeof LOCAL_STEP_IDS)[number];
export type RemoteStepId = (typeof REMOTE_STEP_IDS)[number];

/**
 * Run a single step with automatic `start` / `complete` / `fail`
 * semantics. The body callback receives a `stepLog` helper that
 * attaches every line to this step. On error, the error message is
 * logged into the step and re-thrown so the orchestration layer can
 * dispatch the terminal `abort` event.
 *
 * Lives in utils (not the service) so the local and remote flows
 * share a single, well-tested implementation. The service stays
 * focused on the business logic of *what* the step does — the
 * mechanics of *how* to wrap that work in a step is plumbing.
 */
export async function runStep<S extends SetupStepId, T>(
    emitter: SetupStepEmitter,
    stepId: S,
    title: string,
    body: (log: (line: string) => void) => Promise<T>,
): Promise<T> {
    emitter.start(stepId, title);
    const stepLog = (line: string): void => emitter.log(stepId, line);
    try {
        const result = await body(stepLog);
        emitter.complete(stepId);
        return result;
    } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        stepLog(`❌ ${message}`);
        emitter.fail(stepId, message);
        throw err;
    }
}

/**
 * Redact a Postgres connection URL by replacing the password with
 * `***`. Used when emitting logs so credentials never end up in
 * the UI event stream.
 */
export function redactDatabaseUrl(url: string): string {
    try {
        const parsed = new URL(url);
        if (parsed.password) parsed.password = "***";
        return parsed.toString();
    } catch {
        return url.replace(/\/\/[^@]+@/, "//***:***@");
    }
}

/**
 * Read the Drizzle migration journal and return the ordered list of
 * migration tags. Falls back to a directory scan if the journal is
 * missing or unparseable.
 */
export function listMigrationNames(migrationsFolder: string): string[] {
    try {
        const journalPath = join(migrationsFolder, "meta", "_journal.json");
        const journal = JSON.parse(readFileSync(journalPath, "utf8")) as {
            entries?: { tag?: string }[];
        };
        if (Array.isArray(journal.entries)) {
            return journal.entries
                .map((e) => e.tag)
                .filter((tag): tag is string => typeof tag === "string");
        }
    } catch {
        // fall through to filesystem scan
    }
    try {
        return readdirSync(migrationsFolder)
            .filter((f) => f.endsWith(".sql"))
            .sort();
    } catch {
        return [];
    }
}

/**
 * The env var set by globalSetup (e2e) pointing to the shared Postgres
 * instance. When set, the local flow creates a database namespace
 * inside it instead of a new container — this keeps database isolation
 * without spawning many containers.
 */
export const SHARED_PG_ENV = "E2E_SHARED_POSTGRES_CONNECTION_URI";

/**
 * Build a `postgres://…@host:port/postgres` URL suitable for admin
 * operations (CREATE DATABASE etc) on a shared instance. Rewrites
 * `localhost` to `127.0.0.1` because we want IPv4 resolution.
 */
export function buildAdminDatabaseUrl(connectionUri: string): string {
    const parsed = new URL(connectionUri);
    if (parsed.hostname === "localhost") {
        parsed.hostname = "127.0.0.1";
    }
    parsed.pathname = "/postgres";
    return parsed.toString();
}

/**
 * Wait for a Postgres instance to accept a TCP `SELECT 1`. The Docker
 * `HEALTHCHECK` (which uses `pg_isready` over the unix socket) can
 * pass before TCP listeners are up, so we always probe with a real
 * client connection before continuing.
 */
export async function waitForPostgres(
    connectionString: string,
    options: { log?: (line: string) => void; maxRetries?: number; baseDelayMs?: number } = {},
): Promise<void> {
    const maxRetries = options.maxRetries ?? 30;
    const baseDelay = options.baseDelayMs ?? 1_000;
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
            options.log?.(
                `Postgres not ready (attempt ${String(attempt)}/${String(maxRetries)}): ${lastError.message}`,
            );
        } finally {
            await pool.end().catch(() => undefined);
        }
        await new Promise((r) => setTimeout(r, baseDelay * attempt));
    }
    throw lastError ?? new Error("Timed out waiting for Postgres to become ready");
}

/**
 * Resolve the IP address used to reach the Docker host from inside
 * this container. When the API runs inside a Docker container,
 * `127.0.0.1` refers to the container itself, not the host.
 * Host-published ports (e.g. a freshly provisioned Postgres container)
 * are reachable via the default gateway IP. We read that gateway from
 * `/proc/net/route`, where the default route's gateway is stored as
 * a little-endian hex string.
 *
 * Falls back to `127.0.0.1` when:
 * - The process is not running inside a container (no `/proc/net/route`
 *   for the docker interface, or default route on the host network).
 * - The route file cannot be read for any reason.
 */
export function resolveDockerHostIp(): string {
    try {
        const route = readFileSync("/proc/net/route", "utf8");
        for (const line of route.split("\n").slice(1)) {
            const parts = line.trim().split(/\s+/);
            if (parts.length < 3) continue;
            // Destination 00000000 = default route
            if (parts[1] !== "00000000") continue;
            const gatewayHex = parts[2] ?? "";
            if (gatewayHex.length < 8) continue;
            // Stored little-endian; reverse byte order.
            const ip = [
                parseInt(gatewayHex.slice(6, 8), 16),
                parseInt(gatewayHex.slice(4, 6), 16),
                parseInt(gatewayHex.slice(2, 4), 16),
                parseInt(gatewayHex.slice(0, 2), 16),
            ].join(".");
            if (/^\d+\.\d+\.\d+\.\d+$/.test(ip) && ip !== "0.0.0.0") {
                return ip;
            }
        }
    } catch {
        // /proc/net/route is Linux-only and only exists when /proc is
        // mounted. Outside of a container (e.g. local dev on the host)
        // this fails and 127.0.0.1 is the correct address anyway.
    }
    return "127.0.0.1";
}

/**
 * Create a new database inside an existing Postgres instance, keeping
 * isolation via database namespace rather than container.
 */
export async function provisionDatabaseNamespace(
    sharedUri: string,
    log: (line: string) => void,
): Promise<string> {
    const adminUrl = buildAdminDatabaseUrl(sharedUri);
    const databaseName = `deployer_bootstrap_${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;

    log(`target database = ${databaseName}`);
    log(`admin URL       = ${redactDatabaseUrl(adminUrl)}`);

    const adminPool = new Pool({ connectionString: adminUrl, max: 1 });
    try {
        log("▸ Probing shared Postgres admin endpoint …");
        await waitForPostgres(adminUrl, { log });
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

/**
 * Probe an existing Postgres URL with a `SELECT 1` round-trip.
 * Returns the same URL on success; throws on connection failure.
 */
export async function probeExistingDatabase(
    databaseUrl: string,
    log: (line: string) => void,
): Promise<string> {
    const t0 = Date.now();
    const pool = new Pool({
        connectionString: databaseUrl,
        max: 1,
        connectionTimeoutMillis: 5_000,
    });
    try {
        log("dispatching SELECT 1 …");
        await pool.query("SELECT 1");
        log(`reply received in ${String(Date.now() - t0)} ms`);
        return databaseUrl;
    } finally {
        await pool.end().catch(() => undefined);
    }
}

/**
 * Run Drizzle migrations against a Postgres URL. Streams progress
 * lines through `log` so the user can see what migrations are
 * running.
 */
export async function runMigrations(
    databaseUrl: string,
    migrationsFolder: string,
    log: (line: string) => void,
): Promise<void> {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const db = drizzle(pool, { schema: globalSchema });
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

/**
 * Insert the initial admin user / credentials account / organization
 * / owner membership into a freshly migrated database. Returns the
 * generated IDs for log display.
 */
export async function seedInitialData(
    databaseUrl: string,
    input: {
        name: string;
        email: string;
        password: string;
        organizationName: string;
    },
    log: (line: string) => void,
): Promise<{
    userId: string;
    organizationId: string;
    organizationSlug: string;
}> {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const db = drizzle(pool, { schema: globalSchema });
    const userId = crypto.randomUUID();
    const organizationId = crypto.randomUUID();
    const memberId = crypto.randomUUID();
    const accountId = crypto.randomUUID();
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
            id: userId,
            name: input.name,
            email: input.email,
            emailVerified: true,
            role: Roles.superAdmin,
            createdAt: now,
            updatedAt: now,
        });
        log("  user row written");

        log("INSERT account …");
        await db.insert(globalSchema.account).values({
            id: accountId,
            accountId: input.email,
            providerId: "credentials",
            userId,
            password: passwordHash,
            createdAt: now,
            updatedAt: now,
        });
        log("  account row written");

        log("INSERT organization …");
        await db.insert(organization).values({
            id: organizationId,
            name: input.organizationName,
            slug,
            createdAt: now,
            metadata: null,
        });
        log("  organization row written");

        log("INSERT member …");
        await db.insert(member).values({
            id: memberId,
            organizationId,
            userId,
            role: "owner",
            createdAt: now,
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

/**
 * Ensure a database has no user-created tables. Returns the list of
 * tables found (which will be empty on a fresh database). Throws if
 * any tables exist.
 */
export async function ensureDatabaseEmpty(databaseUrl: string): Promise<string[]> {
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    try {
        const res = await pool.query<{ table_name: string }>(`
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

/**
 * Slugify an organization name. Lowercase, non-alphanumeric → `-`,
 * trim leading/trailing `-`. Falls back to `"organization"` for empty
 * input.
 */
export function slugify(value: string): string {
    return (
        value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") ||
        "organization"
    );
}

/**
 * Resolve the path to the bundled Drizzle migrations folder. Exposed
 * as a utility so callers don't need to recompute the relative path.
 */
export function getMigrationsFolder(): string {
    return fileURLToPath(
        new URL("../../../config/drizzle/global/migrations", import.meta.url),
    );
}
