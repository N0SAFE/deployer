import { and, eq, lt } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import { previewEnvironments } from '@deployer/nest-schema/global/fleet/deployment'
import { deployments } from '@deployer/nest-schema/global/runtime/deployment'

import { FleetDb } from '@/core/database/fleet-db'

const PREVIEW_TTL_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

/**
 * Data access for the preview environment lifecycle (`preview_environments` + `deployments`).
 * Drizzle only: no constructor DI, every method yields `FleetDb` when it runs.
 */
export class PreviewEnvironmentStoreImpl {
    /** Mark every active preview row matching a full domain inactive. */
    deactivateByFullDomain(fullDomain: string) {
        return Effect.gen(function* () {
            const database = yield* FleetDb
            yield* database.use(async (db) => {
                await db
                    .update(previewEnvironments)
                    .set({ isActive: false, updatedAt: new Date() })
                    .where(eq(previewEnvironments.fullDomain, fullDomain))
            })
        })
    }

    /** Active preview environments that have expired (expiresAt < now). */
    findExpired(now: Date = new Date()) {
        return Effect.gen(function* () {
            const database = yield* FleetDb
            return yield* database.use(async (db) =>
                db
                    .select({
                        id: previewEnvironments.id,
                        serviceId: deployments.serviceId,
                        subdomain: previewEnvironments.subdomain,
                        fullDomain: previewEnvironments.fullDomain,
                    })
                    .from(previewEnvironments)
                    .innerJoin(
                        deployments,
                        eq(deployments.id, previewEnvironments.deploymentId)
                    )
                    .where(
                        and(
                            eq(previewEnvironments.isActive, true),
                            lt(previewEnvironments.expiresAt, now)
                        )
                    )
            )
        })
    }

    /** Latest deployment for a service (used to attach preview rows). */
    findLatestDeploymentByService(serviceId: string) {
        return Effect.gen(function* () {
            const database = yield* FleetDb
            return yield* database.use(async (db) => {
                const [deployment] = await db
                    .select({ id: deployments.id })
                    .from(deployments)
                    .where(eq(deployments.serviceId, serviceId))
                    .orderBy(deployments.createdAt)
                    .limit(10)
                return deployment ?? null
            })
        })
    }

    /** Insert (or upsert on subdomain conflict) a preview environment row. */
    upsertPreview(input: {
        deploymentId: string
        subdomain: string
        fullDomain: string
        branchName?: string
        pullRequestUrl?: string
    }) {
        return Effect.gen(function* () {
            const database = yield* FleetDb
            yield* database.use(async (db) => {
                const now = new Date()
                const expiresAt = new Date(Date.now() + PREVIEW_TTL_MS)
                const metadata = {
                    branchName: input.branchName ?? undefined,
                    pullRequestUrl: input.pullRequestUrl ?? undefined,
                }

                await db
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
                    })
            })
        })
    }
}

/** The store's public surface is exactly the implementation's methods. */
export type PreviewEnvironmentStoreShape = PreviewEnvironmentStoreImpl

/** Effect key = NestJS token. */
export class PreviewEnvironmentStore extends Context.Service<
    PreviewEnvironmentStore,
    PreviewEnvironmentStoreShape
>()('fleet/PreviewEnvironmentStore') {
    /** Resolves the requirements the methods name when a call runs. */
    static readonly live: PreviewEnvironmentStoreShape =
        new PreviewEnvironmentStoreImpl()
}
