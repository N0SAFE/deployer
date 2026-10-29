import { Observable } from "rxjs"
import { map, filter } from "rxjs/operators"
import type {
  DockerEntityListInput,
  DockerEntityInspectInput,
  DockerEntityStreamInput,
} from "@deployer/runtime-contracts/modules/docker/entity/shared"
import {
  type DockerEntityKind,
  type DockerEntityStreamChunk,
  dockerContainerSchema,
  dockerImageSchema,
  dockerNetworkSchema,
  dockerVolumeSchema,
  dockerEntityStreamChunkSchema,
  buildDockerEntityEventChunk,
  type DockerContainer,
  type DockerImage,
  type DockerNetwork,
  type DockerVolume,
} from "@deployer/contracts-entities"
import { AppLogger } from "@deployer/logger"
import { buildInspectChunk, buildListChunks, coerceStreamChunk } from "./entity-chunks"
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
export class DockerEntityOrchestratorService {
  private readonly apiLogger = new AppLogger("api").scope(DockerEntityOrchestratorService.name)
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerEntityOrchestratorService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-entity-orchestrator",
  })

  private readonly scopedLogger = this.apiLogger.log
  private readonly chunkLog = {
    warn: (message: string, context?: Record<string, unknown>) => this.scopedLogger.warn(message, context ?? {}),
    debug: (message: string, context?: Record<string, unknown>) => this.scopedLogger.debug(message, context ?? {}),
  }

  constructor(private readonly dockerEntityDomainService: DockerEntityDomainService) {}

  // ---------------------------------------------------------------------------
  // list
  // ---------------------------------------------------------------------------

  listContainers(input: DockerEntityListInput = {} as DockerEntityListInput): Promise<DockerEntityListResult<"container">> {
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
    return this.dockerEntityDomainService
      .streamEntities({
        kinds: input.kinds,
        actions: input.actions,
      })
      .pipe(
        // ORPC's output validation only runs on synchronous returns, not
        // on each emission of an observable. So we must validate + coerce
        // every emitted chunk here, on the producer side. The `map`
        // operator runs the full chunk schema (with defaults applied) and
        // emits the *parsed* value, so the client never sees `undefined`
        // for fields like `ports`, `serviceId`, etc. Invalid chunks are
        // dropped via `filter`.
        map((chunk) => coerceStreamChunk(chunk, this.chunkLog)),
        filter((chunk): chunk is DockerEntityStreamChunk => chunk !== null),
      )
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
      data: buildListChunks(kind, result.entities, new Date().toISOString(), this.chunkLog),
      etag: result.etag,
      hit: result.hit,
    }
  }

  private async runInspect<TKind extends DockerEntityKind>(
    kind: TKind,
    fetcher: () => Promise<{ entity: unknown | null; etag: string }>,
  ): Promise<DockerEntityStreamChunk | null> {
    const { entity } = await fetcher()
    return buildInspectChunk(kind, entity, new Date().toISOString(), this.chunkLog)
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-entity-orchestrator] ${source}`, context ?? {})
    this.debugLogger.debug(source, context)
  }
}
