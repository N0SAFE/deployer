import { Context, Effect } from 'effect'

import {
    type DockerContainer,
    type DockerContainerEntity,
    type DockerEntityKind,
    type DockerEntityStreamChunk,
    type DockerImage,
    type DockerImageEntity,
    type DockerNetwork,
    type DockerNetworkEntity,
    type DockerRuntimeEvent,
    type DockerVolume,
    type DockerVolumeEntity,
} from '@deployer/contracts-entities'
import type { DockerEntityListInput } from '@deployer/runtime-contracts/modules/docker/entity/shared'
import type { DockerEntityInspectInput } from '@deployer/runtime-contracts/modules/docker/entity/shared'

import {
    CatalogLocalPort,
    CatalogMeshPort,
    DockerCatalog,
} from '../../../catalog/docker-catalog'
import {
    ContainersLocalPort,
    ContainersMeshPort,
    DockerContainerResolution,
} from '../../containers/orchestration/docker-container-resolution'
import {
    DockerImages,
    DockerImageCatalogPort,
} from '../../images/orchestration/docker-images.service'

import { DockerEntityCachePort } from './docker-entity-cache.port'
import {
    buildEventChunk,
    buildRemovedChunk,
    fingerprintEtag,
    isRemovalAction,
    wrapAsEntity,
} from './entity-stream-rules'

/** How long a cached entity list is served before it is fetched again. */
const LIST_TTL_MS = 2_000

export type DockerEntityListResult<TFlat, TEntity> = {
    flat: TFlat[]
    entities: TEntity[]
    etag: string
    hit: boolean
}

export type DockerEntityInspectResult<TEntity> = {
    entity: TEntity | null
    etag: string
}

/** Everything a caller must be able to see for these reads to run. */
export type DockerEntityDomainPorts =
    | DockerContainerResolution
    | ContainersMeshPort
    | ContainersLocalPort
    | DockerImages
    | DockerImageCatalogPort
    | DockerCatalog
    | CatalogMeshPort
    | CatalogLocalPort
    | DockerEntityCachePort

export type DockerEntityDomainShape = {
    readonly listContainerEntity: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<DockerContainer, DockerContainerEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly listImageEntity: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<DockerImage, DockerImageEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly listNetworkEntity: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<DockerNetwork, DockerNetworkEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly listVolumeEntity: (
        input: DockerEntityListInput
    ) => Effect.Effect<
        DockerEntityListResult<DockerVolume, DockerVolumeEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly inspectContainerEntity: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityInspectResult<DockerContainerEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly inspectImageEntity: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityInspectResult<DockerImageEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly inspectNetworkEntity: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityInspectResult<DockerNetworkEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    readonly inspectVolumeEntity: (
        input: DockerEntityInspectInput
    ) => Effect.Effect<
        DockerEntityInspectResult<DockerVolumeEntity>,
        unknown,
        DockerEntityDomainPorts
    >
    /** The chunk a runtime event stands for, or null when it is a kind this facade does not carry. */
    readonly enrichEvent: (
        event: DockerRuntimeEvent
    ) => Effect.Effect<
        DockerEntityStreamChunk | null,
        unknown,
        DockerEntityDomainPorts
    >
}

/**
 * The entity reads behind `docker.entity`.
 *
 * Every read IS the logic: it yields the collaborator that serves it (`DockerContainerResolution`, `DockerImages`,
 * `DockerCatalog`, the cache port) where it uses it, so a handler's `R` names them and the requirement gate audits
 * them. `fetchList`/`inspectEntity` are the two helpers more than one read shares.
 *
 * Streams are NOT here: `DockerEntityOrchestratorService` owns the RxJS boundary.
 */
export class DockerEntityDomainService extends Context.Service<
    DockerEntityDomainService,
    DockerEntityDomainShape
>()('runtime/DockerEntityDomainService') {
    static readonly live = class DockerEntityDomainServiceImpl
        implements DockerEntityDomainShape
    {
        /**
         * A cached list: the fetch runs only on a miss, then the flat rows are wrapped as entities. The cache is a
         * port, so the fetch Effect runs against the context this operation already has.
         */
        private fetchList<TFlat, TEntity>(
            kind: DockerEntityKind,
            fetch: Effect.Effect<TFlat[], unknown, DockerEntityDomainPorts>
        ): Effect.Effect<
            DockerEntityListResult<TFlat, TEntity>,
            unknown,
            DockerEntityDomainPorts
        > {
            return Effect.gen(function* () {
                const cache = yield* DockerEntityCachePort
                const context = yield* Effect.context<DockerEntityDomainPorts>()
                const { payload, etag, hit } = yield* Effect.tryPromise({
                    try: () =>
                        cache.getOrCompute(kind, async () => ({
                            payload: await Effect.runPromise(
                                Effect.provideContext(fetch, context)
                            ),
                            ttlMs: LIST_TTL_MS,
                        })),
                    catch: (error) => error,
                })
                const entities = payload.map((flat) =>
                    wrapAsEntity<TEntity>(flat)
                )
                return { flat: payload, entities, etag, hit }
            })
        }

        /** An inspect read: a miss (or a failed lookup) is `entity: null` plus a stable missing etag. */
        private inspectEntity<TEntity>(
            kind: DockerEntityKind,
            input: DockerEntityInspectInput,
            fetch: Effect.Effect<
                TEntity | null,
                unknown,
                DockerEntityDomainPorts
            >
        ): Effect.Effect<
            DockerEntityInspectResult<TEntity>,
            unknown,
            DockerEntityDomainPorts
        > {
            return Effect.map(
                fetch.pipe(Effect.catch(() => Effect.succeed(null))),
                (entity) => ({
                    entity,
                    etag: entity
                        ? fingerprintEtag(entity)
                        : `"missing-${kind}-${input.id}"`,
                })
            )
        }

        listContainerEntity(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityDomainShape['listContainerEntity']> {
            return this.fetchList<DockerContainer, DockerContainerEntity>(
                'container',
                Effect.flatMap(DockerContainerResolution, (resolution) =>
                    resolution
                        .listContainers({
                            limit: input.limit,
                            offset: input.offset,
                        })
                        .pipe(Effect.map((result) => result.data))
                )
            )
        }

        listImageEntity(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityDomainShape['listImageEntity']> {
            return this.fetchList<DockerImage, DockerImageEntity>(
                'image',
                Effect.flatMap(DockerImages, (images) =>
                    images
                        .list({ limit: input.limit, offset: input.offset })
                        .pipe(Effect.map((result) => result.data))
                )
            )
        }

        listNetworkEntity(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityDomainShape['listNetworkEntity']> {
            return this.fetchList<DockerNetwork, DockerNetworkEntity>(
                'network',
                Effect.flatMap(DockerCatalog, (catalog) =>
                    catalog
                        .listNetworks({
                            limit: input.limit,
                            offset: input.offset,
                        })
                        .pipe(Effect.map((result) => result.data))
                )
            )
        }

        listVolumeEntity(
            input: DockerEntityListInput
        ): ReturnType<DockerEntityDomainShape['listVolumeEntity']> {
            return this.fetchList<DockerVolume, DockerVolumeEntity>(
                'volume',
                Effect.flatMap(DockerCatalog, (catalog) =>
                    catalog
                        .listVolumes({
                            limit: input.limit,
                            offset: input.offset,
                        })
                        .pipe(Effect.map((result) => result.data))
                )
            )
        }

        inspectContainerEntity(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityDomainShape['inspectContainerEntity']> {
            return this.inspectEntity<DockerContainerEntity>(
                'container',
                input,
                Effect.flatMap(DockerContainerResolution, (resolution) =>
                    resolution.listContainers({ limit: 500, offset: 0 }).pipe(
                        Effect.map(
                            (list): DockerContainerEntity | null => {
                                const found = list.data.find(
                                    (container) => container.id === input.id
                                )
                                return found
                                    ? { ...found, relations: undefined }
                                    : null
                            }
                        )
                    )
                )
            )
        }

        inspectImageEntity(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityDomainShape['inspectImageEntity']> {
            return this.inspectEntity<DockerImageEntity>(
                'image',
                input,
                Effect.flatMap(DockerImages, (images) =>
                    images.list({ limit: 500, offset: 0 }).pipe(
                        Effect.map((list): DockerImageEntity | null => {
                            const found = list.data.find(
                                (image) => image.id === input.id
                            )
                            return found
                                ? { ...found, relations: undefined }
                                : null
                        })
                    )
                )
            )
        }

        inspectNetworkEntity(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityDomainShape['inspectNetworkEntity']> {
            return this.inspectEntity<DockerNetworkEntity>(
                'network',
                input,
                Effect.flatMap(DockerCatalog, (catalog) =>
                    catalog.listNetworks({ limit: 500, offset: 0 }).pipe(
                        Effect.map((list): DockerNetworkEntity | null => {
                            const found = list.data.find(
                                (network) => network.id === input.id
                            )
                            return found
                                ? { ...found, relations: undefined }
                                : null
                        })
                    )
                )
            )
        }

        inspectVolumeEntity(
            input: DockerEntityInspectInput
        ): ReturnType<DockerEntityDomainShape['inspectVolumeEntity']> {
            return this.inspectEntity<DockerVolumeEntity>(
                'volume',
                input,
                Effect.flatMap(DockerCatalog, (catalog) =>
                    catalog.listVolumes({ limit: 500, offset: 0 }).pipe(
                        Effect.map((list): DockerVolumeEntity | null => {
                            const found = list.data.find(
                                (volume) => volume.name === input.id
                            )
                            return found
                                ? { ...found, relations: undefined }
                                : null
                        })
                    )
                )
            )
        }

        enrichEvent(
            event: DockerRuntimeEvent
        ): ReturnType<DockerEntityDomainShape['enrichEvent']> {
            return Effect.gen({ self: this }, function* () {
                const id = event.actorId
                if (!id) {
                    return null
                }

                if (isRemovalAction(event.source, event.action)) {
                    const kind = event.source
                    if (
                        kind !== 'container' &&
                        kind !== 'image' &&
                        kind !== 'network' &&
                        kind !== 'volume'
                    )
                        return null
                    return buildRemovedChunk(kind, event, id)
                }

                if (event.source === 'container') {
                    const { entity } = yield* this.inspectContainerEntity({
                        kind: 'container',
                        id,
                    })
                    return entity
                        ? buildEventChunk('container', entity, event)
                        : null
                }
                if (event.source === 'image') {
                    const { entity } = yield* this.inspectImageEntity({
                        kind: 'image',
                        id,
                    })
                    return entity ? buildEventChunk('image', entity, event) : null
                }
                if (event.source === 'network') {
                    const { entity } = yield* this.inspectNetworkEntity({
                        kind: 'network',
                        id,
                    })
                    return entity
                        ? buildEventChunk('network', entity, event)
                        : null
                }
                if (event.source === 'volume') {
                    const { entity } = yield* this.inspectVolumeEntity({
                        kind: 'volume',
                        id,
                    })
                    return entity
                        ? buildEventChunk('volume', entity, event)
                        : null
                }
                return null
            })
        }
    }
}
