import { and, asc, desc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import {
    clusterNodes,
    clusterServerAllocations,
    clusterAdmissionRequests,
    clusterNodeMetrics,
} from '@deployer/nest-schema/global/fleet/cluster'
import type { GlobalDatabaseServiceShape } from '@deployer/shared/core/modules/database/services/global-database.service'

import { attempt } from '../../../core/effects'

/**
 * FleetRepository — the data-access layer for the cluster fleet model
 * (cluster_nodes, cluster_server_allocations,
 * cluster_org_admission_requests, cluster_node_metrics).
 *
 * Extracted from FleetService, which mixed ~16 raw Drizzle queries with
 * business logic. All query construction lives here; FleetService owns
 * aggregation, feasibility checks and view mapping.
 *
 * Each method is lifted into an Effect that fails with whatever the driver raised (an
 * infrastructure failure the boundary answers as internal). The query builders return rows when awaited.
 *
 * Every method yields `FleetDatabasePort` when it runs, so no constructor and no port record: this is a
 * class the module provides with `useClass`.
 */

/** The database the fleet module reads and writes: the shared global one (a Nest provider). */
export class FleetDatabasePort extends Context.Service<
    FleetDatabasePort,
    GlobalDatabaseServiceShape
>()('fleet/FleetDatabasePort') {}

/** Tag and implementation together: the tag is the contract, `live` the Drizzle implementation. */
export class FleetRepository extends Context.Service<
    FleetRepository,
    FleetRepositoryShape
>()('fleet/FleetRepository') {
    static readonly live = class FleetRepositoryImpl
        implements FleetRepositoryShape
    {
        listServersWithMetrics(): ReturnType<
            FleetRepositoryShape['listServersWithMetrics']
        > {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .select({
                            nodeId: clusterNodes.nodeId,
                            serverUrl: clusterNodes.serverUrl,
                            displayName: clusterNodes.displayName,
                            status: clusterNodes.status,
                            healthy: clusterNodes.healthy,
                            lastSeenAt: clusterNodes.lastSeenAt,
                            swarmNodeId: clusterNodes.swarmNodeId,
                            maxCpuMillicores: clusterNodes.maxCpuMillicores,
                            maxMemoryMb: clusterNodes.maxMemoryMb,
                            cpuUsage: clusterNodeMetrics.metrics,
                            reportedAt: clusterNodeMetrics.reportedAt,
                        })
                        .from(clusterNodes)
                        .leftJoin(
                            clusterNodeMetrics,
                            eq(
                                clusterNodeMetrics.nodeId,
                                clusterNodes.nodeId
                            )
                        )
                        .orderBy(
                            asc(
                                clusterNodes.displayName
                            )
                        )
                })
            })
        }

        listEnabledAllocations(): ReturnType<
            FleetRepositoryShape['listEnabledAllocations']
        > {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .select({
                            serverNodeId:
                                clusterServerAllocations.serverNodeId,
                            cpuMillicores:
                                clusterServerAllocations.cpuMillicores,
                            memoryMb: clusterServerAllocations.memoryMb,
                        })
                        .from(clusterServerAllocations)
                        .where(eq(clusterServerAllocations.isEnabled, true))
                })
            })
        }

        updateServerCapacity(
            nodeId: string,
            maxCpuMillicores: number | null,
            maxMemoryMb: number | null
        ): ReturnType<FleetRepositoryShape['updateServerCapacity']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    const [row] = await database.db
                        .update(clusterNodes)
                        .set({
                            maxCpuMillicores,
                            maxMemoryMb,
                            updatedAt: new Date(),
                        })
                        .where(eq(clusterNodes.nodeId, nodeId))
                        .returning()
                    return row ?? null
                })
            })
        }

        listAllocationsWithNames(
            filters: { serverNodeId?: string }
        ): ReturnType<FleetRepositoryShape['listAllocationsWithNames']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    const conditions = [
                        filters.serverNodeId
                            ? eq(
                                  clusterServerAllocations.serverNodeId,
                                  filters.serverNodeId
                              )
                            : undefined,
                    ].filter(Boolean)

                    return database.db
                        .select({
                            allocation: clusterServerAllocations,
                            serverUrl: clusterNodes.serverUrl,
                        })
                        .from(clusterServerAllocations)
                        .leftJoin(
                            clusterNodes,
                            eq(
                                clusterNodes.nodeId,
                                clusterServerAllocations.serverNodeId
                            )
                        )
                        .where(
                            conditions.length > 0
                                ? and(...conditions)
                                : undefined
                        )
                        .orderBy(desc(clusterServerAllocations.updatedAt))
                })
            })
        }

        listAllocations(): ReturnType<FleetRepositoryShape['listAllocations']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .select({
                            allocation: clusterServerAllocations,
                            serverUrl: clusterNodes.serverUrl,
                        })
                        .from(clusterServerAllocations)
                        .leftJoin(
                            clusterNodes,
                            eq(
                                clusterNodes.nodeId,
                                clusterServerAllocations.serverNodeId
                            )
                        )
                        .orderBy(desc(clusterServerAllocations.updatedAt))
                })
            })
        }

        findEnabledAllocations(
            serverNodeId?: string
        ): ReturnType<FleetRepositoryShape['findEnabledAllocations']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    const conditions = [
                        eq(clusterServerAllocations.isEnabled, true),
                        serverNodeId
                            ? eq(
                                  clusterServerAllocations.serverNodeId,
                                  serverNodeId
                              )
                            : undefined,
                    ].filter(Boolean)

                    return database.db
                        .select({
                            allocation: clusterServerAllocations,
                            serverUrl: clusterNodes.serverUrl,
                            maxCpuMillicores: clusterNodes.maxCpuMillicores,
                            maxMemoryMb: clusterNodes.maxMemoryMb,
                        })
                        .from(clusterServerAllocations)
                        .leftJoin(
                            clusterNodes,
                            eq(
                                clusterNodes.nodeId,
                                clusterServerAllocations.serverNodeId
                            )
                        )
                        .where(
                            conditions.length > 0
                                ? and(...conditions)
                                : undefined
                        )
                })
            })
        }

        findAllocation(
            serverNodeId: string
        ): ReturnType<FleetRepositoryShape['findAllocation']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .select()
                        .from(clusterServerAllocations)
                        .where(
                            eq(
                                clusterServerAllocations.serverNodeId,
                                serverNodeId
                            )
                        )
                        .limit(1)
                })
            })
        }

        updateAllocation(
            id: string,
            values: {
                allocationMode: string
                cpuMillicores: number
                memoryMb: number
                maxServices: number | null
                isEnabled: boolean
            }
        ): ReturnType<FleetRepositoryShape['updateAllocation']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .update(clusterServerAllocations)
                        .set({
                            allocationMode: values.allocationMode as never,
                            cpuMillicores: values.cpuMillicores,
                            memoryMb: values.memoryMb,
                            maxServices: values.maxServices,
                            isEnabled: values.isEnabled,
                            updatedAt: new Date(),
                        })
                        .where(eq(clusterServerAllocations.id, id))
                        .returning()
                })
            })
        }

        insertAllocation(values: {
            serverNodeId: string
            allocationMode: string
            cpuMillicores: number
            memoryMb: number
            maxServices: number | null
            isEnabled: boolean
        }): ReturnType<FleetRepositoryShape['insertAllocation']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .insert(clusterServerAllocations)
                        .values({
                            serverNodeId: values.serverNodeId,
                            allocationMode: values.allocationMode as never,
                            cpuMillicores: values.cpuMillicores,
                            memoryMb: values.memoryMb,
                            maxServices: values.maxServices,
                            isEnabled: values.isEnabled,
                        })
                        .returning()
                })
            })
        }

        deleteAllocation(
            serverNodeId: string
        ): ReturnType<FleetRepositoryShape['deleteAllocation']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .delete(clusterServerAllocations)
                        .where(
                            eq(
                                clusterServerAllocations.serverNodeId,
                                serverNodeId
                            )
                        )
                })
            })
        }

        insertAdmissionRequest(values: {
            requestedServerNodeId: string | null
            requestedCpuMillicores: number
            requestedMemoryMb: number
            requestedServices: number
            requesterUserId: string
            requesterNote: string | null
        }): ReturnType<FleetRepositoryShape['insertAdmissionRequest']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    return database.db
                        .insert(clusterAdmissionRequests)
                        .values({
                            status: 'pending',
                            requestedServerNodeId:
                                values.requestedServerNodeId,
                            requestedCpuMillicores:
                                values.requestedCpuMillicores,
                            requestedMemoryMb: values.requestedMemoryMb,
                            requestedServices: values.requestedServices,
                            requesterUserId: values.requesterUserId,
                            requesterNote: values.requesterNote,
                        })
                        .returning()
                })
            })
        }

        listAdmissionRequests(
            status?: string
        ): ReturnType<FleetRepositoryShape['listAdmissionRequests']> {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    const conditions = [
                        status
                            ? eq(
                                  clusterAdmissionRequests.status,
                                  status as never
                              )
                            : undefined,
                    ].filter(Boolean)

                    return database.db
                        .select({
                            request: clusterAdmissionRequests,
                        })
                        .from(clusterAdmissionRequests)
                        .where(
                            conditions.length > 0
                                ? and(...conditions)
                                : undefined
                        )
                        .orderBy(desc(clusterAdmissionRequests.createdAt))
                })
            })
        }

        updateAdmissionRequestDecision(
            requestId: string,
            decision: string,
            reviewerNote: string | null,
            decisionServerNodeId: string | null
        ): ReturnType<
            FleetRepositoryShape['updateAdmissionRequestDecision']
        > {
            return Effect.gen(function* () {
                const database = yield* FleetDatabasePort
                return yield* attempt(async () => {
                    const [row] = await database.db
                        .update(clusterAdmissionRequests)
                        .set({
                            status: decision as never,
                            reviewerNote,
                            decisionServerNodeId,
                            reviewedByUserId: null,
                            reviewedAt: new Date(),
                            updatedAt: new Date(),
                        })
                        .where(eq(clusterAdmissionRequests.id, requestId))
                        .returning()
                    return row ?? null
                })
            })
        }
    }
}

/**
 * The fleet table access, one method per query. Every method yields `FleetDatabasePort` when it runs,
 * so the requirement is in its `R` and a caller provides the database rather than the repository
 * being built around it.
 */
export type FleetRepositoryShape = {
    readonly listServersWithMetrics: () => Effect.Effect<
        {
            nodeId: string
            serverUrl: string
            displayName: string | null
            status: typeof clusterNodes.$inferSelect.status
            healthy: boolean
            lastSeenAt: Date | null
            swarmNodeId: string | null
            maxCpuMillicores: number | null
            maxMemoryMb: number | null
            cpuUsage: (typeof clusterNodeMetrics.$inferSelect)['metrics'] | null
            reportedAt: Date | null
        }[],
        unknown,
        FleetDatabasePort
    >
    readonly listEnabledAllocations: () => Effect.Effect<
        {
            serverNodeId: string
            cpuMillicores: number | null
            memoryMb: number | null
        }[],
        unknown,
        FleetDatabasePort
    >
    readonly updateServerCapacity: (
        nodeId: string,
        maxCpuMillicores: number | null,
        maxMemoryMb: number | null
    ) => Effect.Effect<
        typeof clusterNodes.$inferSelect | null,
        unknown,
        FleetDatabasePort
    >
    readonly listAllocationsWithNames: (filters: {
        serverNodeId?: string
    }) => Effect.Effect<
        {
            allocation: typeof clusterServerAllocations.$inferSelect
            serverUrl: string | null
        }[],
        unknown,
        FleetDatabasePort
    >
    readonly listAllocations: () => Effect.Effect<
        {
            allocation: typeof clusterServerAllocations.$inferSelect
            serverUrl: string | null
        }[],
        unknown,
        FleetDatabasePort
    >
    readonly findEnabledAllocations: (serverNodeId?: string) => Effect.Effect<
        {
            allocation: typeof clusterServerAllocations.$inferSelect
            serverUrl: string | null
            maxCpuMillicores: number | null
            maxMemoryMb: number | null
        }[],
        unknown,
        FleetDatabasePort
    >
    readonly findAllocation: (
        serverNodeId: string
    ) => Effect.Effect<
        (typeof clusterServerAllocations.$inferSelect)[],
        unknown,
        FleetDatabasePort
    >
    readonly updateAllocation: (
        id: string,
        values: {
            allocationMode: string
            cpuMillicores: number
            memoryMb: number
            maxServices: number | null
            isEnabled: boolean
        }
    ) => Effect.Effect<
        (typeof clusterServerAllocations.$inferSelect)[],
        unknown,
        FleetDatabasePort
    >
    readonly insertAllocation: (values: {
        serverNodeId: string
        allocationMode: string
        cpuMillicores: number
        memoryMb: number
        maxServices: number | null
        isEnabled: boolean
    }) => Effect.Effect<
        (typeof clusterServerAllocations.$inferSelect)[],
        unknown,
        FleetDatabasePort
    >
    readonly deleteAllocation: (
        serverNodeId: string
    ) => Effect.Effect<{ rowCount: number | null }, unknown, FleetDatabasePort>
    readonly insertAdmissionRequest: (values: {
        requestedServerNodeId: string | null
        requestedCpuMillicores: number
        requestedMemoryMb: number
        requestedServices: number
        requesterUserId: string
        requesterNote: string | null
    }) => Effect.Effect<
        (typeof clusterAdmissionRequests.$inferSelect)[],
        unknown,
        FleetDatabasePort
    >
    readonly listAdmissionRequests: (status?: string) => Effect.Effect<
        { request: typeof clusterAdmissionRequests.$inferSelect }[],
        unknown,
        FleetDatabasePort
    >
    readonly updateAdmissionRequestDecision: (
        requestId: string,
        decision: string,
        reviewerNote: string | null,
        decisionServerNodeId: string | null
    ) => Effect.Effect<
        typeof clusterAdmissionRequests.$inferSelect | null,
        unknown,
        FleetDatabasePort
    >
}
