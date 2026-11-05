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
import type { DockerContainerInspectDetail } from '@deployer/contracts-entities'
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
 * A cached list: the fetch runs only on a miss, then the flat rows are wrapped as entities. The cache is a port, so
 * the fetch Effect is run against the context this method already has.
 */
const fetchList = <TFlat, TEntity>(
    kind: DockerEntityKind,
    fetch: Effect.Effect<TFlat[], unknown, DockerEntityDomainPorts>
): Effect.Effect<
    DockerEntityListResult<TFlat, TEntity>,
    unknown,
    DockerEntityDomainPorts
> =>
    Effect.gen(function* () {
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
        ) as TEntity[]
        return { flat: payload, entities, etag, hit }
    })

/** An inspect read: a miss (or a failed lookup) is `entity: null` plus a stable missing etag. */
const inspect = <TEntity>(
    kind: DockerEntityKind,
    input: DockerEntityInspectInput,
    fetch: Effect.Effect<TEntity | null, unknown, DockerEntityDomainPorts>
): Effect.Effect<
    DockerEntityInspectResult<TEntity>,
    unknown,
    DockerEntityDomainPorts
> =>
    Effect.map(
        fetch.pipe(Effect.catch(() => Effect.succeed(null))),
        (entity) => ({
            entity,
            etag: entity
                ? fingerprintEtag(entity)
                : `"missing-${kind}-${input.id}"`,
        })
    )

const toContainerEntity = (
    detail: DockerContainerInspectDetail
): DockerContainerEntity => {
    // detail has inspect shape, entity has list shape — different schemas.
    // The downstream code uses the normalized entity; this conversion bridge is
    // needed because both are valid representations of the same container.
    return { ...(detail as unknown as DockerContainer), relations: undefined }
}

const toImageEntity = (detail: unknown): DockerImageEntity => ({
    ...(detail as DockerImage),
    relations: undefined,
})

/** The converted entity, or null when the conversion cannot be made. */
const nullableEntity = <TEntity>(convert: () => TEntity): TEntity | null => {
    try {
        return convert()
    } catch {
        return null
    }
}

const listContainerEntity: DockerEntityDomainShape['listContainerEntity'] = (
    input
) =>
    fetchList<DockerContainer, DockerContainerEntity>(
        'container',
        Effect.flatMap(DockerContainerResolution, (resolution) =>
            resolution
                .listContainers({ limit: input.limit, offset: input.offset })
                .pipe(Effect.map((result) => result.data))
        )
    )

const listImageEntity: DockerEntityDomainShape['listImageEntity'] = (input) =>
    fetchList<DockerImage, DockerImageEntity>(
        'image',
        Effect.flatMap(DockerImages, (images) =>
            images
                .list({ limit: input.limit, offset: input.offset })
                .pipe(Effect.map((result) => result.data))
        )
    )

const listNetworkEntity: DockerEntityDomainShape['listNetworkEntity'] = (
    input
) =>
    fetchList<DockerNetwork, DockerNetworkEntity>(
        'network',
        Effect.flatMap(DockerCatalog, (catalog) =>
            catalog
                .listNetworks({ limit: input.limit, offset: input.offset })
                .pipe(Effect.map((result) => result.data))
        )
    )

const listVolumeEntity: DockerEntityDomainShape['listVolumeEntity'] = (input) =>
    fetchList<DockerVolume, DockerVolumeEntity>(
        'volume',
        Effect.flatMap(DockerCatalog, (catalog) =>
            catalog
                .listVolumes({ limit: input.limit, offset: input.offset })
                .pipe(Effect.map((result) => result.data))
        )
    )

const inspectContainerEntity: DockerEntityDomainShape['inspectContainerEntity'] =
    (input) =>
        inspect<DockerContainerEntity>(
            'container',
            input,
            Effect.flatMap(DockerContainerResolution, (resolution) =>
                resolution
                    .inspectContainer(input.id)
                    .pipe(
                        Effect.map((detail) =>
                            nullableEntity(() => toContainerEntity(detail))
                        )
                    )
            )
        )

const inspectImageEntity: DockerEntityDomainShape['inspectImageEntity'] = (
    input
) =>
    inspect<DockerImageEntity>(
        'image',
        input,
        Effect.flatMap(DockerImages, (images) =>
            images
                .inspect({ imageId: input.id })
                .pipe(
                    Effect.map((detail) =>
                        nullableEntity(() => toImageEntity(detail))
                    )
                )
        )
    )

const inspectNetworkEntity: DockerEntityDomainShape['inspectNetworkEntity'] = (
    input
) =>
    inspect<DockerNetworkEntity>(
        'network',
        input,
        Effect.flatMap(DockerCatalog, (catalog) =>
            catalog.listNetworks({ limit: 500, offset: 0 }).pipe(
                Effect.map((list): DockerNetworkEntity | null => {
                    const found = list.data.find(
                        (network) => network.id === input.id
                    )
                    return found ? { ...found, relations: undefined } : null
                })
            )
        )
    )

const inspectVolumeEntity: DockerEntityDomainShape['inspectVolumeEntity'] = (
    input
) =>
    inspect<DockerVolumeEntity>(
        'volume',
        input,
        Effect.flatMap(DockerCatalog, (catalog) =>
            catalog.listVolumes({ limit: 500, offset: 0 }).pipe(
                Effect.map((list): DockerVolumeEntity | null => {
                    const found = list.data.find(
                        (volume) => volume.name === input.id
                    )
                    return found ? { ...found, relations: undefined } : null
                })
            )
        )
    )

const enrichEvent: DockerEntityDomainShape['enrichEvent'] = (event) =>
    Effect.gen(function* () {
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
            const { entity } = yield* inspectContainerEntity({
                kind: 'container',
                id,
            })
            return entity ? buildEventChunk('container', entity, event) : null
        }
        if (event.source === 'image') {
            const { entity } = yield* inspectImageEntity({ kind: 'image', id })
            return entity ? buildEventChunk('image', entity, event) : null
        }
        if (event.source === 'network') {
            const { entity } = yield* inspectNetworkEntity({
                kind: 'network',
                id,
            })
            return entity ? buildEventChunk('network', entity, event) : null
        }
        if (event.source === 'volume') {
            const { entity } = yield* inspectVolumeEntity({
                kind: 'volume',
                id,
            })
            return entity ? buildEventChunk('volume', entity, event) : null
        }
        return null
    })

/**
 * The entity reads behind `docker.entity`, as an Effect service.
 *
 * The collaborators (`DockerContainerResolution`, `DockerImages`, `DockerCatalog`, the cache port) are yielded when a
 * method runs, so a handler's `R` names them and the requirement gate audits them. This used to reach the app-wide
 * runtime directly, which made every one of them invisible.
 *
 * Streams are NOT here: `DockerEntityOrchestratorService.withStreams` is the RxJS boundary.
 */
export class DockerEntityDomainService extends Context.Service<
    DockerEntityDomainService,
    DockerEntityDomainShape
>()('runtime/DockerEntityDomainService') {
    static readonly live: DockerEntityDomainShape = {
        listContainerEntity,
        listImageEntity,
        listNetworkEntity,
        listVolumeEntity,
        inspectContainerEntity,
        inspectImageEntity,
        inspectNetworkEntity,
        inspectVolumeEntity,
        enrichEvent,
    }
}
