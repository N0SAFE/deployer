import { Injectable } from "@nestjs/common"
import { Observable } from "rxjs"
import type {
  DockerEntityListInput,
  DockerEntityInspectInput,
  DockerEntityStreamInput,
} from "@repo/api-contracts/modules/docker/entity/shared"
import {
  type DockerEntityKind,
  type DockerEntityStreamChunk,
} from "@repo/contracts-entities"
import { AppLogger } from "@repo/logger"
import { DockerEntityDomainService } from "./docker-entity-domain.service"

export type DockerEntityListResult<TKind extends DockerEntityKind> = {
  kind: TKind
  data: DockerEntityStreamChunk[]
  etag: string
  hit: boolean
}

/**
 * Per-kind facade for the unified `docker.entity` API. Every public method
 * is type-safe: the kind is encoded in the response and the return shape
 * is the same `DockerEntityStreamChunk` discriminated union regardless of
 * the underlying docker object.
 *
 * The orchestrator stays deliberately thin — all the heavy lifting
 * (cache, runtime enrichment, stream pooling) lives in
 * `DockerEntityDomainService`. This layer's only job is:
 *  1. dispatch by kind for the list/inspect handlers
 *  2. wrap per-kind domain results in the canonical stream-chunk envelope
 *     (so the client can hydrate its in-memory store from the response
 *     directly)
 *  3. expose a single `streamEntities()` entry-point that forwards the
 *     kinds/actions filter to the domain's pooled stream.
 */
@Injectable()
export class DockerEntityOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerEntityOrchestratorService.name)
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerEntityOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-entity-orchestrator",
  })

  private readonly scopedLogger = this.apiLogger.log

  constructor(private readonly dockerEntityDomainService: DockerEntityDomainService) {}

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  listContainers(input: DockerEntityListInput): Promise<DockerEntityListResult<"container">> {
    return this.runList("container", () => this.dockerEntityDomainService.listContainerEntity(input))
  }

  listImages(input: DockerEntityListInput): Promise<DockerEntityListResult<"image">> {
    return this.runList("image", () => this.dockerEntityDomainService.listImageEntity(input))
  }

  listNetworks(input: DockerEntityListInput): Promise<DockerEntityListResult<"network">> {
    return this.runList("network", () => this.dockerEntityDomainService.listNetworkEntity(input))
  }

  listVolumes(input: DockerEntityListInput): Promise<DockerEntityListResult<"volume">> {
    return this.runList("volume", () => this.dockerEntityDomainService.listVolumeEntity(input))
  }

  // ---------------------------------------------------------------------------
  // inspect
  // ---------------------------------------------------------------------------

  inspectContainer(input: DockerEntityInspectInput): Promise<DockerEntityStreamChunk | null> {
    return this.runInspect("container", () => this.dockerEntityDomainService.inspectContainerEntity(input))
  }

  inspectImage(input: DockerEntityInspectInput): Promise<DockerEntityStreamChunk | null> {
    return this.runInspect("image", () => this.dockerEntityDomainService.inspectImageEntity(input))
  }

  inspectNetwork(input: DockerEntityInspectInput): Promise<DockerEntityStreamChunk | null> {
    return this.runInspect("network", () => this.dockerEntityDomainService.inspectNetworkEntity(input))
  }

  inspectVolume(input: DockerEntityInspectInput): Promise<DockerEntityStreamChunk | null> {
    return this.runInspect("volume", () => this.dockerEntityDomainService.inspectVolumeEntity(input))
  }

  // ---------------------------------------------------------------------------
  // stream
  // ---------------------------------------------------------------------------

  streamEntities(input: DockerEntityStreamInput): Observable<DockerEntityStreamChunk> {
    this.debug("streamEntities", {
      kinds: input.kinds,
      actions: input.actions,
    })
    return this.dockerEntityDomainService.streamEntities({
      kinds: input.kinds,
      actions: input.actions,
    })
  }

  // ---------------------------------------------------------------------------
  // internals
  // ---------------------------------------------------------------------------

  private async runList<TKind extends DockerEntityKind>(
    kind: TKind,
    fetcher: () => Promise<{ entities: unknown[]; etag: string; hit: boolean }>,
  ): Promise<DockerEntityListResult<TKind>> {
    const result = await fetcher()
    return {
      kind,
      data: result.entities as DockerEntityStreamChunk[],
      etag: result.etag,
      hit: result.hit,
    }
  }

  private async runInspect<TKind extends DockerEntityKind>(
    kind: TKind,
    fetcher: () => Promise<{ entity: unknown | null; etag: string }>,
  ): Promise<DockerEntityStreamChunk | null> {
    const { entity } = await fetcher()
    if (!entity) {
      return null
    }
    return {
      ...(entity as Record<string, unknown>),
      kind,
      action: "snapshot",
      occurredAt: new Date().toISOString(),
      eventId: null,
    } as unknown as DockerEntityStreamChunk
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-entity-orchestrator] ${source}`, context ?? {})
    this.debugLogger.debug(source, context)
  }
}
