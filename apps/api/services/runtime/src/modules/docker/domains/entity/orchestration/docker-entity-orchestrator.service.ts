import { Context, Effect } from 'effect'

import type {
    DockerEntityKind,
    DockerEntityStreamChunk,
} from '@deployer/contracts-entities'
import { AppLogger } from '@deployer/logger'
import type {
    DockerEntityListInput,
    DockerEntityInspectInput,
} from '@deployer/runtime-contracts/modules/docker/entity/shared'

import {
    DockerEntityDomainService,
    type DockerEntityDomainPorts,
} from './docker-entity-domain.service'
import {
    buildInspectChunk,
    buildListChunks,
    type EntityChunkLog,
} from './entity-chunks'

import type { DockerEntityStreamsShape } from './docker-entity-streams'

export type DockerEntityListResult<TKind extends DockerEntityKind> = {
    kind: TKind
    data: DockerEntityStreamChunk[]
    etag: string
    hit: boolean
}

const apiLogger = new AppLogger('api').scope('DockerEntityOrchestratorService')
const debugLogger = apiLogger.createContextFilterLogger({
    defaultClassName: 'DockerEntityOrchestratorService',
    filterEnvVar: 'APP_DEBUG_CONTEXT_FILTER',
    channel: 'docker-entity-orchestrator',
})

const chunkLog: EntityChunkLog = {
    warn: (message, context) => {
        apiLogger.log.warn(message, context ?? {})
    },
    debug: (message, context) => {
        apiLogger.log.debug(message, context ?? {})
    },
}

/** The chunk-sink the list/inspect builders and the stream coercer share. */
export const entityChunkLog: EntityChunkLog = chunkLog

export const entityDebug = (
    source: string,
    context?: Record<string, unknown>
): void => {
    apiLogger.log.info(`[docker-entity-orchestrator] ${source}`, context ?? {})
    debugLogger.debug(source, context)
}

/** What one unary read needs: the domain service, plus whatever its method left open. */
type EntityReadRequirements = DockerEntityDomainService | DockerEntityDomainPorts

/** The unary reads `docker.entity` serves: one list and one inspect per kind. */
export type DockerEntityOrchestratorUnaryShape = {
    readonly listContainers: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'container'>,
        unknown,
        EntityReadRequirements
    >
    readonly listImages: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'image'>,
        unknown,
        EntityReadRequirements
    >
    readonly listNetworks: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'network'>,
        unknown,
        EntityReadRequirements
    >
    readonly listVolumes: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<'volume'>,
        unknown,
        EntityReadRequirements
    >
    readonly inspectContainer: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
    readonly inspectImage: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
    readonly inspectNetwork: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
    readonly inspectVolume: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        EntityReadRequirements
    >
}

/** The whole entity facade: the unary calls as Effects, the event stream as RxJS. */
export type DockerEntityOrchestratorShape = DockerEntityOrchestratorUnaryShape &
    DockerEntityStreamsShape

/**
 * Per-kind facade for the unified `docker.entity` API.
 *
 * Each unary read IS the logic: it yields `DockerEntityDomainService` and wraps what the domain returned as the chunks
 * the contract carries. The stream keeps its RxJS shape and arrives through the constructor, because it owns the
 * `EffectHost` runtime touchpoint and cannot be yielded.
 */
export class DockerEntityOrchestratorService extends Context.Service<
    DockerEntityOrchestratorService,
    DockerEntityOrchestratorShape
>()('runtime/DockerEntityOrchestratorService') {
    static readonly live = class DockerEntityOrchestratorServiceImpl
        implements DockerEntityOrchestratorShape
    {
        readonly streamEntities: DockerEntityStreamsShape['streamEntities']

        constructor(streams: DockerEntityStreamsShape) {
            this.streamEntities = streams.streamEntities
        }

        listContainers(
            input: DockerEntityListInput = {} as DockerEntityListInput
        ): Effect.Effect<
            DockerEntityListResult<'container'>,
            unknown,
            EntityReadRequirements
        > {
            return this.listOf('container', (domain) =>
                domain.listContainerEntity(input)
            )
        }

        listImages(
            input: DockerEntityListInput
        ): Effect.Effect<
            DockerEntityListResult<'image'>,
            unknown,
            EntityReadRequirements
        > {
            return this.listOf('image', (domain) =>
                domain.listImageEntity(input)
            )
        }

        listNetworks(
            input: DockerEntityListInput
        ): Effect.Effect<
            DockerEntityListResult<'network'>,
            unknown,
            EntityReadRequirements
        > {
            return this.listOf('network', (domain) =>
                domain.listNetworkEntity(input)
            )
        }

        listVolumes(
            input: DockerEntityListInput
        ): Effect.Effect<
            DockerEntityListResult<'volume'>,
            unknown,
            EntityReadRequirements
        > {
            return this.listOf('volume', (domain) =>
                domain.listVolumeEntity(input)
            )
        }

        inspectContainer(
            input: DockerEntityInspectInput
        ): Effect.Effect<
            DockerEntityStreamChunk | null,
            unknown,
            EntityReadRequirements
        > {
            return this.inspectOf('container', (domain) =>
                domain.inspectContainerEntity(input)
            )
        }

        inspectImage(
            input: DockerEntityInspectInput
        ): Effect.Effect<
            DockerEntityStreamChunk | null,
            unknown,
            EntityReadRequirements
        > {
            return this.inspectOf('image', (domain) =>
                domain.inspectImageEntity(input)
            )
        }

        inspectNetwork(
            input: DockerEntityInspectInput
        ): Effect.Effect<
            DockerEntityStreamChunk | null,
            unknown,
            EntityReadRequirements
        > {
            return this.inspectOf('network', (domain) =>
                domain.inspectNetworkEntity(input)
            )
        }

        inspectVolume(
            input: DockerEntityInspectInput
        ): Effect.Effect<
            DockerEntityStreamChunk | null,
            unknown,
            EntityReadRequirements
        > {
            return this.inspectOf('volume', (domain) =>
                domain.inspectVolumeEntity(input)
            )
        }

        /** A cached domain list, turned into the chunks and etag the list contract returns. */
        private listOf<TKind extends DockerEntityKind>(
            kind: TKind,
            fetch: (
                domain: DockerEntityDomainService['Service']
            ) => Effect.Effect<
                { entities: readonly unknown[]; etag: string; hit: boolean },
                unknown,
                EntityReadRequirements
            >
        ): Effect.Effect<
            DockerEntityListResult<TKind>,
            unknown,
            EntityReadRequirements
        > {
            return Effect.gen(function* () {
                const domain = yield* DockerEntityDomainService
                const result = yield* fetch(domain)
                return {
                    kind,
                    data: buildListChunks(
                        kind,
                        result.entities,
                        new Date().toISOString(),
                        chunkLog
                    ),
                    etag: result.etag,
                    hit: result.hit,
                }
            })
        }

        /** A domain inspect, turned into the chunk an event stream would have produced. */
        private inspectOf<TKind extends DockerEntityKind>(
            kind: TKind,
            fetch: (
                domain: DockerEntityDomainService['Service']
            ) => Effect.Effect<
                { entity: unknown; etag: string },
                unknown,
                EntityReadRequirements
            >
        ): Effect.Effect<
            DockerEntityStreamChunk | null,
            unknown,
            EntityReadRequirements
        > {
            return Effect.gen(function* () {
                const domain = yield* DockerEntityDomainService
                const result = yield* fetch(domain)
                return buildInspectChunk(
                    kind,
                    result.entity,
                    new Date().toISOString(),
                    chunkLog
                )
            })
        }
    }

    /** The token's instance type: `DockerController` injects it and reads `streamEntities` straight off it. */
    declare readonly streamEntities: DockerEntityStreamsShape['streamEntities']
}
