import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { GlobalDatabaseService } from "@deployer/shared/core/modules/database/global/global-database.service";
import { appConfig } from "@deployer/nest-schema/global/platform/app-config";
import { githubApps, githubRepositoryConfigs, githubWebhookEvents } from "@deployer/nest-schema/global/fleet/github-provider";
import { services } from "@deployer/nest-schema/global/project/deployment";

/**
 * GithubAppsRepository — the single data-access layer for the GitHub apps +
 * webhook runtime config, extracted from GithubWebhookController (which was
 * reaching into the DB directly, violating the controller → service →
 * repository layering).
 */
@Injectable()
export class GithubAppsRepository {
    constructor(private readonly globalDatabaseService: GlobalDatabaseService) {}

    private get db() {
        return this.globalDatabaseService.db;
    }

    // ─── CRUD ────────────────────────────────────────────────────────────────

    /** List all GitHub apps, oldest first. */
    async list() {
        return this.db
            .select({
                id: githubApps.id,
                name: githubApps.name,
                appId: githubApps.appId,
                clientId: githubApps.clientId,
                isActive: githubApps.isActive,
                createdAt: githubApps.createdAt,
                updatedAt: githubApps.updatedAt,
            })
            .from(githubApps)
            .orderBy(githubApps.createdAt);
    }

    /** Select the full app row by DB id (for registration + installation access). */
    async findById(id: string) {
        const rows = await this.db
            .select({
                id: githubApps.id,
                appId: githubApps.appId,
                privateKey: githubApps.privateKey,
                clientId: githubApps.clientId,
                clientSecret: githubApps.clientSecret,
                webhookSecret: githubApps.webhookSecret,
                installationId: githubApps.installationId,
            })
            .from(githubApps)
            .where(eq(githubApps.id, id))
            .limit(1);
        return rows[0] ?? null;
    }

    /** Select app rows for provider operations (active apps, optionally scoped by id). */
    async findProviderApps(providerAppId?: string) {
        const qb = this.db
            .select({
                id: githubApps.id,
                name: githubApps.name,
                appId: githubApps.appId,
                privateKey: githubApps.privateKey,
                clientId: githubApps.clientId,
                clientSecret: githubApps.clientSecret,
                webhookSecret: githubApps.webhookSecret,
                installationId: githubApps.installationId,
            })
            .from(githubApps);

        return providerAppId
            ? qb.where(eq(githubApps.id, providerAppId)).limit(1)
            : qb.where(eq(githubApps.isActive, true));
    }

    /** Create a GitHub app row. */
    async create(input: {
        name: string;
        appId: string;
        clientId: string;
        clientSecret: string;
        privateKey: string;
        webhookSecret: string;
        installationId?: string | null;
        isActive?: boolean;
    }) {
        const [row] = await this.db
            .insert(githubApps)
            .values({
                name: input.name,
                appId: input.appId,
                clientId: input.clientId,
                clientSecret: input.clientSecret,
                privateKey: input.privateKey,
                webhookSecret: input.webhookSecret,
                installationId: input.installationId ?? null,
                isActive: input.isActive ?? true,
            })
            .returning();
        return row ?? null;
    }

    /** Update a GitHub app row by id. Returns the updated row or null. */
    async updateById(id: string, values: Partial<typeof githubApps.$inferInsert>) {
        const [row] = await this.db
            .update(githubApps)
            .set({ ...values, updatedAt: new Date() })
            .where(eq(githubApps.id, id))
            .returning();
        return row ?? null;
    }

    /** Delete a GitHub app row by id. */
    async deleteById(id: string) {
        await this.db
            .delete(githubApps)
            .where(eq(githubApps.id, id));
    }

    /** Record the installation id for an app matched by name. Returns the updated row or null. */
    async setInstallationByName(name: string, installationId: string) {
        const [updated] = await this.db
            .update(githubApps)
            .set({ installationId, updatedAt: new Date() })
            .where(eq(githubApps.name, name))
            .returning({ id: githubApps.id, appId: githubApps.appId });
        return updated ?? null;
    }

    /** Select the clientId for an app by id (OAuth init). */
    async findClientIdById(id: string) {
        const rows = await this.db
            .select({ id: githubApps.id, clientId: githubApps.clientId })
            .from(githubApps)
            .where(eq(githubApps.id, id))
            .limit(1);
        return rows[0] ?? null;
    }

    /** Select the client credentials for an app by id (OAuth callback). */
    async findClientCredentialsById(id: string) {
        const rows = await this.db
            .select({
                id: githubApps.id,
                clientId: githubApps.clientId,
                clientSecret: githubApps.clientSecret,
            })
            .from(githubApps)
            .where(eq(githubApps.id, id))
            .limit(1);
        return rows[0] ?? null;
    }

    // ─── Webhook runtime config ──────────────────────────────────────────────

    /**
     * Record (or clear, when `installationId` is null) the GitHub App
     * installation id for a given app id. Returns true when a row matched.
     */
    async setInstallation(appId: string, installationId: string | null): Promise<boolean> {
        const [updated] = await this.db
            .update(githubApps)
            .set({ installationId, updatedAt: new Date() })
            .where(eq(githubApps.appId, appId))
            .returning({ id: githubApps.id });
        return Boolean(updated);
    }

    /**
     * Load the runtime webhook secret for the `github_webhook` config key.
     * Returns null when not configured (or DB unavailable).
     */
    async getWebhookSecret(): Promise<string | null> {
        try {
            const rows = await this.db
                .select()
                .from(appConfig)
                .where(eq(appConfig.key, "github_webhook"))
                .limit(1);
            const config = rows[0];
            if (config?.value) {
                const parsed = JSON.parse(config.value) as { webhookSecret?: string };
                if (parsed.webhookSecret) return parsed.webhookSecret;
            }
        } catch {
            // DB not available yet — webhook validation falls through.
        }
        return null;
    }

    // ─── Webhook → app/installation resolution (W7) ─────────────────────────

    /** Match the app row by the installation id carried in webhook payloads. */
    async findByInstallationId(installationId: string) {
        const rows = await this.db
            .select()
            .from(githubApps)
            .where(eq(githubApps.installationId, installationId))
            .limit(1);
        return rows[0] ?? null;
    }

    /** First active app — fallback when a delivery carries no installation id. */
    async findPrimaryApp() {
        const rows = await this.db
            .select()
            .from(githubApps)
            .where(eq(githubApps.isActive, true))
            .limit(1);
        return rows[0] ?? null;
    }

    // ─── Repository mapping (github_repository_configs, W6) ─────────────────

    /** Config row for a repository full name ("owner/repo"). */
    async findRepositoryConfigByFullName(repositoryFullName: string) {
        const rows = await this.db
            .select()
            .from(githubRepositoryConfigs)
            .where(
                eq(githubRepositoryConfigs.repositoryFullName, repositoryFullName),
            )
            .limit(1);
        return rows[0] ?? null;
    }

    /**
     * Bootstrap write-side: upsert a repo→project+app mapping so webhooks
     * resolve a service. Idempotent by repositoryFullName — an existing row
     * (with operator settings) is returned unchanged.
     */
    async upsertRepositoryConfig(input: {
        projectId: string;
        githubAppId: string;
        repositoryId: string;
        repositoryFullName: string;
    }) {
        const existing = await this.findRepositoryConfigByFullName(input.repositoryFullName);
        if (existing) return existing;
        const [row] = await this.db
            .insert(githubRepositoryConfigs)
            .values(input)
            .returning();
        return row ?? null;
    }

    /**
     * Find the platform service mapped to a repository source URL — the
     * webhook→service bridge. Matches `providerConfig.sourceUrl` normalized
     * (trimmed, lowercased, trailing slashes stripped). When `projectId` is
     * given the scan is project-scoped.
     */
    async findServiceBySourceUrl(sourceUrl: string, projectId?: string) {
        const normalized = sourceUrl.trim().toLowerCase().replace(/\/+$/, "");
        const rows = projectId
            ? await this.db
                  .select()
                  .from(services)
                  .where(eq(services.projectId, projectId))
            : await this.db.select().from(services);
        const match = rows.find((row) => {
            const source = (row.providerConfig as { sourceUrl?: string } | null)?.sourceUrl;
            return source !== undefined &&
                typeof source === "string" &&
                source.trim().toLowerCase().replace(/\/+$/, "") === normalized;
        });
        return match ?? null;
    }

    // ─── Webhook event journal (github_webhook_events writer, W7/CF-6) ──────

    /** Record a delivery so inspection/replay has a durable trail. */
    async recordWebhookEvent(input: {
        githubAppId: string;
        event: string;
        deliveryId: string;
        payload: unknown;
        processed: boolean;
    }) {
        const [row] = await this.db
            .insert(githubWebhookEvents)
            .values({
                githubAppId: input.githubAppId,
                event: input.event,
                deliveryId: input.deliveryId,
                payload: input.payload,
                processed: input.processed,
            })
            .returning();
        return row ?? null;
    }

    /**
     * W-P2 (durable idempotency): atomically claim a delivery by `delivery_id`.
     * The unique index on `delivery_id` makes the first INSERT the claim; a
     * redelivery/duplicate conflicts (ON CONFLICT DO NOTHING) and returns
     * `false`. Survives process restarts — unlike the old in-memory LRU.
     */
    async claimWebhookDelivery(input: {
        event: string;
        deliveryId: string;
        payload: unknown;
    }): Promise<boolean> {
        const [row] = await this.db
            .insert(githubWebhookEvents)
            .values({
                githubAppId: null,
                event: input.event,
                deliveryId: input.deliveryId,
                payload: input.payload,
                processed: false,
            })
            .onConflictDoNothing({ target: githubWebhookEvents.deliveryId })
            .returning({ id: githubWebhookEvents.id });
        return row !== undefined;
    }
}
