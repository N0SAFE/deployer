import { Injectable } from "@nestjs/common";
import { and, eq, lt } from "drizzle-orm";
import { GlobalDatabaseService } from "@/core/modules/database/global/global-database.service";
import { deployments } from "@deployer/nest-schema/global/runtime/deployment";
import { previewEnvironments } from "@deployer/nest-schema/global/fleet/deployment";

const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

/**
 * PreviewEnvironmentRepository — data access for the preview environment
 * lifecycle (preview_environments + deployments tables), extracted from
 * PreviewProvisioningService which reached into the DB directly.
 */
@Injectable()
export class PreviewEnvironmentRepository {
    constructor(private readonly globalDatabaseService: GlobalDatabaseService) {}

    private get db() {
        return this.globalDatabaseService.db;
    }

    /** Mark every active preview row matching a full domain inactive. */
    async deactivateByFullDomain(fullDomain: string) {
        return this.db
            .update(previewEnvironments)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(previewEnvironments.fullDomain, fullDomain));
    }

    /** Active preview environments that have expired (expiresAt < now). */
    async findExpired(now: Date = new Date()) {
        return this.db
            .select({
                id: previewEnvironments.id,
                serviceId: deployments.serviceId,
                subdomain: previewEnvironments.subdomain,
                fullDomain: previewEnvironments.fullDomain,
            })
            .from(previewEnvironments)
            .innerJoin(
                deployments,
                eq(deployments.id, previewEnvironments.deploymentId),
            )
            .where(
                and(
                    eq(previewEnvironments.isActive, true),
                    lt(previewEnvironments.expiresAt, now),
                ),
            );
    }

    /** Latest deployment for a service (used to attach preview rows). */
    async findLatestDeploymentByService(serviceId: string) {
        const [deployment] = await this.db
            .select({ id: deployments.id })
            .from(deployments)
            .where(eq(deployments.serviceId, serviceId))
            .orderBy(deployments.createdAt)
            .limit(10);
        return deployment ?? null;
    }

    /**
     * Insert (or upsert on subdomain conflict) a preview environment row.
     */
    async upsertPreview(input: {
        deploymentId: string;
        subdomain: string;
        fullDomain: string;
        branchName?: string;
        pullRequestUrl?: string;
    }) {
        const now = new Date();
        const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS);
        const metadata = {
            branchName: input.branchName ?? undefined,
            pullRequestUrl: input.pullRequestUrl ?? undefined,
        };

        return this.db
            .insert(previewEnvironments)
            .values({
                deploymentId: input.deploymentId,
                subdomain: input.subdomain,
                fullDomain: input.fullDomain,
                sslEnabled: true,
                isActive: true,
                webhookTriggered: true,
                expiresAt,
                metadata,
                createdAt: now,
                updatedAt: now,
            })
            .onConflictDoUpdate({
                target: previewEnvironments.subdomain,
                set: {
                    fullDomain: input.fullDomain,
                    sslEnabled: true,
                    isActive: true,
                    webhookTriggered: true,
                    expiresAt,
                    metadata,
                    updatedAt: now,
                },
            });
    }
}
