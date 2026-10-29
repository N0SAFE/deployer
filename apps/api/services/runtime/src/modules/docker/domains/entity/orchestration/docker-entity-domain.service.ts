import { Observable, type Subscriber } from "rxjs"
import type { DockerEntityListInput } from "@deployer/runtime-contracts/modules/docker/entity/shared"
import type { DockerEntityInspectInput } from "@deployer/runtime-contracts/modules/docker/entity/shared"
import {
  dockerEntityStreamChunkSchema,
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
} from "@deployer/contracts-entities"
import { AppLogger } from "@deployer/logger"
import type { DockerContainerInspectDetail } from "@deployer/contracts-entities"
import { withContainerResolution } from "../../containers/orchestration/docker-container-resolution"
import { DockerImagesOrchestratorService } from "../../images/orchestration/docker-images-orchestrator.service"
import type { DockerNetworkListInput } from "@deployer/runtime-contracts/modules/docker/networks/list"
import type { DockerVolumeListInput } from "@deployer/runtime-contracts/modules/docker/volumes/list"
import { EffectRuntime } from "@deployer/nest-effect"
import { Effect } from "effect"
import { DockerCatalog } from "../../../catalog/docker-catalog"
import { DockerRuntimeEventsStreamService } from "../../../common/events/docker-runtime-events-stream.service"
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index"
import {
  buildEventChunk,
  buildRemovedChunk,
  buildStreamFilter,
  eventMatchesFilter,
  fingerprintEtag,
  isRemovalAction,
  poolKeyFor,
  wrapAsEntity,
  type EntityFilterInput,
} from "./entity-stream-rules"
import { DockerEntityCacheService } from "./docker-entity-cache.service"
import { isRecord, isObjectLike } from "@deployer/type-guards"



/** How long a cached entity list is served before it is fetched again. */
const LIST_TTL_MS = 2_000

type ListKindResult<TFlat, TEntity> = {
  flat: TFlat[]
  entities: TEntity[]
  etag: string
  hit: boolean
}

type InspectKindResult<TEntity> = {
  entity: TEntity | null
  etag: string
}

export class DockerEntityDomainService {
  private readonly apiLogger = new AppLogger("api").scope(DockerEntityDomainService.name)
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerEntityDomainService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-entity-domain",
  })

  constructor(
    private readonly dockerImagesOrchestratorService: DockerImagesOrchestratorService,
    private readonly effectRuntime: EffectRuntime,
    private readonly dockerRuntimeEventsStreamService: DockerRuntimeEventsStreamService,
    private readonly coreEventStreamPoolService: CoreEventStreamPoolService,
    private readonly dockerEntityCacheService: DockerEntityCacheService,
  ) {}

  // ---------------------------------------------------------------------------
  // list endpoints
  // ---------------------------------------------------------------------------

  async listContainerEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerContainer, DockerContainerEntity>> {
    return this.fetchList("container", input, async () => {
      const result = await withContainerResolution(this.effectRuntime, (resolution) => resolution.listContainers({
        limit: input.limit,
        offset: input.offset,
      }))
      return result.data
    })
  }

  /** The mesh-wide network list, run on the app's Effect runtime. */
  private listNetworksOfCatalog(input: DockerNetworkListInput) {
    return this.effectRuntime.runPromise(
      Effect.gen(function* () {
        const catalog = yield* DockerCatalog
        return yield* catalog.listNetworks(input)
      }),
    )
  }

  /** The mesh-wide volume list, run on the app's Effect runtime. */
  private listVolumesOfCatalog(input: DockerVolumeListInput) {
    return this.effectRuntime.runPromise(
      Effect.gen(function* () {
        const catalog = yield* DockerCatalog
        return yield* catalog.listVolumes(input)
      }),
    )
  }

  async listImageEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerImage, DockerImageEntity>> {
    return this.fetchList("image", input, async () => {
      const result = await this.dockerImagesOrchestratorService.listImages({
        limit: input.limit,
        offset: input.offset,
      })
      return result.data
    })
  }

  async listNetworkEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerNetwork, DockerNetworkEntity>> {
    return this.fetchList("network", input, async () => {
      const result = await this.listNetworksOfCatalog({
        limit: input.limit,
        offset: input.offset,
      })
      return result.data
    })
  }

  async listVolumeEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerVolume, DockerVolumeEntity>> {
    return this.fetchList("volume", input, async () => {
      const result = await this.listVolumesOfCatalog({
        limit: input.limit,
        offset: input.offset,
      })
      return result.data
    })
  }

  // ---------------------------------------------------------------------------
  // inspect endpoints
  // ---------------------------------------------------------------------------

  async inspectContainerEntity(
    input: DockerEntityInspectInput,
  ): Promise<InspectKindResult<DockerContainerEntity>> {
    return this.inspectEntity("container", input, async () => {
      try {
        const detail = await withContainerResolution(this.effectRuntime, (resolution) => resolution.inspectContainer(input.id))
        return this.toContainerEntity(detail)
      } catch {
        return null
      }
    })
  }

  async inspectImageEntity(
    input: DockerEntityInspectInput,
  ): Promise<InspectKindResult<DockerImageEntity>> {
    return this.inspectEntity("image", input, async () => {
      try {
        const detail = await this.dockerImagesOrchestratorService.inspectImage({
          imageId: input.id,
        })
        return this.toImageEntity(detail)
      } catch {
        return null
      }
    })
  }

  async inspectNetworkEntity(
    input: DockerEntityInspectInput,
  ): Promise<InspectKindResult<DockerNetworkEntity>> {
    return this.inspectEntity("network", input, async () => {
      const list = await this.listNetworksOfCatalog({
        limit: 500,
        offset: 0,
      })
      const found = list.data.find((network) => network.id === input.id)
      if (!found) return null
      return { ...found, relations: undefined }
    })
  }

  async inspectVolumeEntity(
    input: DockerEntityInspectInput,
  ): Promise<InspectKindResult<DockerVolumeEntity>> {
    return this.inspectEntity("volume", input, async () => {
      const list = await this.listVolumesOfCatalog({
        limit: 500,
        offset: 0,
      })
      const found = list.data.find((volume) => volume.name === input.id)
      if (!found) return null
      return { ...found, relations: undefined }
    })
  }

  // ---------------------------------------------------------------------------
  // stream
  // ---------------------------------------------------------------------------

  /**
   * Stream of `DockerEntityStreamChunk` values:
   *  - `DockerEntityEvent` (full entity, with relations) for create/update
   *  - `DockerEntityRemovedEvent` (id-only) for destroy/die/delete
   *
   * Subscriptions are pooled per (kinds, actions) tuple so multiple pages
   * share a single upstream connection to the docker daemon.
   */
  streamEntities(input: EntityFilterInput): Observable<DockerEntityStreamChunk> {
    const filter = buildStreamFilter(input)
    return this.coreEventStreamPoolService.observePooledStream<DockerEntityStreamChunk>(
      poolKeyFor(input),
      () => this.createEntityStream(filter),
      { bufferSize: 1 },
    )
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private createEntityStream(filter: unknown) {
    return new Observable<DockerEntityStreamChunk>(
      (subscriber: Subscriber<DockerEntityStreamChunk>) => {
        const subscription = this.dockerRuntimeEventsStreamService
          .observeEvents()
          .subscribe({
            next: (event) => {
              // Invalidate the per-kind list cache on any docker event
              // for that kind. The TTL is 2s, so this is a defensive
              // optimization on top of the natural decay — but it
              // matters when the same page holds a long-lived
              // subscription and the list query fires at high frequency
              // (e.g. a dashboard polling every 500ms).
              if (
                event.source === "container"
                || event.source === "image"
                || event.source === "network"
                || event.source === "volume"
              ) {
                this.dockerEntityCacheService.invalidate(event.source)
              }
              if (!eventMatchesFilter(event, filter)) {
                return
              }
              void this.enrichEvent(event)
                .then((chunk) => {
                  if (chunk) {
                    subscriber.next(chunk)
                  }
                })
                .catch((error) => {
                  this.debugLogger.debug("enrichEvent", {
                    phase: "enrich_failed",
                    message: error instanceof Error ? error.message : String(error),
                  })
                })
            },
            error: (error) => { subscriber.error(error); },
            complete: () => { subscriber.complete(); },
          })
        return () => { subscription.unsubscribe(); }
      },
    )
  }

  private async enrichEvent(event: DockerRuntimeEvent): Promise<DockerEntityStreamChunk | null> {
    const id = event.actorId
    if (!id) {
      return null
    }

    const isRemoval = isRemovalAction(event.source, event.action)

    if (event.source === "container") {
      if (isRemoval) return buildRemovedChunk("container", event, id)
      return this.wrapEventEntity("container", event, () =>
        this.inspectContainerEntity({ kind: "container", id }),
      )
    }
    if (event.source === "image") {
      if (isRemoval) return buildRemovedChunk("image", event, id)
      return this.wrapEventEntity("image", event, () =>
        this.inspectImageEntity({ kind: "image", id }),
      )
    }
    if (event.source === "network") {
      if (isRemoval) return buildRemovedChunk("network", event, id)
      return this.wrapEventEntity("network", event, () =>
        this.inspectNetworkEntity({ kind: "network", id }),
      )
    }
    if (event.source === "volume") {
      if (isRemoval) return buildRemovedChunk("volume", event, id)
      return this.wrapEventEntity("volume", event, () =>
        this.inspectVolumeEntity({ kind: "volume", id }),
      )
    }
    return null
  }

  private async wrapEventEntity(
    kind: DockerEntityKind,
    event: DockerRuntimeEvent,
    fetcher: () => Promise<InspectKindResult<unknown>>,
  ): Promise<DockerEntityStreamChunk | null> {
    const { entity } = await fetcher()
    if (!entity) {
      return null
    }
    return buildEventChunk(kind, entity, event)
  }

  private async fetchList<TKind extends DockerEntityKind, TFlat, TEntity>(
    kind: TKind,
    input: DockerEntityListInput,
    fetcher: () => Promise<TFlat[]>,
  ): Promise<ListKindResult<TFlat, TEntity>> {
    const { payload, etag, hit } = await this.dockerEntityCacheService.getOrCompute(
      kind,
      async () => {
        const flat = await fetcher()
        return { payload: flat, ttlMs: LIST_TTL_MS }
      },
    )
    const flatList = payload
    const entities = flatList.map((flat) => wrapAsEntity<TEntity>(flat)) as TEntity[]
    return { flat: flatList, entities, etag, hit }
  }

  private async inspectEntity<TKind extends DockerEntityKind, TEntity>(
    kind: TKind,
    input: DockerEntityInspectInput,
    fetcher: () => Promise<TEntity | null>,
  ): Promise<InspectKindResult<TEntity>> {
    try {
      const entity = await fetcher()
      return {
        entity,
        etag: entity
          ? fingerprintEtag(entity)
          : `"missing-${kind}-${input.id}"`,
      }
    } catch {
      return { entity: null, etag: `"missing-${kind}-${input.id}"` }
    }
  }

  private toContainerEntity(
    detail: DockerContainerInspectDetail,
  ): DockerContainerEntity {
    // detail has inspect shape, entity has list shape — different schemas.
    // The downstream code uses the normalized entity; this conversion bridge is
    // needed because both are valid representations of the same container.
    return {
      ...(detail as unknown as DockerContainer),
      relations: undefined,
    }
  }

  private toImageEntity(
    detail: Awaited<ReturnType<DockerImagesOrchestratorService["inspectImage"]>>,
  ): DockerImageEntity {
    return {
      ...(detail as unknown as DockerImage),
      relations: undefined,
    }
  }

  // `dockerEntityStreamChunkSchema` is referenced here so the schema stays
  // import-graph-clean even when no other module pulls it in directly.
  private readonly _chunkSchema = dockerEntityStreamChunkSchema
}
