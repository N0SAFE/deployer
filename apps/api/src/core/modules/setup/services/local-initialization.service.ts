import { Injectable, Logger } from "@nestjs/common";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { fileURLToPath } from "node:url";
import { hashPassword } from "better-auth/crypto";
import { Roles } from "@repo/auth/permissions";
import type { SetupInitializeLocalInput, SetupStreamEvent } from "@repo/contracts-entities";
import { Subscriber } from "rxjs";
import * as globalSchema from "@/config/drizzle/global/schema";
import { member, organization, user } from "@/config/drizzle/global/schema/auth";
import { PostgresContainerService } from "@/core/modules/docker/containers/postgres/postgres-container.service";
import { NodeConfigRepository } from "../repositories/node-config.repository";
import { InitializationService } from "./initialization.service";

@Injectable()
export class LocalInitializationService {
    private readonly logger = new Logger(LocalInitializationService.name);

    constructor(
        private readonly postgresContainerService: PostgresContainerService,
        private readonly nodeConfigRepository: NodeConfigRepository,
    ) {}

    async initialize(
        input: SetupInitializeLocalInput,
        subscriber: Subscriber<SetupStreamEvent>,
    ): Promise<void> {
        const nodeId = randomUUID();
        let databaseUrl: string;

        // ── Step: provision_database ─────────────────────────────────────────
        subscriber.next(InitializationService.stepStart("provision_database", "Set up the database"));
        const dbStart = Date.now();
        try {
            if (input.existingDatabaseUrl?.trim()) {
                subscriber.next(InitializationService.stepLog("provision_database", "Testing existing database connection…"));
                databaseUrl = await this.probeExistingDatabase(input.existingDatabaseUrl.trim());
                subscriber.next(InitializationService.stepLog("provision_database", "✅ Existing database reachable"));
            } else {
                subscriber.next(InitializationService.stepLog("provision_database", "Provisioning Docker Postgres container…"));
                databaseUrl = await this.provisionDockerDatabase();
                subscriber.next(InitializationService.stepLog("provision_database", `✅ Container ready at ${databaseUrl}`));
            }
            subscriber.next(InitializationService.stepComplete("provision_database", Date.now() - dbStart));
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            subscriber.next(InitializationService.stepFailed("provision_database", error, Date.now() - dbStart));
            throw err;
        }
        
        // ── Step: ensure_empty ─────────────────────────────────────────────
        subscriber.next(InitializationService.stepStart("ensure_empty", "Ensure database is empty"));
        const emptyStart = Date.now();
        try {
            subscriber.next(InitializationService.stepLog("ensure_empty", "Checking for existing tables…"));
            await this.ensureDatabaseEmpty(databaseUrl);
            subscriber.next(InitializationService.stepLog("ensure_empty", "✅ Database is empty"));
            subscriber.next(InitializationService.stepComplete("ensure_empty", Date.now() - emptyStart));
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            subscriber.next(InitializationService.stepFailed("ensure_empty", error, Date.now() - emptyStart));
            throw err;
        }

        // ── Step: run_migrations ─────────────────────────────────────────────
        subscriber.next(InitializationService.stepStart("run_migrations", "Run migrations"));
        const migrateStart = Date.now();
        try {
            subscriber.next(InitializationService.stepLog("run_migrations", "Applying Drizzle migrations…"));
            await this.runMigrations(databaseUrl);
            subscriber.next(InitializationService.stepLog("run_migrations", "✅ All migrations applied"));
            subscriber.next(InitializationService.stepComplete("run_migrations", Date.now() - migrateStart));
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            subscriber.next(InitializationService.stepFailed("run_migrations", error, Date.now() - migrateStart));
            throw err;
        }

        // ── Step: seed_initial_data ──────────────────────────────────────────
        subscriber.next(InitializationService.stepStart("seed_initial_data", "Initialize workspace data"));
        const seedStart = Date.now();
        try {
            subscriber.next(InitializationService.stepLog("seed_initial_data", `Creating user ${input.email}…`));
            await this.seedInitialData(databaseUrl, input);
            subscriber.next(InitializationService.stepLog("seed_initial_data", `✅ User and organization "${input.organizationName}" created`));
            subscriber.next(InitializationService.stepComplete("seed_initial_data", Date.now() - seedStart));
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            subscriber.next(InitializationService.stepFailed("seed_initial_data", error, Date.now() - seedStart));
            throw err;
        }

        // ── Step: register_node ──────────────────────────────────────────────
        subscriber.next(InitializationService.stepStart("register_node", "Register this node"));
        const regStart = Date.now();
        try {
            subscriber.next(InitializationService.stepLog("register_node", `Assigning node ID ${nodeId}…`));
            const now = new Date().toISOString();
            this.nodeConfigRepository.upsert({
                nodeId,
                strategy: "local",
                meshUrlsSnapshot: [],
                configuredAt:     now,
                updatedAt:        now,
                databaseUrl,
            });
            subscriber.next(InitializationService.stepLog("register_node", "✅ Node config persisted"));
            subscriber.next(InitializationService.stepComplete("register_node", Date.now() - regStart));
        } catch (err: unknown) {
            const error = err instanceof Error ? err.message : String(err);
            subscriber.next(InitializationService.stepFailed("register_node", error, Date.now() - regStart));
            throw err;
        }

        // ── Final event ──────────────────────────────────────────────────────
        subscriber.next(InitializationService.completed(nodeId, "local", databaseUrl));
    }

    // ─── Database helpers ─────────────────────────────────────────────────────

    private async probeExistingDatabase(databaseUrl: string): Promise<string> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        try {
            await pool.query("SELECT 1");
            return databaseUrl;
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private async provisionDockerDatabase(): Promise<string> {
        const container = await this.postgresContainerService.startPostgresContainer();
        const hostPort = await this.postgresContainerService.getMappedPort(container.id, 5432);
        return `postgres://deployer:deployer@127.0.0.1:${String(hostPort)}/deployer`;
    }
    
    private async ensureDatabaseEmpty(databaseUrl: string): Promise<void> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        try {
            const res = await pool.query<{
                table_name: string
            }>(`
                SELECT table_name FROM information_schema.tables
                WHERE table_schema = 'public' AND table_type = 'BASE TABLE';
            `);
            if (res.rows.length > 0) {
                throw new Error(`Database is not empty. Found tables: ${res.rows.map(r => r.table_name).join(", ")}`);
            }
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private async runMigrations(databaseUrl: string): Promise<void> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        const db = drizzle(pool, { schema: globalSchema });
        const migrationsFolder = fileURLToPath(
            new URL("../../../../config/drizzle/global/migrations", import.meta.url),
        );
        try {
            await migrate(db, { migrationsFolder });
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private async seedInitialData(
        databaseUrl: string,
        input: SetupInitializeLocalInput,
    ): Promise<void> {
        const pool = new Pool({ connectionString: databaseUrl, max: 1 });
        const db = drizzle(pool, { schema: globalSchema });
        const userId = randomUUID();
        const organizationId = randomUUID();
        const now = new Date();
        const slug = this.slugify(input.organizationName);
        const passwordHash = await hashPassword(input.password);

        try {
            await db.insert(user).values({
                id: userId, name: input.name, email: input.email,
                emailVerified: true, role: Roles.superAdmin,
                createdAt: now, updatedAt: now,
            });
            await db.insert(globalSchema.account).values({
                id: randomUUID(), accountId: input.email,
                providerId: "credentials", userId,
                password: passwordHash, createdAt: now, updatedAt: now,
            });
            await db.insert(organization).values({
                id: organizationId, name: input.organizationName,
                slug, createdAt: now, metadata: null,
            });
            await db.insert(member).values({
                id: randomUUID(), organizationId, userId,
                role: "owner", createdAt: now,
            });
        } finally {
            await pool.end().catch(() => undefined);
        }
    }

    private slugify(value: string): string {
        return (
            value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "organization"
        );
    }
}