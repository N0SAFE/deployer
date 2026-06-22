import { Injectable, Logger } from "@nestjs/common";
import {
  Observable,
  defer,
  finalize,
  filter,
  from,
  fromEventPattern,
  map,
  merge,
  mergeMap,
  retry,
  share,
  take,
  takeUntil,
  timer,
} from "rxjs";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import {
  dockerBuilderRuntimeEventSchema,
  dockerConfigRuntimeEventSchema,
  dockerContainerRuntimeEventSchema,
  dockerDaemonRuntimeEventSchema,
  dockerImageRuntimeEventSchema,
  dockerNetworkRuntimeEventSchema,
  dockerNodeRuntimeEventSchema,
  dockerSecretRuntimeEventSchema,
  dockerServiceRuntimeEventSchema,
  dockerUnknownRuntimeEventSchema,
  dockerVolumeRuntimeEventSchema,
  type DockerRuntimeEvent,
} from "@repo/contracts-entities";
import { DockerService as CoreDockerService } from "@/core/modules/docker/services/docker.service";
import { AbstractDomainEventStreamService } from "@/core/modules/events/services/abstract-domain-event-stream.service";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";

type DockerKnownSource = Exclude<DockerRuntimeEvent["source"], "unknown">;
interface StreamQuery {
  since?: string;
  until?: string;
  sources?: DockerKnownSource[];
  actions?: string[];
}

interface RuntimeEventFilterNode {
  [key: string]: unknown;
  _and?: RuntimeEventFilterNode[];
  _or?: RuntimeEventFilterNode[];
}

interface RuntimeEventFieldFilter {
  operator: string;
  value: unknown;
}

type DockerRawEvent = Record<string, unknown>;

@Injectable()
export class DockerRuntimeEventsSourceService extends AbstractDomainEventStreamService {
  protected readonly streamDomain = "docker";
  private readonly logger = new Logger(DockerRuntimeEventsSourceService.name);

  constructor(
    private readonly dockerService: CoreDockerService,
    streamPool: CoreEventStreamPoolService,
  ) {
    super(streamPool);
  }

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeEvent> {
    const rawQuery = query as Record<string, unknown>;
    const filter = this.isRuntimeEventFilterNode(rawQuery.filter)
      ? rawQuery.filter
      : undefined;
    const fastPath = this.extractFastPathFilters(filter);

    const streamQuery: StreamQuery = {
      since: typeof rawQuery.since === "string" ? rawQuery.since : undefined,
      until: typeof rawQuery.until === "string" ? rawQuery.until : undefined,
      sources: fastPath.sources,
      actions: fastPath.actions,
    };

    this.logger.log(
      `[docker-runtime-sse] stream request -> since=${streamQuery.since ?? ""} until=${streamQuery.until ?? ""} sources=${JSON.stringify(streamQuery.sources ?? [])} actions=${JSON.stringify(streamQuery.actions ?? [])}`,
    );

    return this.observeDomainPooledStream(
      this.buildStreamPoolKey(streamQuery),
      () => this.createRetryableStream(streamQuery),
    );
  }

  private buildStreamPoolKey(query: StreamQuery): string {
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

  private createRetryableStream(query: StreamQuery): Observable<DockerRuntimeEvent> {
    return defer(() => this.createDockerEventsStream(query)).pipe(
      retry({
        delay: (error, retryCount) => {
          const delayMs = Math.min(1000 * 2 ** retryCount, 10000);
          this.logger.warn(
            `Docker event stream disconnected (${this.formatError(
              error,
            )}). Retrying in ${String(delayMs)}ms`,
          );
          return timer(delayMs);
        },
      }),
      share(),
    );
  }

  private createDockerEventsStream(query: StreamQuery): Observable<DockerRuntimeEvent> {
    const getEventsOptions = this.buildGetEventsOptions(query) as Parameters<
      ReturnType<CoreDockerService["getDockerClient"]>["getEvents"]
    >[0];

    this.logger.log(
      `[docker-runtime-sse] docker.getEvents options=${JSON.stringify(getEventsOptions)}`,
    );

    return defer(() =>
      from(
        Promise.resolve(
          this.dockerService.getDockerClient().getEvents(getEventsOptions),
        ),
      ).pipe(
        mergeMap((eventStream) => {
          if (!this.isReadableStream(eventStream)) {
            throw new Error("docker.getEvents() did not return a readable stream");
          }

          const bufferState = { value: "" };

          const completed$ = merge(
            this.observeStreamEvent(eventStream, "end"),
            this.observeStreamEvent(eventStream, "close"),
          ).pipe(take(1));

          const errors$ = this.observeStreamEvent(eventStream, "error").pipe(
            take(1),
            map((error) => {
              throw error instanceof Error ? error : new Error(String(error));
            }),
          );

          const events$ = this.observeStreamEvent(eventStream, "data").pipe(
            takeUntil(completed$),
            mergeMap((chunk) =>
              from(
                this.parseDockerEventsChunk(
                  this.toBufferOrString(chunk),
                  bufferState,
                ),
              ),
            ),
          );

          return merge(events$, errors$).pipe(
            takeUntil(completed$),
            finalize(() => {
              if (this.isDestroyableStream(eventStream)) {
                eventStream.destroy();
              }
            }),
          );
        }),
      ),
    );
  }

  private observeStreamEvent(
    stream: NodeJS.ReadableStream,
    eventName: string,
  ): Observable<unknown> {
    return fromEventPattern(
      (handler) => {
        stream.on(eventName, handler);
      },
      (handler) => {
        stream.removeListener(eventName, handler);
      },
    );
  }

  private toBufferOrString(value: unknown): Buffer | string {
    if (typeof value === "string" || Buffer.isBuffer(value)) {
      return value;
    }

    return String(value);
  }

  private parseDockerEventsChunk(
    chunk: Buffer | string,
    state: { value: string },
  ): DockerRuntimeEvent[] {
    state.value += typeof chunk === "string" ? chunk : chunk.toString("utf8");

    const events: DockerRuntimeEvent[] = [];

    for (;;) {
      const lineBreakIndex = state.value.indexOf("\n");
      if (lineBreakIndex < 0) break;

      const line = state.value.slice(0, lineBreakIndex).trim();
      state.value = state.value.slice(lineBreakIndex + 1);

      if (!line) {
        continue;
      }

      try {
        const parsed: unknown = JSON.parse(line);
        if (!this.isRecord(parsed)) {
          continue;
        }

        events.push(this.mapDockerEvent(parsed));
      } catch (error) {
        this.logger.warn(
          `Skipping malformed Docker event line: ${this.formatError(error)}`,
        );
      }
    }

    return events;
  }

  private mapDockerEvent(rawEvent: DockerRawEvent): DockerRuntimeEvent {
    const source = this.resolveEventSource(rawEvent.Type);
    const action = typeof rawEvent.Action === "string" ? rawEvent.Action : "unknown";

    const actor =
      typeof rawEvent.Actor === "object" && rawEvent.Actor !== null
        ? (rawEvent.Actor as { ID?: unknown; Attributes?: unknown })
        : undefined;

    const actorAttributesRaw =
      actor && typeof actor.Attributes === "object" && actor.Attributes !== null
        ? (actor.Attributes as Record<string, unknown>)
        : {};

    const actorAttributes = this.toStringRecord(actorAttributesRaw);

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
      timestampNano: this.toSafeNullableInt(rawEvent.timeNano),
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
            exitCode: this.toNullableInt(actorAttributes.exitCode),
            signal: actorAttributes.signal ?? null,
          },
        });
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
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
        return parsed.success ? parsed.data : this.buildUnknownEvent(common, action);
      }
      default:
        return this.buildUnknownEvent(common, action);
    }
  }

  private buildUnknownEvent(
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

  private resolveEventSource(rawType: unknown): DockerKnownSource | "unknown" {
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
      case "secret":
      case "config":
      case "builder":
        return rawType;
      default:
        return "unknown";
    }
  }

  private buildGetEventsOptions(query: StreamQuery): {
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

  private isReadableStream(value: unknown): value is NodeJS.ReadableStream {
    return (
      typeof value === "object" &&
      value !== null &&
      "on" in value &&
      typeof (value as { on?: unknown }).on === "function"
    );
  }

  private isDestroyableStream(
    value: unknown,
  ): value is NodeJS.ReadableStream & { destroy: () => void } {
    return (
      this.isReadableStream(value) &&
      "destroy" in value &&
      typeof value.destroy === "function"
    );
  }

  private isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null;
  }

  private toStringRecord(input: Record<string, unknown>): Record<string, string> {
    return Object.fromEntries(
      Object.entries(input)
        .filter(([, value]) => ["string", "number", "boolean"].includes(typeof value))
        .map(([key, value]) => [key, String(value)] as const),
    );
  }

  private toNullableInt(value: string | undefined): number | null {
    if (!value) return null;
    const parsed = Number.parseInt(value, 10);
    return Number.isNaN(parsed) ? null : parsed;
  }

  private toSafeNullableInt(value: unknown): number | null {
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

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  private isRuntimeEventFilterNode(value: unknown): value is RuntimeEventFilterNode {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isRuntimeEventFieldFilter(value: unknown): value is RuntimeEventFieldFilter {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const record = value as Record<string, unknown>;
    return typeof record.operator === "string" && "value" in record;
  }

  private extractFastPathFilters(filterNode: RuntimeEventFilterNode | undefined): {
    sources?: DockerKnownSource[];
    actions?: string[];
  } {
    if (!filterNode) {
      return {};
    }

    const sourceValues = new Set<string>();
    const actionValues = new Set<string>();

    this.collectFieldFilterValues(filterNode, "source", sourceValues);
    this.collectFieldFilterValues(filterNode, "action", actionValues);

    return {
      sources: this.parseSources([...sourceValues]),
      actions: this.parseStringArray([...actionValues]),
    };
  }

  private collectFieldFilterValues(
    filterNode: RuntimeEventFilterNode,
    field: string,
    target: Set<string>,
  ): void {
    const candidate = filterNode[field];
    if (this.isRuntimeEventFieldFilter(candidate)) {
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
        for (const value of this.toUnknownArray(candidate.value)) {
          if (typeof value === "string" && value.length > 0) {
            target.add(value);
          }
        }
      }
    }

    for (const child of this.toFilterNodeArray(filterNode._and)) {
      this.collectFieldFilterValues(child, field, target);
    }

    for (const child of this.toFilterNodeArray(filterNode._or)) {
      this.collectFieldFilterValues(child, field, target);
    }
  }

  private parseStringArray(value: unknown): string[] | undefined {
    if (!Array.isArray(value)) {
      return undefined;
    }

    const normalized = value
      .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

    return normalized.length > 0 ? normalized : undefined;
  }

  private parseSources(value: unknown): DockerKnownSource[] | undefined {
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

  private toUnknownArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value !== "object" || value === null) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => this.compareObjectKeys(leftKey, rightKey))
      .map(([, entryValue]) => entryValue);
  }

  private toFilterNodeArray(value: unknown): RuntimeEventFilterNode[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is RuntimeEventFilterNode => this.isRuntimeEventFilterNode(item));
    }

    if (typeof value !== "object" || value === null) {
      return [];
    }

    return Object.entries(value as Record<string, unknown>)
      .sort(([leftKey], [rightKey]) => this.compareObjectKeys(leftKey, rightKey))
      .map(([, entryValue]) => entryValue)
      .filter((item): item is RuntimeEventFilterNode => this.isRuntimeEventFilterNode(item));
  }

  private compareObjectKeys(leftKey: string, rightKey: string): number {
    const leftNumber = Number(leftKey);
    const rightNumber = Number(rightKey);

    const leftIsNumeric = Number.isInteger(leftNumber) && String(leftNumber) === leftKey;
    const rightIsNumeric = Number.isInteger(rightNumber) && String(rightNumber) === rightKey;

    if (leftIsNumeric && rightIsNumeric) {
      return leftNumber - rightNumber;
    }

    if (leftIsNumeric) {
      return -1;
    }

    if (rightIsNumeric) {
      return 1;
    }

    return leftKey.localeCompare(rightKey);
  }
}
