/**
 * Turning entities into the `docker.entity` wire chunks: each entity is validated against its kind's schema, wrapped
 * in the snapshot chunk envelope (the same shape a stream emits, so a client hydrates from a list the way it does
 * from a stream), and anything that does not satisfy the contract is dropped and reported. Pure over a `log` sink.
 */
import {
  buildDockerEntityEventChunk,
  dockerContainerSchema,
  dockerEntityStreamChunkSchema,
  dockerImageSchema,
  dockerNetworkSchema,
  dockerVolumeSchema,
  type DockerContainer,
  type DockerEntityKind,
  type DockerEntityStreamChunk,
  type DockerImage,
  type DockerNetwork,
  type DockerVolume,
} from "@deployer/contracts-entities";

export type EntityChunkLog = {
  warn(message: string, context?: Record<string, unknown>): void;
  debug(message: string, context?: Record<string, unknown>): void;
};

type BaseEntity = DockerContainer | DockerImage | DockerNetwork | DockerVolume;

const BASE_SCHEMAS = {
  container: dockerContainerSchema,
  image: dockerImageSchema,
  network: dockerNetworkSchema,
  volume: dockerVolumeSchema,
} as const;

/**
 * Strictly validate a raw entity against the per-kind base schema: the contract boundary. Returns the parsed
 * (coerced, defaulted) entity, or null when it does not satisfy the contract.
 */
export function validateEntityBase(kind: DockerEntityKind, raw: unknown, log: EntityChunkLog): BaseEntity | null {
  if (!(kind in BASE_SCHEMAS)) {
    return null;
  }
  const parsed = BASE_SCHEMAS[kind].safeParse(raw);
  if (!parsed.success) {
    log.warn(`[docker-entity-orchestrator] dropping invalid ${kind} entity`, { issues: parsed.error.issues });
    return null;
  }
  return parsed.data;
}

function toSnapshotChunk(kind: DockerEntityKind, entity: BaseEntity, occurredAt: string): DockerEntityStreamChunk {
  return buildDockerEntityEventChunk({
    kind: kind as Parameters<typeof buildDockerEntityEventChunk>[0]["kind"],
    entity: entity as never,
    action: "snapshot",
    occurredAt,
    eventId: null,
  });
}

/** A list response: one snapshot chunk per valid entity, in order. */
export function buildListChunks(
  kind: DockerEntityKind,
  entities: readonly unknown[],
  occurredAt: string,
  log: EntityChunkLog,
): DockerEntityStreamChunk[] {
  const chunks: DockerEntityStreamChunk[] = [];
  for (const raw of entities) {
    const valid = validateEntityBase(kind, raw, log);
    if (!valid) continue;
    try {
      chunks.push(toSnapshotChunk(kind, valid, occurredAt));
    } catch (error) {
      log.debug("[docker-entity-orchestrator] dropping unconstructible entity in runList", {
        kind,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return chunks;
}

/** An inspect response: the entity's snapshot chunk, or null when it is missing, invalid or unconstructible. */
export function buildInspectChunk(
  kind: DockerEntityKind,
  entity: unknown,
  occurredAt: string,
  log: EntityChunkLog,
): DockerEntityStreamChunk | null {
  if (!entity) return null;
  const valid = validateEntityBase(kind, entity, log);
  if (!valid) return null;
  try {
    return toSnapshotChunk(kind, valid, occurredAt);
  } catch (error) {
    log.debug("[docker-entity-orchestrator] dropping unconstructible entity in runInspect", {
      kind,
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

/**
 * Validate a streamed chunk against the canonical contract and return the coerced value, or null to drop it. ORPC
 * validates output only on synchronous returns, not on each emission, so the producer coerces every chunk itself.
 */
export function coerceStreamChunk(chunk: unknown, log: EntityChunkLog): DockerEntityStreamChunk | null {
  const result = dockerEntityStreamChunkSchema.safeParse(chunk);
  if (!result.success) {
    log.debug("[docker-entity-orchestrator] dropping invalid stream chunk", { issues: result.error.issues });
    return null;
  }
  return result.data;
}
