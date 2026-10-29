import { Logger } from "@nestjs/common";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { Observable, from, interval } from "rxjs";
import { exhaustMap, mergeMap, startWith, tap } from "rxjs/operators";
import * as systeminformation from "systeminformation";
import type { DockerRuntimeEventsStreamQueryInput } from "@deployer/runtime-contracts/modules/docker/runtime/shared";
import {
  dockerContainerRuntimeEventSchema,
  type DockerRuntimeEvent,
} from "@deployer/contracts-entities";
import { AppLogger } from "@deployer/logger";
import type { DockerEngineShape } from "@deployer/docker";
import { AbstractDomainEventStreamService } from "@deployer/shared/core/modules/events/base/index";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";
import { isRecord, isObjectLike } from "@deployer/type-guards"

import {
  buildMetricsPoolKey,
  extractContainerSelector,
  matchesSelector,
  normalizePercent,
  readNumber,
  readString,
  sumBlockIoBytes,
  sumNetworkBytes,
  toContainerMetricEvent,
  shouldTraceTick,
  formatError,
  type ContainerMetricsSelector,
} from "./container-metrics";
import {
  isRuntimeEventFilterNode,
  matchesIdentifier,
  type RuntimeEventFilterNode,
} from "../../../common/runtime/runtime-event-filter";

const DEFAULT_METRICS_INTERVAL_MS = 400;



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
    private readonly dockerEngine: DockerEngineShape,
    streamPool: CoreEventStreamPoolService,
  ) {
    super(streamPool);
  }

  stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeEvent> {
    const rawQuery = isRecord(query) ? query : {};
    const filterNode = isRuntimeEventFilterNode(rawQuery.filter)
      ? rawQuery.filter
      : undefined;

    const selector = extractContainerSelector(filterNode);
    const streamKey = buildMetricsPoolKey(selector, DEFAULT_METRICS_INTERVAL_MS);

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
      this.logger.warn(`Failed to read dockerContainers() metrics: ${formatError(error)}`);
      return [] as systeminformation.Systeminformation.DockerContainerData[];
    });

    const stats = await systeminformation.dockerContainerStats().catch((error: unknown) => {
      this.logger.warn(`Failed to read dockerContainerStats() metrics: ${formatError(error)}`);
      return [] as systeminformation.Systeminformation.DockerContainerStatsData[];
    });

    const filteredSamples = samples.filter((sample) => matchesSelector(sample, selector));

    if (tick <= 3) {
      this.scopedLogger.info("[docker-metrics-stream] collect_tick", {
        tick,
        sampleCount: samples.length,
        statsCount: stats.length,
        filteredCount: filteredSamples.length,
        selector,
      });
    }

    if (shouldTraceTick(tick)) {
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
      const sampleId = readString(sampleRecord, ["id", "containerId"]);

      const sampleStats = sampleId
        ? stats.find((entry) => typeof entry.id === "string" && matchesIdentifier(entry.id, sampleId))
        : undefined;

      return toContainerMetricEvent(
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

      if (shouldTraceTick(tick)) {
        this.debug("collectMetricEvents", {
          phase: "collect_metrics_events",
          tick,
          emittedCount: events.length,
          source: "systeminformation",
        });
      }
      return events;
    }

    if (shouldTraceTick(tick)) {
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

    const containers = this.dockerEngine.containers;
    const events: DockerRuntimeEvent[] = [];

    for (const candidateId of targetIds) {
      try {
        const [inspect, rawStatsUnknown] = await Promise.all([
          runPromiseUnwrapped(containers.inspect(candidateId)),
          runPromiseUnwrapped(containers.stats(candidateId)),
        ]);

        const rawStats = isRecord(rawStatsUnknown) ? rawStatsUnknown : {};

        const cpuDelta =
          readNumber(rawStats, ["cpu_stats.cpu_usage.total_usage"])
          - readNumber(rawStats, ["precpu_stats.cpu_usage.total_usage"]);
        const systemDelta =
          readNumber(rawStats, ["cpu_stats.system_cpu_usage"])
          - readNumber(rawStats, ["precpu_stats.system_cpu_usage"]);
        const onlineCpus = Math.max(1, readNumber(rawStats, ["cpu_stats.online_cpus"]));

        const cpuPercent = cpuDelta > 0 && systemDelta > 0
          ? (cpuDelta / systemDelta) * onlineCpus * 100
          : 0;

        const memoryUsage = readNumber(rawStats, ["memory_stats.usage"]);
        const memoryLimit = readNumber(rawStats, ["memory_stats.limit"]);
        const memoryPercent = memoryLimit > 0 ? (memoryUsage / memoryLimit) * 100 : 0;

        const networkRxKb = sumNetworkBytes(rawStats, "rx_bytes") / 1024;
        const networkTxKb = sumNetworkBytes(rawStats, "tx_bytes") / 1024;
        const ioReadKb = sumBlockIoBytes(rawStats, "Read") / 1024;
        const ioWriteKb = sumBlockIoBytes(rawStats, "Write") / 1024;

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
                cpu: normalizePercent(cpuPercent),
                memory: normalizePercent(memoryPercent),
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
        this.logger.warn(`Fallback metrics collection failed for ${candidateId}: ${formatError(error)}`);
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

  private debug(source: unknown, context?: Record<string, unknown>): void {
    this.debugLogger.debug(source, context);
  }
}
