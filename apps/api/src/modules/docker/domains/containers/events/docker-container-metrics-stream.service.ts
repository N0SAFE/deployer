import { Injectable, Logger } from "@nestjs/common";
import { Observable, from, interval } from "rxjs";
import { exhaustMap, mergeMap, startWith, tap } from "rxjs/operators";
import * as systeminformation from "systeminformation";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import {
  dockerContainerRuntimeEventSchema,
  type DockerRuntimeEvent,
} from "@repo/contracts-entities";
import { AppLogger } from "@repo/logger";
import { DockerService as CoreDockerService } from "@/core/modules/docker/services/docker.service";
import { AbstractDomainEventStreamService } from "@repo/nest-events";
import { CoreEventStreamPoolService } from "@repo/nest-events";
import { isRecord, isObjectLike } from "@repo/type-guards"

interface RuntimeEventFilterNode {
  [key: string]: unknown;
  _and?: RuntimeEventFilterNode[];
  _or?: RuntimeEventFilterNode[];
}

interface RuntimeEventFieldFilter {
  operator: string;
  value: unknown;
}

interface ContainerMetricsSelector {
  containerIds?: string[];
  containerNames?: string[];
}

const DEFAULT_METRICS_INTERVAL_MS = 400;



@Injectable()
export class DockerContainerMetricsStreamService extends AbstractDomainEventStreamService {
  protected readonly streamDomain = "docker";
  private readonly logger = new Logger(DockerContainerMetricsStreamService.name);
  private readonly apiLogger = new AppLogger("api").scope(DockerContainerMetricsStreamService.name);
  private readonly scopedLogger = this.apiLogger.log;
  private readonly debugLogger = this.apiLogger.createContextFilterLogger({
    defaultClassName: DockerContainerMetricsStreamService.name,
    filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
    channel: "docker-metrics-stream",
  });
  private metricsCollectionTick = 0;

  constructor(
    private readonly dockerService: CoreDockerService,
    streamPool: CoreEventStreamPoolService,
  ) {
    super(streamPool);
  }

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeEvent> {
    const rawQuery = isRecord(query) ? query : {};
    const filterNode = this.isRuntimeEventFilterNode(rawQuery.filter)
      ? rawQuery.filter
      : undefined;

    const selector = this.extractContainerSelector(filterNode);
    const streamKey = this.buildMetricsPoolKey(selector, DEFAULT_METRICS_INTERVAL_MS);

    this.debug("stream", {
      phase: "stream_subscribe",
      streamKey,
      selector,
      hasFilter: Boolean(filterNode),
    });

    this.scopedLogger.info("[docker-metrics-stream] stream_open", {
      streamKey,
      selector,
      hasFilter: Boolean(filterNode),
    });

    let emittedCount = 0;

    return interval(DEFAULT_METRICS_INTERVAL_MS).pipe(
      startWith(0),
      exhaustMap(() => from(this.collectMetricEvents(selector))),
      mergeMap((events) => from(events)),
      tap((event) => {
        emittedCount += 1;
        if (emittedCount <= 3) {
          this.scopedLogger.info("[docker-metrics-stream] domain_emit", {
            emittedCount,
            source: event.source,
            action: event.action,
            actorId: event.actorId,
          });
        }
      }),
    );
  }

  private async collectMetricEvents(
    selector: ContainerMetricsSelector,
  ): Promise<DockerRuntimeEvent[]> {
    this.metricsCollectionTick += 1;
    const tick = this.metricsCollectionTick;

    const now = Date.now();
    const timestamp = new Date(now).toISOString();

    const samples = await systeminformation.dockerContainers(true).catch((error: unknown) => {
      this.logger.warn(`Failed to read dockerContainers() metrics: ${this.formatError(error)}`);
      return [] as systeminformation.Systeminformation.DockerContainerData[];
    });

    const stats = await systeminformation.dockerContainerStats().catch((error: unknown) => {
      this.logger.warn(`Failed to read dockerContainerStats() metrics: ${this.formatError(error)}`);
      return [] as systeminformation.Systeminformation.DockerContainerStatsData[];
    });

    const filteredSamples = samples.filter((sample) => this.matchesSelector(sample, selector));

    if (tick <= 3) {
      this.scopedLogger.info("[docker-metrics-stream] collect_tick", {
        tick,
        sampleCount: samples.length,
        statsCount: stats.length,
        filteredCount: filteredSamples.length,
        selector,
      });
    }

    if (this.shouldTraceTick(tick)) {
      this.debug("collectMetricEvents", {
        phase: "collect_metrics",
        tick,
        sampleCount: samples.length,
        statsCount: stats.length,
        filteredCount: filteredSamples.length,
        selector,
      });
    }

    const events = filteredSamples.map((sample) => {
      const sampleRecord = isRecord(sample) ? sample : {};
      const sampleId = this.readString(sampleRecord, ["id", "containerId"]);

      const sampleStats = sampleId
        ? stats.find((entry) => typeof entry.id === "string" && this.matchesIdentifier(entry.id, sampleId))
        : undefined;

      return this.toContainerMetricEvent(
        sampleRecord,
        isRecord(sampleStats) ? sampleStats : undefined,
        timestamp,
        now,
      );
    });

    if (events.length > 0) {
      if (tick <= 3) {
        this.scopedLogger.info("[docker-metrics-stream] collect_tick_emitted", {
          tick,
          emittedCount: events.length,
          selector,
        });
      }

      if (this.shouldTraceTick(tick)) {
        this.debug("collectMetricEvents", {
          phase: "collect_metrics_events",
          tick,
          emittedCount: events.length,
          source: "systeminformation",
        });
      }
      return events;
    }

    if (this.shouldTraceTick(tick)) {
      this.debug("collectMetricEvents", {
        phase: "collect_metrics_fallback",
        tick,
        reason: "no_filtered_samples",
      });
    }

    if (tick <= 3) {
      this.scopedLogger.info("[docker-metrics-stream] collect_tick_fallback", {
        tick,
        reason: "no_filtered_samples",
        selector,
      });
    }

    return this.collectFallbackMetricEvents(selector, timestamp, now);
  }

  private async collectFallbackMetricEvents(
    selector: ContainerMetricsSelector,
    timestamp: string,
    nowMs: number,
  ): Promise<DockerRuntimeEvent[]> {
    const targetIds = (selector.containerIds ?? []).filter((id) => id.trim().length > 0);
    if (targetIds.length === 0) {
      this.debug("collectFallbackMetricEvents", {
        phase: "fallback_skipped",
        reason: "no_container_ids_in_selector",
      });
      return [];
    }

    const docker = this.dockerService.getDockerClient();
    const events: DockerRuntimeEvent[] = [];

    for (const candidateId of targetIds) {
      try {
        const container = docker.getContainer(candidateId);
        const [inspect, rawStatsUnknown] = await Promise.all([
          container.inspect(),
          container.stats({ stream: false }),
        ]);

        const rawStats = isRecord(rawStatsUnknown) ? rawStatsUnknown : {};

        const cpuDelta =
          this.readNumber(rawStats, ["cpu_stats.cpu_usage.total_usage"])
          - this.readNumber(rawStats, ["precpu_stats.cpu_usage.total_usage"]);
        const systemDelta =
          this.readNumber(rawStats, ["cpu_stats.system_cpu_usage"])
          - this.readNumber(rawStats, ["precpu_stats.system_cpu_usage"]);
        const onlineCpus = Math.max(1, this.readNumber(rawStats, ["cpu_stats.online_cpus"]));

        const cpuPercent = cpuDelta > 0 && systemDelta > 0
          ? (cpuDelta / systemDelta) * onlineCpus * 100
          : 0;

        const memoryUsage = this.readNumber(rawStats, ["memory_stats.usage"]);
        const memoryLimit = this.readNumber(rawStats, ["memory_stats.limit"]);
        const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

        const networkRxKb = this.sumNetworkBytes(rawStats, "rx_bytes") / 1024;
        const networkTxKb = this.sumNetworkBytes(rawStats, "tx_bytes") / 1024;
        const ioReadKb = this.sumBlockIoBytes(rawStats, "Read") / 1024;
        const ioWriteKb = this.sumBlockIoBytes(rawStats, "Write") / 1024;

        events.push(
          dockerContainerRuntimeEventSchema.parse({
            type: "docker_event",
            source: "container",
            action: "metrics",
            actorId: inspect.Id,
            actorAttributes: {
              metricsSource: "systeminformation",
              status: inspect.State.Status,
            },
            scope: null,
            from: inspect.Config.Image,
            eventId: `metrics-${inspect.Id}-${String(nowMs)}`,
            nodeId: null,
            timestamp,
            timestampNano: null,
            raw: rawStats,
            payload: {
              containerId: inspect.Id,
              containerName: typeof inspect.Name === "string" ? inspect.Name.replace(/^\/+/, "") : null,
              image: inspect.Config.Image,
              exitCode: null,
              signal: null,
              metrics: {
                at: timestamp,
                cpu: this.normalizePercent(cpuPercent),
                memory: this.normalizePercent(memoryPercent),
                networkRxKb,
                networkTxKb,
                ioReadKb,
                ioWriteKb,
              },
              metricsSource: "systeminformation",
            },
          }),
        );
      } catch (error) {
        this.logger.warn(`Fallback metrics collection failed for ${candidateId}: ${this.formatError(error)}`);
      }
    }

    this.debug("collectFallbackMetricEvents", {
      phase: "fallback_completed",
      targetIds,
      emittedCount: events.length,
    });

    this.scopedLogger.info("[docker-metrics-stream] fallback_completed", {
      targetIds,
      emittedCount: events.length,
    });

    return events;
  }

  private sumNetworkBytes(source: Record<string, unknown>, key: "rx_bytes" | "tx_bytes"): number {
    const networks = this.readByPath(source, "networks");
    if (typeof networks !== "object" || networks === null) {
      return 0;
    }

    return Object.values(isRecord(networks) ? networks : {}).reduce<number>((sum, networkStats) => {
      if (typeof networkStats !== "object" || networkStats === null) {
        return sum;
      }

      const numeric = this.readNumber(isRecord(networkStats) ? networkStats : {}, [key]);
      return sum + numeric;
    }, 0);
  }

  private sumBlockIoBytes(source: Record<string, unknown>, op: "Read" | "Write"): number {
    const ioEntries = this.readByPath(source, "blkio_stats.io_service_bytes_recursive");
    if (!Array.isArray(ioEntries)) {
      return 0;
    }

    return ioEntries.reduce<number>((sum, entry) => {
      if (typeof entry !== "object" || entry === null) {
        return sum;
      }

      const record = isRecord(entry) ? entry : {};
      const entryOp = this.readString(record, ["op"]);
      if (entryOp !== op) {
        return sum;
      }

      return sum + this.readNumber(record, ["value"]);
    }, 0);
  }

  private toContainerMetricEvent(
    sample: Record<string, unknown>,
    stats: Record<string, unknown> | undefined,
    timestamp: string,
    nowMs: number,
  ): DockerRuntimeEvent {
    const containerId = this.readString(sample, ["id", "containerId"]) ?? null;
    const containerName =
      this.readString(sample, ["name", "containerName"]) ??
      this.readStringArrayFirst(sample, ["names"]) ??
      null;

    const metrics = {
      at: timestamp,
      cpu: this.normalizePercent(
        this.readNumber(stats ?? sample, ["cpuPercent", "cpu"]),
      ),
      memory: this.normalizePercent(
        this.readNumber(stats ?? sample, ["memPercent", "memoryPercent", "memory"]),
      ),
      networkRxKb: this.readNumber(stats ?? sample, ["netIO.rx", "netRx", "rx"]) / 1024,
      networkTxKb: this.readNumber(stats ?? sample, ["netIO.wx", "netIO.tx", "netTx", "tx"]) / 1024,
      ioReadKb: this.readNumber(stats ?? sample, ["blockIO.r", "blockIO.read", "blockRead", "blkRead"]) / 1024,
      ioWriteKb: this.readNumber(stats ?? sample, ["blockIO.w", "blockIO.write", "blockWrite", "blkWrite"]) / 1024,
    };

    return dockerContainerRuntimeEventSchema.parse({
      type: "docker_event",
      source: "container",
      action: "metrics",
      actorId: containerId,
      actorAttributes: {
        metricsSource: "systeminformation",
        status: this.readString(sample, ["state", "status"]) ?? "unknown",
      },
      scope: null,
      from: this.readString(sample, ["image", "imageName"]) ?? null,
      eventId: `metrics-${containerId ?? containerName ?? "unknown"}-${String(nowMs)}`,
      nodeId: null,
      timestamp,
      timestampNano: null,
      raw: sample,
      payload: {
        containerId,
        containerName,
        image: this.readString(sample, ["image", "imageName"]) ?? null,
        exitCode: null,
        signal: null,
        metrics,
        metricsSource: "systeminformation",
      },
    });
  }

  private normalizePercent(value: number): number {
    if (!Number.isFinite(value)) {
      return 0;
    }

    return Math.max(0, Math.min(100, value));
  }

  private buildMetricsPoolKey(
    selector: ContainerMetricsSelector,
    intervalMs: number,
  ): string {
    const ids = (selector.containerIds ?? []).slice().sort();
    const names = (selector.containerNames ?? []).slice().sort();

    return [
      "docker-container-metrics",
      `interval:${String(intervalMs)}`,
      `ids:${ids.join(",") || "*"}`,
      `names:${names.join(",") || "*"}`,
    ].join("|");
  }

  private matchesSelector(
    sample: systeminformation.Systeminformation.DockerContainerData,
    selector: ContainerMetricsSelector,
  ): boolean {
    const sampleRecord = isRecord(sample) ? sample : {};
    const sampleId = this.readString(sampleRecord, ["id", "containerId"]);
    const sampleName =
      this.readString(sampleRecord, ["name", "containerName"]) ??
      this.readStringArrayFirst(sampleRecord, ["names"]);

    const hasIdFilter = !!selector.containerIds && selector.containerIds.length > 0;
    const hasNameFilter = !!selector.containerNames && selector.containerNames.length > 0;

    const idMatches = !hasIdFilter || (
      sampleId !== null
      && !!selector.containerIds?.some((candidateId) => this.matchesIdentifier(sampleId, candidateId))
    );
    const nameMatches = !hasNameFilter || (sampleName !== null && !!selector.containerNames?.includes(sampleName));

    return idMatches && nameMatches;
  }

  private matchesIdentifier(actual: string, expected: string): boolean {
    const normalizedActual = actual.trim();
    const normalizedExpected = expected.trim();

    if (normalizedActual.length === 0 || normalizedExpected.length === 0) {
      return false;
    }

    return normalizedActual === normalizedExpected
      || normalizedActual.startsWith(normalizedExpected)
      || normalizedExpected.startsWith(normalizedActual);
  }

  private extractContainerSelector(
    filterNode: RuntimeEventFilterNode | undefined,
  ): ContainerMetricsSelector {
    if (!filterNode) {
      return {};
    }

    const containerIds = new Set<string>();
    const containerNames = new Set<string>();

    this.collectFieldFilterValues(filterNode, "containerId", containerIds);
    this.collectFieldFilterValues(filterNode, "containerName", containerNames);

    return {
      containerIds: containerIds.size > 0 ? [...containerIds] : undefined,
      containerNames: containerNames.size > 0 ? [...containerNames] : undefined,
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

      if (candidate.operator === "in") {
        for (const value of this.toUnknownArray(candidate.value)) {
          if (typeof value === "string" && value.length > 0) {
            target.add(value);
          }
        }
      }
    }

    for (const child of this.toFilterNodeArray(filterNode._and)) {
        if (this.isRuntimeEventFilterNode(child)) {
          this.collectFieldFilterValues(child, field, target);
        }
    }

    for (const child of this.toFilterNodeArray(filterNode._or)) {
        if (this.isRuntimeEventFilterNode(child)) {
          this.collectFieldFilterValues(child, field, target);
        }
    }
  }

  private toFilterNodeArray(value: unknown): RuntimeEventFilterNode[] {
    if (Array.isArray(value)) {
      return value.filter((item): item is RuntimeEventFilterNode => this.isRuntimeEventFilterNode(item));
    }

    if (typeof value !== "object" || value === null) {
      return [];
    }

    return Object.entries(isRecord(value) ? value : {})
      .sort(([leftKey], [rightKey]) => this.compareObjectKeys(leftKey, rightKey))
      .map(([, entryValue]) => entryValue)
      .filter((item): item is RuntimeEventFilterNode => this.isRuntimeEventFilterNode(item));
  }

  private isRuntimeEventFilterNode(value: unknown): value is RuntimeEventFilterNode {
    return typeof value === "object" && value !== null && !Array.isArray(value);
  }

  private isRuntimeEventFieldFilter(value: unknown): value is RuntimeEventFieldFilter {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return false;
    }

    const record = isRecord(value) ? value : {};
    return typeof record.operator === "string" && "value" in record;
  }

  private toUnknownArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
      return value;
    }

    if (typeof value !== "object" || value === null) {
      return [];
    }

    return Object.entries(isRecord(value) ? value : {})
      .sort(([leftKey], [rightKey]) => this.compareObjectKeys(leftKey, rightKey))
      .map(([, entryValue]) => entryValue);
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

  private readString(
    source: Record<string, unknown>,
    fieldPaths: string[],
  ): string | null {
    for (const path of fieldPaths) {
      const value = this.readByPath(source, path);
      if (typeof value === "string" && value.length > 0) {
        return value;
      }
    }

    return null;
  }

  private readStringArrayFirst(
    source: Record<string, unknown>,
    fieldPaths: string[],
  ): string | null {
    for (const path of fieldPaths) {
      const value = this.readByPath(source, path);
      if (Array.isArray(value)) {
        const first = value.find((entry): entry is string => typeof entry === "string" && entry.length > 0);
        if (first) {
          return first;
        }
      }
    }

    return null;
  }

  private readNumber(
    source: Record<string, unknown>,
    fieldPaths: string[],
  ): number {
    for (const path of fieldPaths) {
      const value = this.readByPath(source, path);
      const numeric = typeof value === "number" ? value : typeof value === "string" ? Number(value) : Number.NaN;
      if (Number.isFinite(numeric)) {
        return numeric;
      }
    }

    return 0;
  }

  private readByPath(source: Record<string, unknown>, path: string): unknown {
    return path.split(".").reduce<unknown>((current, segment) => {
      if (typeof current === "object" && current !== null && segment in (isRecord(current) ? current : {})) {
        return (isRecord(current) ? current : {})[segment];
      }

      return undefined;
    }, source);
  }

  private formatError(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }

    return String(error);
  }

  private shouldTraceTick(tick: number): boolean {
    return tick <= 10 || tick % 50 === 0;
  }

  private debug(source: unknown, context?: Record<string, unknown>): void {
    this.debugLogger.debug(source, context);
  }
}
