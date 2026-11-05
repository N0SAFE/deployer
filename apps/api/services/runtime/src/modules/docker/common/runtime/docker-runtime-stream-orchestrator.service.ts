
import { Effect } from "effect";
import { EMPTY, Observable, defer, from, interval, merge, of } from "rxjs";
import { catchError, distinctUntilChanged, filter, finalize, map, mergeWith, switchMap, tap } from "rxjs/operators";

import {
    dockerContainerInspectDetailSchema,
    dockerImageInspectDetailSchema,
    type DockerContainerInspectDetail,
    type DockerContainerRuntimeEvent,
    type DockerImageInspectDetail,
    type DockerRuntimeEvent,
} from "@deployer/contracts-entities";
import { AppLogger } from "@deployer/logger";
import { type EffectHostShape } from "@deployer/nest-effect";
import type {
    DockerContainerInspectStreamQueryInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import type { DockerImageInspectStreamQueryInput } from "@deployer/runtime-contracts/modules/docker/images/stream-inspect";
import type { DockerRuntimeEventsStreamQueryInput } from "@deployer/runtime-contracts/modules/docker/runtime/shared";
import { isRecord } from "@deployer/type-guards"

import { DockerContainerMetricsStreamService } from "../../domains/containers/events/docker-container-metrics-stream.service";
import { DockerContainerResolution } from "../../domains/containers/orchestration/docker-container-resolution";
import { DockerRepository } from "../../repositories/facade/docker.repository";
import type { DockerRuntimeEventsStreamShape } from "../events/docker-runtime-events-stream.service";


import {
    
    
    
    
    extractFastPathFilters,
    filterRuntimeEvents,
    
    isNotFoundError,
    
    isRuntimeEventFilterNode,
    
    
    
    matchesIdentifier,
    matchesImageIdentifier,
    
    
    
    
    
    
    
    
    
    resolveRefreshInterval,
    
    
    
    toRecord,
    
    
    type DockerKnownSource,
    type InspectTrigger,
    
    type RuntimeFastPathFilters,
    
} from "./runtime-event-filter";


export class DockerRuntimeStreamOrchestratorService {
    private static streamTraceSequence = 0;

    private readonly apiLogger = new AppLogger("api").scope(DockerRuntimeStreamOrchestratorService.name);
    private readonly scopedLogger = this.apiLogger.log;

    private readonly debugLogger = this.apiLogger.createContextFilterLogger({
        defaultClassName: DockerRuntimeStreamOrchestratorService.name,
        filterEnvVar: "APP_DEBUG_CONTEXT_FILTER",
        channel: "docker-runtime-stream",
    });
    private readonly streamEventCounters = new Map<string, { relay: number; metrics: number; emitted: number }>();

    constructor(
        private readonly dockerRuntimeEventsStreamService: Pick<DockerRuntimeEventsStreamShape, "observeEvents">,
        private readonly host: EffectHostShape,
        private readonly dockerContainerMetricsStreamService: DockerContainerMetricsStreamService,
        private readonly dockerRepository: DockerRepository,
    ) {}

    stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeEvent> {
        const rawQuery = isRecord(query) ? query : {};
        const traceId = this.nextStreamTraceId();
        const since = typeof rawQuery.since === "string" ? rawQuery.since : undefined;
        const until = typeof rawQuery.until === "string" ? rawQuery.until : undefined;
        const filter = isRuntimeEventFilterNode(rawQuery.filter)
            ? rawQuery.filter
            : undefined;
        const fastPath = extractFastPathFilters(filter);

        const includeMetricsEvents = this.shouldIncludeMetricsEvents(
            fastPath.sources,
            fastPath.actions,
            traceId,
        );

        this.streamEventCounters.set(traceId, { relay: 0, metrics: 0, emitted: 0 });
        const noEventsTimeout = setTimeout(() => {
            const counters = this.streamEventCounters.get(traceId);
            if (!counters) {
                return;
            }

            this.scopedLogger.info("[docker-runtime-stream] stream_no_events_yet", {
                traceId,
                afterMs: 5000,
                includeMetricsEvents,
                counters,
                fastPath: this.summarizeFastPath(fastPath),
            });
        }, 5000);

        this.scopedLogger.info("[docker-runtime-stream] stream_open", {
            traceId,
            includeMetricsEvents,
            since,
            until,
            fastPath: this.summarizeFastPath(fastPath),
            hasFilter: Boolean(filter),
        });
        this.debug("stream", {
            traceId,
            phase: "subscription_open",
            includeMetricsEvents,
            since,
            until,
            fastPath: this.summarizeFastPath(fastPath),
            hasFilter: Boolean(filter),
        });

        const relaySource$ = filterRuntimeEvents(
            this.dockerRuntimeEventsStreamService.observeEvents(),
            {
                scopes: fastPath.scopes,
                sources: fastPath.sources,
                actions: fastPath.actions,
                actorIds: fastPath.actorIds,
                containerIds: fastPath.containerIds,
                imageIds: fastPath.imageIds,
                serviceIds: fastPath.serviceIds,
                nodeIds: fastPath.nodeIds,
            },
        ).pipe(
            tap((event) => {
                this.traceIncomingEvent(traceId, "relay", event);
            }),
        );

        const metricsSource$ = defer(() => {
            this.scopedLogger.info("[docker-runtime-stream] metrics_source_subscribe", {
                traceId,
            });

            return this.dockerContainerMetricsStreamService.stream(query).pipe(
                tap((event) => {
                    this.traceIncomingEvent(traceId, "metrics", event);
                }),
                finalize(() => {
                    this.scopedLogger.info("[docker-runtime-stream] metrics_source_unsubscribe", {
                        traceId,
                    });
                }),
            );
        });

        const source$ = includeMetricsEvents
            ? relaySource$.pipe(mergeWith(metricsSource$))
            : relaySource$;

        return filterRuntimeEvents(source$, {
            since,
            until,
            scopes: fastPath.scopes,
            sources: fastPath.sources,
            actions: fastPath.actions,
            actorIds: fastPath.actorIds,
            containerIds: fastPath.containerIds,
            imageIds: fastPath.imageIds,
            serviceIds: fastPath.serviceIds,
            nodeIds: fastPath.nodeIds,
            filter,
        }).pipe(
            tap((event) => {
                const counters = this.streamEventCounters.get(traceId);
                if (!counters) {
                    return;
                }

                counters.emitted += 1;
                if (this.shouldTraceEvent(counters.emitted)) {
                    this.debug("stream", {
                        traceId,
                        phase: "stream_event_emitted",
                        ...this.summarizeEvent(event, counters.emitted),
                    });
                }
            }),
            finalize(() => {
                clearTimeout(noEventsTimeout);
                const counters = this.streamEventCounters.get(traceId);
                this.scopedLogger.info("[docker-runtime-stream] stream_closed", {
                    traceId,
                    counters,
                });
                this.debug("stream", {
                    traceId,
                    phase: "subscription_closed",
                    counters,
                });
                this.streamEventCounters.delete(traceId);
            }),
        );
    }

    streamContainerInspect(query: DockerContainerInspectStreamQueryInput): Observable<DockerContainerInspectDetail> {
        const containerIdentifier = query.containerId.trim();
        const refreshIntervalMs = resolveRefreshInterval(query.refreshIntervalMs);
        let pausedAfterNotFound = false;

        const runtimeTrigger$ = this.dockerRuntimeEventsStreamService.observeEvents().pipe(
            filter((event): event is DockerContainerRuntimeEvent => event.source === "container"),
            filter((event) => {
                const payload = event.payload;
                if (typeof payload.containerId === "string"
                    && matchesIdentifier(payload.containerId, containerIdentifier)) {
                    return true;
                }

                return payload.containerName === containerIdentifier;
            }),
            map((): InspectTrigger => ({
                containerId: containerIdentifier,
                origin: "runtime",
            })),
        );

        const initialTrigger$ = of<InspectTrigger>({
            containerId: containerIdentifier,
            origin: "initial",
        });
        const triggerStreams: Observable<InspectTrigger>[] = [initialTrigger$, runtimeTrigger$];

        if (refreshIntervalMs !== null) {
            triggerStreams.push(interval(refreshIntervalMs).pipe(map((): InspectTrigger => ({
                containerId: containerIdentifier,
                origin: "interval",
            }))));
        }

        return merge(...triggerStreams).pipe(
            filter((trigger) => !pausedAfterNotFound || trigger.origin === "runtime"),
            switchMap((trigger) => from(this.host.runUnwrapped(Effect.gen(function* () {
                const resolution = yield* DockerContainerResolution;
                return yield* resolution.inspectContainer(trigger.containerId);
            }))).pipe(
                map((detail) => {
                    pausedAfterNotFound = false;
                    return detail;
                }),
                catchError((error) => {
                    if (isNotFoundError(error)) {
                        pausedAfterNotFound = true;
                    }

                    return EMPTY;
                }),
            )),
            map((detail) => dockerContainerInspectDetailSchema.parse(detail)),
            distinctUntilChanged((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        );
    }

    streamImageInspect(query: DockerImageInspectStreamQueryInput): Observable<DockerImageInspectDetail> {
        const imageIdentifier = query.imageId.trim();
        const refreshIntervalMs = resolveRefreshInterval(query.refreshIntervalMs);

        const runtimeTrigger$ = this.dockerRuntimeEventsStreamService.observeEvents().pipe(
            filter((event) => event.source === "image"),
            filter((event) => matchesImageIdentifier(event, imageIdentifier)),
            map(() => imageIdentifier),
        );

        const initialTrigger$ = of(imageIdentifier);
        const triggerStreams: Observable<string>[] = [initialTrigger$, runtimeTrigger$];

        if (refreshIntervalMs !== null) {
            triggerStreams.push(interval(refreshIntervalMs).pipe(map(() => imageIdentifier)));
        }

        return merge(...triggerStreams).pipe(
            switchMap((resolvedImageId) =>
                from(this.dockerRepository.inspectImage(resolvedImageId)).pipe(
                    catchError(() => EMPTY),
                ),
            ),
            map((detail) => dockerImageInspectDetailSchema.parse(detail)),
            distinctUntilChanged((left, right) => JSON.stringify(left) === JSON.stringify(right)),
        );
    }

    private shouldIncludeMetricsEvents(
        sources: DockerKnownSource[] | undefined,
        actions: string[] | undefined,
        traceId?: string,
    ): boolean {
        if (!actions || actions.length === 0) {
            this.scopedLogger.info("[docker-runtime-stream] metrics_disabled", {
                traceId,
                reason: "no_actions_filter",
                sources,
            });
            this.debug("shouldIncludeMetricsEvents", {
                traceId,
                phase: "metrics_disabled",
                reason: "no_actions_filter",
            });
            return false;
        }

        if (!actions.includes("metrics")) {
            this.scopedLogger.info("[docker-runtime-stream] metrics_disabled", {
                traceId,
                reason: "metrics_action_not_requested",
                actions,
                sources,
            });
            this.debug("shouldIncludeMetricsEvents", {
                traceId,
                phase: "metrics_disabled",
                reason: "metrics_action_not_requested",
                actions,
            });
            return false;
        }

        if (sources && sources.length > 0 && !sources.includes("container")) {
            this.scopedLogger.info("[docker-runtime-stream] metrics_disabled", {
                traceId,
                reason: "container_source_not_requested",
                actions,
                sources,
            });
            this.debug("shouldIncludeMetricsEvents", {
                traceId,
                phase: "metrics_disabled",
                reason: "container_source_not_requested",
                sources,
            });
            return false;
        }

        this.scopedLogger.info("[docker-runtime-stream] metrics_enabled", {
            traceId,
            actions,
            sources,
        });
        this.debug("shouldIncludeMetricsEvents", {
            traceId,
            phase: "metrics_enabled",
            sources,
            actions,
        });

        return true;
    }

    private nextStreamTraceId(): string {
        DockerRuntimeStreamOrchestratorService.streamTraceSequence += 1;
        return `docker-runtime-stream-${String(DockerRuntimeStreamOrchestratorService.streamTraceSequence)}`;
    }

    private traceIncomingEvent(traceId: string, stage: "relay" | "metrics", event: DockerRuntimeEvent): void {
        const counters = this.streamEventCounters.get(traceId);
        if (!counters) {
            return;
        }

        counters[stage] += 1;
        const count = counters[stage];

        if (this.shouldTraceEvent(count)) {
            this.debug("traceIncomingEvent", {
                traceId,
                phase: `source_event_${stage}`,
                ...this.summarizeEvent(event, count),
            });
        }

        if (count === 1) {
            this.scopedLogger.info(`[docker-runtime-stream] source_event_${stage}`, {
                traceId,
                ...this.summarizeEvent(event, count),
            });
        }
    }

    private shouldTraceEvent(count: number): boolean {
        return count <= 20 || count % 100 === 0;
    }

    private summarizeFastPath(fastPath: RuntimeFastPathFilters): Record<string, unknown> {
        return {
            sources: fastPath.sources,
            actions: fastPath.actions,
            containerIds: fastPath.containerIds,
            scopes: fastPath.scopes,
            actorIds: fastPath.actorIds,
            imageIds: fastPath.imageIds,
            serviceIds: fastPath.serviceIds,
            nodeIds: fastPath.nodeIds,
        };
    }

    private summarizeEvent(event: DockerRuntimeEvent, count: number): Record<string, unknown> {
        const payload = toRecord(event.payload);
        return {
            count,
            source: event.source,
            action: event.action,
            actorId: event.actorId,
            eventId: event.eventId,
            timestamp: event.timestamp,
            containerId: typeof payload.containerId === "string" ? payload.containerId : null,
            containerName: typeof payload.containerName === "string" ? payload.containerName : null,
            imageId: typeof payload.imageId === "string" ? payload.imageId : null,
            imageName: typeof payload.imageName === "string" ? payload.imageName : null,
        };
    }

    private debug(source: unknown, context?: Record<string, unknown>): void {
        this.debugLogger.debug(source, context);
    }
}
