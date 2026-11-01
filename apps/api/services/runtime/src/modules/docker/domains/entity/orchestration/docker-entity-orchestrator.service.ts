import type {
  DockerEntityListInput,
  DockerEntityInspectInput,
} from "@deployer/runtime-contracts/modules/docker/entity/shared"
import type { DockerEntityKind, DockerEntityStreamChunk } from "@deployer/contracts-entities"
import { AppLogger } from "@deployer/logger"
import { Context, Effect } from "effect"
import { buildInspectChunk, buildListChunks, type EntityChunkLog } from "./entity-chunks"
import { DockerEntityDomainService, type DockerEntityDomainPorts } from "./docker-entity-domain.service"
import type { DockerEntityStreamsShape } from "./docker-entity-streams"

export type DockerEntityListResult<TKind extends DockerEntityKind> = {
  kind: TKind
  data: DockerEntityStreamChunk[]
  etag: string
  hit: boolean
}

const apiLogger = new AppLogger("api").scope("DockerEntityOrchestratorService")
const debugLogger = apiLogger.createContextFilterLogger({
  defaultClassName: "DockerEntityOrchestratorService",
  filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
  channel: "docker-entity-orchestrator",
})

const chunkLog: EntityChunkLog = {
  warn: (message, context) => apiLogger.log.warn(message, context ?? {}),
  debug: (message, context) => apiLogger.log.debug(message, context ?? {}),
}

/** The chunk-sink the list/inspect builders and the stream coercer share. */
export const entityChunkLog: EntityChunkLog = chunkLog

export const entityDebug = (source: string, context?: Record<string, unknown>): void => {
  apiLogger.log.info(`[docker-entity-orchestrator] ${source}`, context ?? {})
  debugLogger.debug(source, context)
}

const listOf = <TKind extends DockerEntityKind, TEntity>(
  kind: TKind,
  fetch: (
    domain: DockerEntityDomainService["Service"],
  ) => Effect.Effect<{ entities: TEntity[]; etag: string; hit: boolean }, unknown, DockerEntityDomainPorts>,
) =>
  Effect.flatMap(DockerEntityDomainService, (domain) =>
    Effect.map(fetch(domain), (result) => ({
      kind,
      data: buildListChunks(kind, result.entities, new Date().toISOString(), chunkLog),
      etag: result.etag,
      hit: result.hit,
    })),
  )

const inspectOf = <TKind extends DockerEntityKind>(
  kind: TKind,
  fetch: (
    domain: DockerEntityDomainService["Service"],
  ) => Effect.Effect<{ entity: unknown | null; etag: string }, unknown, DockerEntityDomainPorts>,
) =>
  Effect.flatMap(DockerEntityDomainService, (domain) =>
    Effect.map(fetch(domain), (result) => buildInspectChunk(kind, result.entity, new Date().toISOString(), chunkLog)),
  )

const makeUnary = () => ({
  listContainers: (input: DockerEntityListInput = {} as DockerEntityListInput) =>
    listOf("container", (domain) => domain.listContainerEntity(input)),
  listImages: (input: DockerEntityListInput) => listOf("image", (domain) => domain.listImageEntity(input)),
  listNetworks: (input: DockerEntityListInput) => listOf("network", (domain) => domain.listNetworkEntity(input)),
  listVolumes: (input: DockerEntityListInput) => listOf("volume", (domain) => domain.listVolumeEntity(input)),

  inspectContainer: (input: DockerEntityInspectInput) =>
    inspectOf("container", (domain) => domain.inspectContainerEntity(input)),
  inspectImage: (input: DockerEntityInspectInput) => inspectOf("image", (domain) => domain.inspectImageEntity(input)),
  inspectNetwork: (input: DockerEntityInspectInput) =>
    inspectOf("network", (domain) => domain.inspectNetworkEntity(input)),
  inspectVolume: (input: DockerEntityInspectInput) => inspectOf("volume", (domain) => domain.inspectVolumeEntity(input)),
})

export type DockerEntityOrchestratorUnaryShape = ReturnType<typeof makeUnary>

/** The services a caller must be able to see for any unary call to run. */
export type DockerEntityOrchestratorPorts = {
  [K in keyof DockerEntityOrchestratorUnaryShape]: Effect.Services<
    ReturnType<DockerEntityOrchestratorUnaryShape[K]>
  >
}[keyof DockerEntityOrchestratorUnaryShape]

/** The whole entity facade: the unary calls as Effects, the event stream as RxJS. */
export type DockerEntityOrchestratorShape = DockerEntityOrchestratorUnaryShape & DockerEntityStreamsShape

/**
 * Per-kind facade for the unified `docker.entity` API.
 *
 * The unary methods are constant Effects over `DockerEntityDomainService`; the stream keeps its RxJS shape and is
 * attached by `withStreams`, which owns the `EffectHost` touchpoint.
 */
export class DockerEntityOrchestratorService extends Context.Service<
  DockerEntityOrchestratorService,
  DockerEntityOrchestratorShape
>()("runtime/DockerEntityOrchestratorService") {
  static readonly live: DockerEntityOrchestratorUnaryShape = makeUnary();

  static readonly withStreams = (streams: DockerEntityStreamsShape): DockerEntityOrchestratorShape => ({
    ...makeUnary(),
    ...streams,
  });
}

/** The Nest provider hands a value, not an instance: `DockerController` reads `streamEntities` off this token. */
export interface DockerEntityOrchestratorService extends DockerEntityOrchestratorShape {}
