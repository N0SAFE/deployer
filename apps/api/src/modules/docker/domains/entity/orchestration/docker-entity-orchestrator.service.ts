import { Injectable } from "@nestjs/common"
import { Observable } from "rxjs"
import { map, filter } from "rxjs/operators"
import type {
  DockerEntityListInput,
  DockerEntityInspectInput,
  DockerEntityStreamInput,
} from "@repo/api-contracts/modules/docker/entity/shared"
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
        map((chunk) => this.coerceStreamChunk(chunk)),
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
    const occurredAt = new Date().toISOString()
    // Wrap each entity as a `DockerEntityEvent` chunk so the response shape
    // is consistent with `docker.entity.stream` (a client hydrating its
    // in-memory store from a list response uses the exact same reducer as
    // for streamed events). The chunk is built by `buildDockerEntityEventChunk`
    // which runs the full chunk schema — this is the type-safe construction:
    // the result is a fully-typed `DockerEntityStreamChunk` with every
    // default field filled, and any malformed entity is rejected at the
    // Zod layer (no `as unknown as` casts).
    const data: DockerEntityStreamChunk[] = []
    for (const raw of result.entities) {
      const valid = this.validateEntityBase(kind, raw)
      if (!valid) continue
      try {
        const chunk = buildDockerEntityEventChunk({
          kind: kind as Parameters<typeof buildDockerEntityEventChunk>[0]["kind"],
          entity: valid as never,
          action: "snapshot",
          occurredAt,
          eventId: null,
        })
        data.push(chunk as DockerEntityStreamChunk)
      } catch (error) {
        this.scopedLogger.debug(
          "[docker-entity-orchestrator] dropping unconstructible entity in runList",
          { kind, message: error instanceof Error ? error.message : String(error) },
        )
      }
    }
    return {
      kind,
      data,
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
    const valid = this.validateEntityBase(kind, entity)
    if (!valid) {
      return null
    }
    try {
      return buildDockerEntityEventChunk({
        kind: kind as Parameters<typeof buildDockerEntityEventChunk>[0]["kind"],
        entity: valid as never,
        action: "snapshot",
        occurredAt: new Date().toISOString(),
        eventId: null,
      }) as DockerEntityStreamChunk
    } catch (error) {
      this.scopedLogger.debug(
        "[docker-entity-orchestrator] dropping unconstructible entity in runInspect",
        { kind, message: error instanceof Error ? error.message : String(error) },
      )
      return null
    }
  }

  /**
   * Strictly validate a raw entity payload against the per-kind base
   * schema. This is the contract boundary: anything below this line is
   * the source of truth, anything above is a typed `DockerEntityStreamChunk`
   * the client can trust. Returns the parsed (coerced/defaulted) entity
   * on success, or `null` if the entity does not satisfy the contract.
   */
  private validateEntityBase(
    kind: DockerEntityKind,
    raw: unknown,
  ): DockerContainer | DockerImage | DockerNetwork | DockerVolume | null {
    if (kind === "container") {
      const parsed = dockerContainerSchema.safeParse(raw)
      if (!parsed.success) {
        this.scopedLogger.warn(
          "[docker-entity-orchestrator] dropping invalid container entity",
          { issues: parsed.error.issues },
        )
        return null
      }
      return parsed.data
    }
    if (kind === "image") {
      const parsed = dockerImageSchema.safeParse(raw)
      if (!parsed.success) {
        this.scopedLogger.warn(
          "[docker-entity-orchestrator] dropping invalid image entity",
          { issues: parsed.error.issues },
        )
        return null
      }
      return parsed.data
    }
    if (kind === "network") {
      const parsed = dockerNetworkSchema.safeParse(raw)
      if (!parsed.success) {
        this.scopedLogger.warn(
          "[docker-entity-orchestrator] dropping invalid network entity",
          { issues: parsed.error.issues },
        )
        return null
      }
      return parsed.data
    }
    if (kind === "volume") {
      const parsed = dockerVolumeSchema.safeParse(raw)
      if (!parsed.success) {
        this.scopedLogger.warn(
          "[docker-entity-orchestrator] dropping invalid volume entity",
          { issues: parsed.error.issues },
        )
        return null
      }
      return parsed.data
    }
    return null
  }

  /**
   * Validate a stream chunk against the canonical contract AND return
   * the coerced value. The `dockerEntityStreamChunkSchema` encodes the
   * per-kind entity shape via the discriminated union, so a single
   * `safeParse` fills every default (e.g. `ports: []`) and rejects
   * genuinely broken payloads. Returns the parsed chunk on success, or
   * `null` to drop the chunk from the stream.
   *
   * This is the producer-side boundary: orpc's output validation only
   * runs on synchronous returns, not on each observable emission, so
   * we must coerce here to guarantee the web client never sees
   * `undefined` for any contracted field.
   */
  private coerceStreamChunk(chunk: unknown): DockerEntityStreamChunk | null {
    const result = dockerEntityStreamChunkSchema.safeParse(chunk)
    if (!result.success) {
      this.scopedLogger.debug(
        "[docker-entity-orchestrator] dropping invalid stream chunk",
        { issues: result.error.issues },
      )
      return null
    }
    return result.data
  }

  private debug(source: string, context?: Record<string, unknown>): void {
    this.scopedLogger.info(`[docker-entity-orchestrator] ${source}`, context ?? {})
    this.debugLogger.debug(source, context)
  }
}
