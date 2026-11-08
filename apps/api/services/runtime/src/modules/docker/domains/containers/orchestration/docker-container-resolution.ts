import { Logger } from '@nestjs/common'
import { Cause, Context, Effect, Exit } from 'effect'

import {
    type DockerContainer,
    type DockerContainerInspectDetail,
} from '@deployer/contracts-entities'
import type {
    DockerContainerGroupedListInput,
    DockerContainerGroupedListResult,
    DockerContainerListInput,
} from '@deployer/runtime-contracts/modules/docker/containers/shared'

import { attempt } from '../../../../../core/effects'
import { DockerRepository } from '../../../repositories/facade/docker.repository'

import {
    formatError,
    normalizeContainer,
    toError,
} from './mesh-entity-normalization'
import {
    applyContainerFilters,
    buildDaemonScopedContainerFingerprint,
    computeSharedDaemonDiagnostics,
    dedupeResponsesByResponder,
    groupContainersForInventory,
    mergeContainerHealth,
    mergeContainerStatus,
    paginate,
    paginateList,
    pickBestInspectDetail,
    sortContainers,
} from './mesh-universe-merge'

import type {
    DockerContainerResolutionOptions,
    DockerGroupedDaemonDiagnostics,
} from './mesh-universe-types'
import type { DockerNodeMesh } from '../mesh/docker-node-mesh'
import type {
    DockerContainerInspectRequestPayload,
    DockerContainerListRequestPayload,
    DockerContainerListResponsePayload,
    DockerContainerListResult,
} from '../mesh/node-mesh-types'

const MESH_FANOUT_LIMIT = 500

/** What one operation reads from the context: the mesh fan-out and this node's repository. */
type ResolutionCollaborators = {
    readonly mesh: ContainersMeshPort['Service']
    readonly local: ContainersLocalPort['Service']
}

/** The diagnostics a list computed on this node alone carries: there is no other daemon to compare with. */
const noSharedDaemon: DockerGroupedDaemonDiagnostics = {
    hasSharedDaemonAcrossNodes: false,
    sharedDaemonGroups: [],
}

/** A page of containers grouped by runtime fingerprint; the caller supplies the (already sorted) rows. */
const groupedPage = (
    containers: DockerContainer[],
    input: DockerContainerGroupedListInput,
    diagnostics: DockerGroupedDaemonDiagnostics
): DockerContainerGroupedListResult => ({
    ...paginateList(
        groupContainersForInventory(containers),
        input.limit,
        input.offset
    ),
    diagnostics,
})

/**
 * Container listing and inspection across the mesh.
 *
 * Every operation below IS the logic: it yields the mesh fan-out and this node's repository where it uses them, and
 * `mergeMeshResponses` is the one helper more than one operation shares. The local fallback is `localPage`.
 */
export class DockerContainerResolution extends Context.Service<
    DockerContainerResolution,
    DockerContainerResolutionShape
>()('runtime/DockerContainerResolution') {
    static readonly live = class DockerContainerResolutionImpl
        implements DockerContainerResolutionShape
    {
        private readonly logger = new Logger(
            'DockerContainerResolutionService'
        )

        /** This node's own page: what a fallback returns when the mesh answers with nothing, or fails. */
        private localPage(
            { local }: ResolutionCollaborators,
            input: DockerContainerListInput
        ): Effect.Effect<DockerContainerListResult, unknown> {
            return attempt(async () => await local.listContainers(input))
        }

        listContainers(
            input: DockerContainerListInput,
            options?: DockerContainerResolutionOptions
        ): ReturnType<DockerContainerResolutionShape['listContainers']> {
            return Effect.gen({ self: this }, function* () {
                const mesh = yield* ContainersMeshPort
                const local = yield* ContainersLocalPort
                const collaborators: ResolutionCollaborators = { mesh, local }

                if (options?.localOnly) {
                    this.logger.debug(
                        'Bypassing mesh fanout for local-only docker container list request'
                    )
                    return yield* this.localPage(collaborators, input)
                }

                const meshPayload: DockerContainerListRequestPayload = {
                    query: {
                        ...input,
                        limit: MESH_FANOUT_LIMIT,
                        offset: 0,
                    },
                }

                const meshResult = yield* attempt(async () =>
                    await mesh.listContainersAcrossInstances(meshPayload, {
                        timeoutMs: 1_500,
                        maxCollectedResponses: 128,
                    })
                ).pipe(
                    Effect.catch((error) =>
                        Effect.sync(() => {
                            this.logger.warn(
                                `Mesh container resolution failed (${formatError(error)}). Falling back to local repository`
                            )
                        }).pipe(Effect.map((): null => null))
                    )
                )

                if (meshResult === null) {
                    return yield* this.localPage(collaborators, input)
                }

                const page = yield* Effect.try({
                    try: (): DockerContainerListResult | null => {
                        const resolvedResponses = dedupeResponsesByResponder(
                            meshResult.responses
                        )

                        this.logger.debug(
                            [
                                `Mesh listContainers call metrics: responses=${String(meshResult.responses.length)}`,
                                `combinedResponses=${String(resolvedResponses.length)}`,
                                `expected=${String(meshResult.metrics.expectedResponders)}`,
                                `received=${String(meshResult.metrics.receivedResponses)}`,
                                `timedOut=${String(meshResult.metrics.timedOut)}`,
                                `stoppedEarly=${String(meshResult.stoppedEarly)}`,
                                `reason=${meshResult.reason}`,
                                `payloadSizes=[${resolvedResponses.map((response) => String(response.data.length)).join(',')}]`,
                            ].join(' | ')
                        )

                        if (resolvedResponses.length === 0) {
                            return null
                        }

                        const merged =
                            this.mergeMeshResponses(resolvedResponses)
                        const filtered = applyContainerFilters(merged, input)
                        const sorted = sortContainers(
                            filtered,
                            input.sortBy,
                            input.sortDirection
                        )
                        const paginated = paginate(
                            sorted,
                            input.limit,
                            input.offset
                        )

                        this.logger.debug(
                            [
                                `Mesh listContainers merge result: merged=${String(merged.length)}`,
                                `filtered=${String(filtered.length)}`,
                                `sorted=${String(sorted.length)}`,
                                `pageSize=${String(paginated.data.length)}`,
                                `dedupedById=${String(merged.length - new Set(merged.map((container) => container.id)).size)}`,
                            ].join(' | ')
                        )

                        return paginated
                    },
                    catch: (error) => error,
                }).pipe(
                    Effect.catch((error) =>
                        Effect.sync(() => {
                            this.logger.warn(
                                `Mesh container resolution failed (${formatError(error)}). Falling back to local repository`
                            )
                        }).pipe(Effect.map((): null => null))
                    )
                )

                return (
                    page ?? (yield* this.localPage(collaborators, input))
                )
            })
        }

        listContainersGrouped(
            input: DockerContainerGroupedListInput,
            options?: DockerContainerResolutionOptions
        ): ReturnType<
            DockerContainerResolutionShape['listContainersGrouped']
        > {
            return Effect.gen({ self: this }, function* () {
                const mesh = yield* ContainersMeshPort
                const local = yield* ContainersLocalPort
                const collaborators: ResolutionCollaborators = { mesh, local }
                const fullScanInput: DockerContainerListInput = {
                    ...input,
                    limit: MESH_FANOUT_LIMIT,
                    offset: 0,
                }

                if (options?.localOnly) {
                    this.logger.debug(
                        'Bypassing mesh fanout for local-only docker container list request'
                    )
                    const localResult = yield* this.localPage(
                        collaborators,
                        fullScanInput
                    )
                    return groupedPage(
                        sortContainers(
                            localResult.data,
                            input.sortBy,
                            input.sortDirection
                        ),
                        input,
                        noSharedDaemon
                    )
                }

                const meshPayload: DockerContainerListRequestPayload = {
                    query: fullScanInput,
                }

                const meshResult = yield* attempt(async () =>
                    await mesh.listContainersAcrossInstances(meshPayload, {
                        timeoutMs: 1_500,
                        maxCollectedResponses: 128,
                    })
                ).pipe(
                    Effect.catch((error) =>
                        Effect.sync(() => {
                            this.logger.warn(
                                `Mesh container resolution failed (${formatError(error)}). Falling back to local repository`
                            )
                        }).pipe(Effect.map((): null => null))
                    )
                )

                const universe = yield* Effect.try({
                    try: (): {
                        containers: DockerContainer[]
                        diagnostics: DockerGroupedDaemonDiagnostics
                    } | null => {
                        if (meshResult === null) return null

                        const resolvedResponses = dedupeResponsesByResponder(
                            meshResult.responses
                        )

                        this.logger.debug(
                            [
                                `Mesh listContainers call metrics: responses=${String(meshResult.responses.length)}`,
                                `combinedResponses=${String(resolvedResponses.length)}`,
                                `expected=${String(meshResult.metrics.expectedResponders)}`,
                                `received=${String(meshResult.metrics.receivedResponses)}`,
                                `timedOut=${String(meshResult.metrics.timedOut)}`,
                                `stoppedEarly=${String(meshResult.stoppedEarly)}`,
                                `reason=${meshResult.reason}`,
                                `payloadSizes=[${resolvedResponses.map((response) => String(response.data.length)).join(',')}]`,
                            ].join(' | ')
                        )

                        if (resolvedResponses.length === 0) {
                            return null
                        }

                        const merged =
                            this.mergeMeshResponses(resolvedResponses)
                        const filtered = applyContainerFilters(
                            merged,
                            fullScanInput
                        )
                        const sorted = sortContainers(
                            filtered,
                            input.sortBy,
                            input.sortDirection
                        )
                        const diagnostics =
                            computeSharedDaemonDiagnostics(resolvedResponses)

                        this.logger.debug(
                            [
                                `Mesh listContainers merge result: merged=${String(merged.length)}`,
                                `filtered=${String(filtered.length)}`,
                                `sorted=${String(sorted.length)}`,
                                `dedupedById=${String(merged.length - new Set(merged.map((container) => container.id)).size)}`,
                            ].join(' | ')
                        )

                        return { containers: sorted, diagnostics }
                    },
                    catch: (error) => error,
                }).pipe(
                    Effect.catch((error) =>
                        Effect.sync(() => {
                            this.logger.warn(
                                `Mesh container resolution failed (${formatError(error)}). Falling back to local repository`
                            )
                        }).pipe(Effect.map((): null => null))
                    )
                )

                if (universe === null) {
                    const localResult = yield* this.localPage(
                        collaborators,
                        fullScanInput
                    )
                    return groupedPage(
                        sortContainers(
                            localResult.data,
                            input.sortBy,
                            input.sortDirection
                        ),
                        input,
                        noSharedDaemon
                    )
                }

                return groupedPage(
                    universe.containers,
                    input,
                    universe.diagnostics
                )
            })
        }

        inspectContainer(
            containerId: string
        ): ReturnType<DockerContainerResolutionShape['inspectContainer']> {
            return Effect.gen({ self: this }, function* () {
                const mesh = yield* ContainersMeshPort
                const local = yield* ContainersLocalPort

                const localExit = yield* Effect.exit(
                    attempt(async () => await local.inspectContainer(containerId))
                )
                if (Exit.isSuccess(localExit)) {
                    return localExit.value
                }

                const localInspectError = toError(Cause.squash(localExit.cause))
                const meshPayload: DockerContainerInspectRequestPayload = {
                    query: {
                        containerId,
                    },
                }

                const meshResult = yield* attempt(async () =>
                    await mesh.inspectContainerAcrossInstances(meshPayload, {
                        timeoutMs: 1_500,
                        maxCollectedResponses: 16,
                    })
                ).pipe(
                    Effect.catch((error) =>
                        Effect.sync(() => {
                            this.logger.warn(
                                `Mesh container inspect resolution failed (${formatError(error)}). Falling back to local repository`
                            )
                        }).pipe(Effect.map((): null => null))
                    )
                )

                if (meshResult !== null && meshResult.responses.length > 0) {
                    return pickBestInspectDetail(meshResult.responses)
                }

                return yield* Effect.fail(localInspectError)
            })
        }

        /** The mesh's containers, one per daemon fingerprint, newest representative winning. */
        private mergeMeshResponses(
            responses: DockerContainerListResponsePayload[]
        ): DockerContainer[] {
            const dedupedByDaemonFingerprint = new Map<
                string,
                DockerContainer
            >()

            for (const response of responses) {
                const sourceScope = response.responderDaemonId
                    ? `daemon:${response.responderDaemonId}`
                    : `node:${response.responderNodeId ?? 'unknown'}`

                for (const item of response.data) {
                    const normalized = normalizeContainer(item, (m) => {
                        this.logger.warn(m)
                    })
                    if (!normalized) {
                        this.logger.warn(
                            'Dropping invalid docker container from mesh response after normalization'
                        )
                        continue
                    }

                    const dedupeFingerprint =
                        buildDaemonScopedContainerFingerprint(normalized)
                    const dedupeKey = `${sourceScope}|${dedupeFingerprint}`
                    const existing = dedupedByDaemonFingerprint.get(dedupeKey)

                    if (!existing) {
                        dedupedByDaemonFingerprint.set(dedupeKey, normalized)
                        continue
                    }

                    const existingUpdatedAt = Date.parse(existing.updatedAt)
                    const incomingUpdatedAt = Date.parse(normalized.updatedAt)
                    const representative =
                        incomingUpdatedAt >= existingUpdatedAt
                            ? normalized
                            : existing

                    dedupedByDaemonFingerprint.set(dedupeKey, {
                        ...representative,
                        status: mergeContainerStatus(
                            existing.status,
                            normalized.status
                        ),
                        health: mergeContainerHealth(
                            existing.health,
                            normalized.health
                        ),
                    })
                }
            }

            return [...dedupedByDaemonFingerprint.values()]
        }
    }
}

/** The mesh fan-out that lists and inspects containers on every node. */
export class ContainersMeshPort extends Context.Service<
    ContainersMeshPort,
    Pick<
        DockerNodeMesh,
        'listContainersAcrossInstances' | 'inspectContainerAcrossInstances'
    >
>()('runtime/ContainersMeshPort') {}

/** This node's own containers, read from the local engine. */
export class ContainersLocalPort extends Context.Service<
    ContainersLocalPort,
    Pick<DockerRepository, 'listContainers' | 'inspectContainer'>
>()('runtime/ContainersLocalPort') {}

export type DockerContainerResolutionPorts =
    ContainersMeshPort | ContainersLocalPort

export type DockerContainerResolutionShape = {
    /** One page of containers across the mesh; this node's own when no peer answers or the fan-out fails. */
    readonly listContainers: (
        input: DockerContainerListInput,
        options?: DockerContainerResolutionOptions
    ) => Effect.Effect<
        DockerContainerListResult,
        unknown,
        DockerContainerResolutionPorts
    >    /** The inventory grouped by runtime fingerprint, with shared-daemon diagnostics. */
    readonly listContainersGrouped: (
        input: DockerContainerGroupedListInput,
        options?: DockerContainerResolutionOptions
    ) => Effect.Effect<
        DockerContainerGroupedListResult,
        unknown,
        DockerContainerResolutionPorts
    >
    /** This node's inspect detail, else the best one a peer returns; fails with the local error when nobody has it. */
    readonly inspectContainer: (
        containerId: string
    ) => Effect.Effect<
        DockerContainerInspectDetail,
        unknown,
        DockerContainerResolutionPorts
    >
}


