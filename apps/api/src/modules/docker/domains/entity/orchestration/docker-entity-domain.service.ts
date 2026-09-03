import { Injectable } from "@nestjs/common"
import { Observable, type Subscriber } from "rxjs"
import type { DockerEntityListInput } from "@repo/api-contracts/modules/docker/entity/shared"
import type { DockerEntityInspectInput } from "@repo/api-contracts/modules/docker/entity/shared"
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
} from "@repo/contracts-entities"
import { AppLogger } from "@repo/logger"
import { DockerContainerResolutionService } from "../../containers/orchestration/docker-container-resolution.service"
import { DockerImagesOrchestratorService } from "../../images/orchestration/docker-images-orchestrator.service"
import { DockerVolumesOrchestratorService } from "../../volumes/orchestration/docker-volumes-orchestrator.service"
import { DockerNetworksOrchestratorService } from "../../networks/orchestration/docker-networks-orchestrator.service"
import { DockerRuntimeEventsStreamService } from "../../../common/events/docker-runtime-events-stream.service"
import { CoreEventStreamPoolService } from "@repo/nest-events"
import { DockerEntityCacheService } from "./docker-entity-cache.service"
import { isRecord, isObjectLike } from "@repo/type-guards"



const KINDS_WITH_FLAT_LIST: ReadonlySet<DockerEntityKind> = new Set<DockerEntityKind>([
  "container",
  "image",
  "network",
  "volume",
])

interface ListKindResult<TFlat, TEntity> {
  flat: TFlat[]
  entities: TEntity[]
  etag: string
  hit: boolean
}

interface InspectKindResult<TEntity> {
  entity: TEntity | null
  etag: string
}

interface EntityFilterInput {
  kinds?: readonly DockerEntityKind[]
  actions?: {
    container?: readonly string[]
    image?: readonly string[]
    network?: readonly string[]
    volume?: readonly string[]
  }
}

@Injectable()
export class DockerEntityDomainService {
  private readonly apiLogger = new AppLogger("api").scope(DockerEntityDomainService.name)
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerEntityDomainService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-entity-domain",
  })

  constructor(
    private readonly dockerContainerResolutionService: DockerContainerResolutionService,
    private readonly dockerImagesOrchestratorService: DockerImagesOrchestratorService,
    private readonly dockerNetworksOrchestratorService: DockerNetworksOrchestratorService,
    private readonly dockerVolumesOrchestratorService: DockerVolumesOrchestratorService,
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
      const result = await this.dockerContainerResolutionService.listContainers({
        limit: input.limit,
        offset: input.offset,
      } as Parameters<typeof this.dockerContainerResolutionService.listContainers>[0])
      return result.data as DockerContainer[]
    })
  }

  async listImageEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerImage, DockerImageEntity>> {
    return this.fetchList("image", input, async () => {
      const result = await this.dockerImagesOrchestratorService.listImages({
        limit: input.limit,
        offset: input.offset,
      } as Parameters<typeof this.dockerImagesOrchestratorService.listImages>[0])
      return result.data as DockerImage[]
    })
  }

  async listNetworkEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerNetwork, DockerNetworkEntity>> {
    return this.fetchList("network", input, async () => {
      const result = await this.dockerNetworksOrchestratorService.listNetworks({
        limit: input.limit,
        offset: input.offset,
      } as Parameters<typeof this.dockerNetworksOrchestratorService.listNetworks>[0])
      return result.data as DockerNetwork[]
    })
  }

  async listVolumeEntity(
    input: DockerEntityListInput,
  ): Promise<ListKindResult<DockerVolume, DockerVolumeEntity>> {
    return this.fetchList("volume", input, async () => {
      const result = await this.dockerVolumesOrchestratorService.listVolumes({
        limit: input.limit,
        offset: input.offset,
      } as Parameters<typeof this.dockerVolumesOrchestratorService.listVolumes>[0])
      return result.data as DockerVolume[]
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
        const detail = await this.dockerContainerResolutionService.inspectContainer(input.id)
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
      const list = await this.dockerNetworksOrchestratorService.listNetworks({
        limit: 500,
        offset: 0,
      })
      const found = list.data.find((network) => network.id === input.id)
      if (!found) return null
      return { ...found, relations: undefined } as DockerNetworkEntity
    })
  }

  async inspectVolumeEntity(
    input: DockerEntityInspectInput,
  ): Promise<InspectKindResult<DockerVolumeEntity>> {
    return this.inspectEntity("volume", input, async () => {
      const list = await this.dockerVolumesOrchestratorService.listVolumes({
        limit: 500,
        offset: 0,
      })
      const found = list.data.find((volume) => volume.name === input.id)
      if (!found) return null
      return { ...found, relations: undefined } as DockerVolumeEntity
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
    const filter = this.buildStreamFilter(input)
    return this.coreEventStreamPoolService.observePooledStream<DockerEntityStreamChunk>(
      this.poolKeyFor(input),
      () => this.createEntityStream(filter),
      { bufferSize: 1 },
    )
  }

  // ---------------------------------------------------------------------------
  // Internals
  // ---------------------------------------------------------------------------

  private poolKeyFor(input: EntityFilterInput): string {
    const kinds = (input.kinds ?? ["container", "image", "network", "volume"])
      .slice()
      .sort()
      .join(",")
    const actions = JSON.stringify(input.actions ?? {})
    return `docker-entity-events|kinds:${kinds}|actions:${actions}`
  }

  private buildStreamFilter(input: EntityFilterInput) {
    const kinds = input.kinds ?? ["container", "image", "network", "volume"]
    const actions = input.actions ?? {}
    const nodes = kinds.map((kind) => {
      const kindActions = actions[kind] ?? []
      return {
        source: { operator: "eq" as const, value: kind },
        ...(kindActions.length > 0
          ? { action: { operator: "in" as const, value: kindActions } }
          : {}),
      }
    })
    if (nodes.length === 0) {
      return undefined
    }
    if (nodes.length === 1) {
      return nodes[0]
    }
    return { _or: nodes }
  }

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
              if (!this.eventMatchesFilter(event, filter)) {
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
            error: (error) => subscriber.error(error),
            complete: () => subscriber.complete(),
          })
        return () => subscription.unsubscribe()
      },
    )
  }

  private eventMatchesFilter(event: DockerRuntimeEvent, filter: unknown): boolean {
    if (!filter) return true
    const node = isRecord(filter) ? filter : {}
    const sourceClause = node.source as { value?: string } | undefined
    if (sourceClause && sourceClause.value && sourceClause.value !== event.source) {
      return false
    }
    const actionClause = node.action as { value?: string[] } | undefined
    if (
      actionClause &&
      Array.isArray(actionClause.value) &&
      actionClause.value.length > 0 &&
      !actionClause.value.includes(event.action)
    ) {
      return false
    }
    return true
  }

  private async enrichEvent(event: DockerRuntimeEvent): Promise<DockerEntityStreamChunk | null> {
    const id = event.actorId
    if (!id) {
      return null
    }

    const isRemoval = this.isRemovalAction(event.source, event.action)

    if (event.source === "container") {
      if (isRemoval) return this.removedEvent("container", event, id)
      return this.wrapEventEntity("container", event, () =>
        this.inspectContainerEntity({ kind: "container", id }),
      )
    }
    if (event.source === "image") {
      if (isRemoval) return this.removedEvent("image", event, id)
      return this.wrapEventEntity("image", event, () =>
        this.inspectImageEntity({ kind: "image", id }),
      )
    }
    if (event.source === "network") {
      if (isRemoval) return this.removedEvent("network", event, id)
      return this.wrapEventEntity("network", event, () =>
        this.inspectNetworkEntity({ kind: "network", id }),
      )
    }
    if (event.source === "volume") {
      if (isRemoval) return this.removedEvent("volume", event, id)
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
    return dockerEntityStreamChunkSchema.parse({
      ...(isRecord(entity) ? entity : {}),
      kind,
      action: event.action,
      occurredAt: event.timestamp,
      eventId: event.eventId,
    })
  }

  private removedEvent(
    kind: DockerEntityKind,
    event: DockerRuntimeEvent,
    id: string,
  ): DockerEntityStreamChunk {
    return {
      kind,
      action: event.action as "destroy" | "die" | "delete",
      id,
      occurredAt: event.timestamp,
      eventId: event.eventId,
    }
  }

  private isRemovalAction(source: string, action: string): boolean {
    if (source === "container") {
      return action === "destroy" || action === "die"
    }
    if (source === "image" || source === "volume") {
      return action === "destroy" || action === "delete"
    }
    if (source === "network") {
      return action === "destroy" || action === "remove"
    }
    return false
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
        return { payload: flat, ttlMs: this.listTtlMs() }
      },
    )
    const flatList = payload
    const entities = flatList.map((flat) => this.wrapAsEntity(kind, flat)) as TEntity[]
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
          ? this.fingerprintEtag(entity)
          : `"missing-${kind}-${input.id}"`,
      }
    } catch {
      return { entity: null, etag: `"missing-${kind}-${input.id}"` }
    }
  }

  private wrapAsEntity<TKind extends DockerEntityKind, TFlat, TEntity>(
    kind: TKind,
    flat: TFlat,
  ): TEntity {
    if (!KINDS_WITH_FLAT_LIST.has(kind)) {
      // Generic types are erased at runtime; caller guarantees TFlat = TEntity for non-relation kinds
      return flat as unknown as TEntity
    }
    return {
      ...(isRecord(flat) ? flat : {}),
      relations: undefined,
    } as unknown as TEntity
  }

  private listTtlMs(): number {
    return 2_000
  }

  private fingerprintEtag(payload: unknown): string {
    return `"${JSON.stringify(payload).slice(0, 24).replace(/[^a-z0-9]/gi, "")}"`
  }

  private toContainerEntity(
    detail: Awaited<ReturnType<DockerContainerResolutionService["inspectContainer"]>>,
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
