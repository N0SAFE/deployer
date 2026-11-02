/**
 * Reading the docker engine's raw event stream into the runtime's events: which source an event belongs to, the
 * per-source schema it is parsed with, the request options of the engine call and the pool key subscriptions share.
 * Pure, so the mapping is tested on raw engine events without a daemon.
 */
import { dockerBuilderRuntimeEventSchema, dockerConfigRuntimeEventSchema, dockerContainerRuntimeEventSchema, dockerDaemonRuntimeEventSchema, dockerImageRuntimeEventSchema, dockerNetworkRuntimeEventSchema, dockerNodeRuntimeEventSchema, dockerSecretRuntimeEventSchema, dockerServiceRuntimeEventSchema, dockerTaskRuntimeEventSchema, dockerUnknownRuntimeEventSchema, dockerVolumeRuntimeEventSchema, type DockerRuntimeEvent } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

import { isRuntimeEventFieldFilter, toUnknownArray, toFilterNodeArray } from "../runtime/runtime-event-filter";

export type DockerKnownSource = Exclude<DockerRuntimeEvent["source"], "unknown">;
export type StreamQuery = {
  since?: string;
  until?: string;
  sources?: DockerKnownSource[];
  actions?: string[];
}

export type RuntimeEventFilterNode = {
  [key: string]: unknown;
  _and?: RuntimeEventFilterNode[];
  _or?: RuntimeEventFilterNode[];
}

export type RuntimeEventFieldFilter = {
  operator: string;
  value: unknown;
}

export type DockerRawEvent = Record<string, unknown>;

export function buildGetEventsOptions(query: StreamQuery): {
  since?: string;
  until?: string;
  filters?: Record<string, string[]>;
} {
  const options: {
    since?: string;
    until?: string;
    filters?: Record<string, string[]>;
  } = {};

  if (query.since) {
    options.since = query.since;
  }

  if (query.until) {
    options.until = query.until;
  }

  const filters: Record<string, string[]> = {};

  if (query.sources && query.sources.length > 0) {
    filters.type = query.sources;
  }

  if (query.actions && query.actions.length > 0) {
    filters.event = query.actions;
  }

  if (Object.keys(filters).length > 0) {
    options.filters = filters;
  }

  return options;
}

export function buildStreamPoolKey(query: StreamQuery): string {
  const normalizedSources = (query.sources ?? []).slice().sort().join(",") || "*";
  const normalizedActions = (query.actions ?? []).slice().sort().join(",") || "*";

  return [
    "docker-runtime-events",
    `since:${query.since ?? ""}`,
    `until:${query.until ?? ""}`,
    `sources:${normalizedSources}`,
    `actions:${normalizedActions}`,
  ].join("|");
}

export function buildUnknownEvent(
  common: Omit<DockerRuntimeEvent, "source" | "action" | "payload">,
  action: string,
): DockerRuntimeEvent {
  return dockerUnknownRuntimeEventSchema.parse({
    ...common,
    source: "unknown",
    action,
    payload: {
      entityId: common.actorId,
      entityName: common.actorAttributes.name ?? null,
    },
  });
}

export function mapDockerEvent(rawEvent: DockerRawEvent): DockerRuntimeEvent {
  const source = resolveEventSource(rawEvent.Type);
  const action = typeof rawEvent.Action === "string" ? rawEvent.Action : "unknown";

  const actor =
    typeof rawEvent.Actor === "object" && rawEvent.Actor !== null
      ? (rawEvent.Actor as { ID?: unknown; Attributes?: unknown })
      : undefined;

  const actorAttributesRaw =
    actor && typeof actor.Attributes === "object" && actor.Attributes !== null
      ? isRecord(actor.Attributes) ? actor.Attributes : {}
      : {};

  const actorAttributes = toStringRecord(actorAttributesRaw);

  const timestampSeconds =
    typeof rawEvent.time === "number"
      ? rawEvent.time
      : typeof rawEvent.time === "string"
        ? Number(rawEvent.time)
        : null;

  const common = {
    type: "docker_event" as const,
    actorId: actor && typeof actor.ID === "string" ? actor.ID : null,
    actorAttributes,
    scope: typeof rawEvent.scope === "string" ? rawEvent.scope : null,
    from: typeof rawEvent.from === "string" ? rawEvent.from : null,
    eventId: typeof rawEvent.id === "string" ? rawEvent.id : null,
    nodeId:
      typeof rawEvent.Node === "object" &&
      rawEvent.Node !== null &&
      typeof (rawEvent.Node as { ID?: unknown }).ID === "string"
        ? (rawEvent.Node as { ID: string }).ID
        : null,
    timestamp:
      timestampSeconds && Number.isFinite(timestampSeconds)
        ? new Date(timestampSeconds * 1000).toISOString()
        : new Date().toISOString(),
    timestampNano: toSafeNullableInt(rawEvent.timeNano),
    raw: rawEvent,
  };

  switch (source) {
    case "container": {
      const parsed = dockerContainerRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          containerId: common.actorId,
          containerName: actorAttributes.name ?? null,
          image: actorAttributes.image ?? common.from,
          exitCode: toNullableInt(actorAttributes.exitCode),
          signal: actorAttributes.signal ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "image": {
      const parsed = dockerImageRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          imageId: common.actorId,
          imageName: actorAttributes.name ?? common.from,
          repository: actorAttributes.repository ?? null,
          tag: actorAttributes.tag ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "volume": {
      const parsed = dockerVolumeRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          volumeName: actorAttributes.name ?? null,
          driver: actorAttributes.driver ?? null,
          mountpoint: actorAttributes.mountpoint ?? null,
          containerId: actorAttributes.container ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "network": {
      const parsed = dockerNetworkRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          networkId: common.actorId,
          networkName: actorAttributes.name ?? null,
          containerId: actorAttributes.container ?? null,
          containerName: actorAttributes.container_name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "daemon": {
      const parsed = dockerDaemonRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          daemonId: common.actorId,
          daemonName: actorAttributes.name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "service": {
      const parsed = dockerServiceRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          serviceId: common.actorId,
          serviceName: actorAttributes.name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "node": {
      const parsed = dockerNodeRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          swarmNodeId: common.actorId,
          nodeName: actorAttributes.name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "task": {
      // A task event carries no error text of its own — the daemon emits only
      // the actor id. The state/error columns therefore come from the raw
      // attributes when present and stay null otherwise; the SWARM ACTIVITY
      // ENRICHER is what fills them in from live task state, because that is
      // the only place the failure reason exists.
      const parsed = dockerTaskRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          taskId: common.actorId,
          serviceId: actorAttributes["com.docker.swarm.service.id"] ?? null,
          serviceName: actorAttributes["com.docker.swarm.service.name"] ?? null,
          slot: toNullableInt(actorAttributes.slot),
          nodeId: common.nodeId ?? actorAttributes["com.docker.swarm.node.id"] ?? null,
          state: actorAttributes.state ?? null,
          desiredState: actorAttributes.desiredState ?? null,
          error: actorAttributes.error ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "secret": {
      const parsed = dockerSecretRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          secretId: common.actorId,
          secretName: actorAttributes.name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "config": {
      const parsed = dockerConfigRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          configId: common.actorId,
          configName: actorAttributes.name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    case "builder": {
      const parsed = dockerBuilderRuntimeEventSchema.safeParse({
        ...common,
        source,
        action,
        payload: {
          builderId: common.actorId,
          builderName: actorAttributes.name ?? null,
        },
      });
      return parsed.success ? parsed.data : buildUnknownEvent(common, action);
    }
    default:
      return buildUnknownEvent(common, action);
  }
}

export function resolveEventSource(rawType: unknown): DockerKnownSource | "unknown" {
  if (typeof rawType !== "string") {
    return "unknown";
  }

  switch (rawType) {
    case "container":
    case "image":
    case "volume":
    case "network":
    case "daemon":
    case "service":
    case "node":
    case "task":
    case "secret":
    case "config":
    case "builder":
      return rawType;
    default:
      return "unknown";
  }
}

export function toNullableInt(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? null : parsed;
}

export function toSafeNullableInt(value: unknown): number | null {
  const parsed =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(value)
        : Number.NaN;

  if (!Number.isFinite(parsed) || !Number.isInteger(parsed) || parsed < 0) {
    return null;
  }

  if (!Number.isSafeInteger(parsed)) {
    return null;
  }

  return parsed;
}

export function toStringRecord(input: Record<string, unknown>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input)
      .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
      .map(([key, value]) => [key, String(value)] as const),
  );
}

export function sourceIsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

export function extractFastPathFilters(filterNode: RuntimeEventFilterNode | undefined): {
  sources?: DockerKnownSource[];
  actions?: string[];
} {
  if (!filterNode) {
    return {};
  }

  const sourceValues = new Set<string>();
  const actionValues = new Set<string>();

  collectFieldFilterValues(filterNode, "source", sourceValues);
  collectFieldFilterValues(filterNode, "action", actionValues);

  return {
    sources: parseSources([...sourceValues]),
    actions: parseStringArray([...actionValues]),
  };
}

export function collectFieldFilterValues(
  filterNode: RuntimeEventFilterNode,
  field: string,
  target: Set<string>,
): void {
  const candidate = filterNode[field];
  if (isRuntimeEventFieldFilter(candidate)) {
    if (candidate.operator === "eq" && typeof candidate.value === "string" && candidate.value.length > 0) {
      target.add(candidate.value);
    }

    if (candidate.operator === "in" && Array.isArray(candidate.value)) {
      for (const value of candidate.value) {
        if (typeof value === "string" && value.length > 0) {
          target.add(value);
        }
      }
    }

    if (candidate.operator === "in" && !Array.isArray(candidate.value)) {
      for (const value of toUnknownArray(candidate.value)) {
        if (typeof value === "string" && value.length > 0) {
          target.add(value);
        }
      }
    }
  }

  for (const child of toFilterNodeArray(filterNode._and)) {
    collectFieldFilterValues(child, field, target);
  }

  for (const child of toFilterNodeArray(filterNode._or)) {
    collectFieldFilterValues(child, field, target);
  }
}

export function parseStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const normalized = value
    .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

  return normalized.length > 0 ? normalized : undefined;
}

export function parseSources(value: unknown): DockerKnownSource[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  const allowedSources: DockerKnownSource[] = [
    "container",
    "image",
    "volume",
    "network",
    "daemon",
    "service",
    "node",
    "task",
    "secret",
    "config",
    "builder",
  ];

  const sourceSet = new Set(allowedSources);
  const normalized = value
    .filter((entry): entry is DockerKnownSource =>
      typeof entry === "string" && sourceSet.has(entry as DockerKnownSource),
    );

  return normalized.length > 0 ? normalized : undefined;
}
