/**
 * The rules of the `docker.entity` event stream: which docker events a subscription wants, which of them remove an
 * entity, how an event becomes a chunk, and the small cache fingerprints. Pure, so they are tested on plain events.
 */
import {
  dockerEntityStreamChunkSchema,
  type DockerEntityKind,
  type DockerEntityStreamChunk,
  type DockerRuntimeEvent,
} from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

export const ENTITY_KINDS: readonly DockerEntityKind[] = ["container", "image", "network", "volume"];

export type EntityFilterInput = {
  kinds?: readonly DockerEntityKind[];
  actions?: {
    container?: readonly string[];
    image?: readonly string[];
    network?: readonly string[];
    volume?: readonly string[];
  };
};

/** Subscriptions with the same kinds and actions share one upstream stream, so they share a pool key. */
export function poolKeyFor(input: EntityFilterInput): string {
  const kinds = [...(input.kinds ?? ENTITY_KINDS)].sort().join(",");
  return `docker-entity-events|kinds:${kinds}|actions:${JSON.stringify(input.actions ?? {})}`;
}

/** The runtime-event filter a subscription asks for: one clause per kind, or-ed, with an action list when given. */
export function buildStreamFilter(input: EntityFilterInput) {
  const kinds = input.kinds ?? ENTITY_KINDS;
  const actions = input.actions ?? {};
  const nodes = kinds.map((kind) => {
    const kindActions = actions[kind as keyof typeof actions] ?? [];
    return {
      source: { operator: "eq" as const, value: kind },
      ...(kindActions.length > 0 ? { action: { operator: "in" as const, value: kindActions } } : {}),
    };
  });
  if (nodes.length === 0) return undefined;
  if (nodes.length === 1) return nodes[0];
  return { _or: nodes };
}

/** Whether an event passes a single clause's source and action; the or-of-kinds is applied per kind elsewhere. */
export function eventMatchesFilter(event: DockerRuntimeEvent, filter: unknown): boolean {
  if (!filter) return true;
  const node = isRecord(filter) ? filter : {};
  const sourceClause = node.source as { value?: string } | undefined;
  if (sourceClause?.value && sourceClause.value !== event.source) return false;
  const actionClause = node.action as { value?: string[] } | undefined;
  if (actionClause && Array.isArray(actionClause.value) && actionClause.value.length > 0 && !actionClause.value.includes(event.action)) {
    return false;
  }
  return true;
}

/** Whether this event means the entity is gone (the actions differ per source). */
export function isRemovalAction(source: string, action: string): boolean {
  if (source === "container") return action === "destroy" || action === "die";
  if (source === "image" || source === "volume") return action === "destroy" || action === "delete";
  if (source === "network") return action === "destroy" || action === "remove";
  return false;
}

export function buildRemovedChunk(kind: DockerEntityKind, event: DockerRuntimeEvent, id: string): DockerEntityStreamChunk {
  return {
    kind,
    action: event.action as "destroy" | "die" | "delete",
    id,
    occurredAt: event.timestamp,
    eventId: event.eventId,
  } as DockerEntityStreamChunk;
}

/** An entity as the chunk an event produced: the entity's fields plus the event's kind, action, time and id. */
export function buildEventChunk(kind: DockerEntityKind, entity: unknown, event: DockerRuntimeEvent): DockerEntityStreamChunk {
  return dockerEntityStreamChunkSchema.parse({
    ...(isRecord(entity) ? entity : {}),
    kind,
    action: event.action,
    occurredAt: event.timestamp,
    eventId: event.eventId,
  });
}

/** A flat docker object as its entity (with the, here empty, relations slot). */
export function wrapAsEntity<TEntity>(flat: unknown): TEntity {
  return { ...(isRecord(flat) ? flat : {}), relations: undefined } as unknown as TEntity;
}

/** A short etag for an inspected entity, stable for the same leading content. */
export function fingerprintEtag(payload: unknown): string {
  return `"${JSON.stringify(payload).slice(0, 24).replace(/[^a-z0-9]/gi, "")}"`;
}
