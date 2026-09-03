import { Injectable } from "@nestjs/common";
import { EMPTY, Observable, defer, from, interval, merge, of } from "rxjs";
import { catchError, distinctUntilChanged, filter, finalize, map, mergeWith, switchMap, tap } from "rxjs/operators";
import type {
    DockerContainerInspectStreamQueryInput,
} from "@repo/api-contracts/modules/docker/containers/shared";
import type { DockerImageInspectStreamQueryInput } from "@repo/api-contracts/modules/docker/images/stream-inspect";
import type { DockerRuntimeEventsStreamQueryInput } from "@repo/api-contracts/modules/docker/runtime/shared";
import {
    dockerContainerInspectDetailSchema,
    dockerImageInspectDetailSchema,
    type DockerContainerInspectDetail,
    type DockerContainerRuntimeEvent,
    type DockerImageInspectDetail,
    type DockerRuntimeEvent,
} from "@repo/contracts-entities";
import { DockerContainerResolutionService } from "../../domains/containers/orchestration/docker-container-resolution.service";
import { DockerContainerMetricsStreamService } from "../../domains/containers/events/docker-container-metrics-stream.service";
import { DockerRepository } from "../../repositories/facade/docker.repository";
import { AppLogger } from "@repo/logger";
import { DockerRuntimeEventsStreamService } from "../events/docker-runtime-events-stream.service";
import { isRecord, isObjectLike } from "@repo/type-guards"

type DockerKnownSource = Exclude<DockerRuntimeEvent["source"], "unknown">;

interface RuntimeStreamQuery {
    since?: string;
    until?: string;
    scopes?: string[];
    sources?: DockerKnownSource[];
    actions?: string[];
    actorIds?: string[];
    containerIds?: string[];
    imageIds?: string[];
    serviceIds?: string[];
    nodeIds?: string[];
    filter?: RuntimeEventFilterNode;
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

const MIN_INSPECT_REFRESH_INTERVAL_MS = 400;
const MAX_INSPECT_REFRESH_INTERVAL_MS = 60_000;

interface RuntimeFastPathFilters {
    scopes?: string[];
    sources?: DockerKnownSource[];
    actions?: string[];
    actorIds?: string[];
    containerIds?: string[];
    imageIds?: string[];
    serviceIds?: string[];
    nodeIds?: string[];
}

type InspectTriggerOrigin = "initial" | "interval" | "runtime";

interface InspectTrigger {
    containerId: string;
    origin: InspectTriggerOrigin;
}



@Injectable()
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
        private readonly dockerRuntimeEventsStreamService: DockerRuntimeEventsStreamService,
        private readonly dockerContainerResolutionService: DockerContainerResolutionService,
        private readonly dockerContainerMetricsStreamService: DockerContainerMetricsStreamService,
        private readonly dockerRepository: DockerRepository,
    ) {}

    stream(query: DockerRuntimeEventsStreamQueryInput): Observable<DockerRuntimeEvent> {
        const rawQuery = isRecord(query) ? query : {};
        const traceId = this.nextStreamTraceId();
        const since = typeof rawQuery.since === "string" ? rawQuery.since : undefined;
        const until = typeof rawQuery.until === "string" ? rawQuery.until : undefined;
        const filter = this.isRuntimeEventFilterNode(rawQuery.filter)
            ? rawQuery.filter
            : undefined;
        const fastPath = this.extractFastPathFilters(filter);

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

        const relaySource$ = this.filterRuntimeEvents(
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

        return this.filterRuntimeEvents(source$, {
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
        const refreshIntervalMs = this.resolveRefreshInterval(query.refreshIntervalMs);
        let pausedAfterNotFound = false;

        const runtimeTrigger$ = this.dockerRuntimeEventsStreamService.observeEvents().pipe(
            filter((event): event is DockerContainerRuntimeEvent => event.source === "container"),
            filter((event) => {
                const payload = event.payload;
                if (typeof payload.containerId === "string"
                    && this.matchesIdentifier(payload.containerId, containerIdentifier)) {
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
            switchMap((trigger) => from(this.dockerContainerResolutionService.inspectContainer(trigger.containerId)).pipe(
                map((detail) => {
                    pausedAfterNotFound = false;
                    return detail;
                }),
                catchError((error) => {
                    if (this.isNotFoundError(error)) {
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
        const refreshIntervalMs = this.resolveRefreshInterval(query.refreshIntervalMs);

        const runtimeTrigger$ = this.dockerRuntimeEventsStreamService.observeEvents().pipe(
            filter((event) => event.source === "image"),
            filter((event) => this.matchesImageIdentifier(event, imageIdentifier)),
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

    private filterRuntimeEvents(
        source$: Observable<DockerRuntimeEvent>,
        query: RuntimeStreamQuery,
    ): Observable<DockerRuntimeEvent> {
        let stream$ = source$;

        if (query.sources && query.sources.length > 0) {
            const sourceSet = new Set(query.sources);
            stream$ = stream$.pipe(filter((event) => sourceSet.has(event.source as DockerKnownSource)));
        }

        if (query.scopes && query.scopes.length > 0) {
            const scopeSet = new Set(query.scopes);
            stream$ = stream$.pipe(filter((event) => {
                const scope = event.scope;
                return typeof scope === "string" && scopeSet.has(scope);
            }));
        }

        if (query.actions && query.actions.length > 0) {
            const actionSet = new Set(query.actions);
            stream$ = stream$.pipe(filter((event) => actionSet.has(event.action)));
        }

        if (query.actorIds && query.actorIds.length > 0) {
            const actorIdSet = new Set(query.actorIds);
            stream$ = stream$.pipe(filter((event) => {
                const actorId = event.actorId;
                return typeof actorId === "string" && actorIdSet.has(actorId);
            }));
        }

        if (query.containerIds && query.containerIds.length > 0) {
            const normalizedContainerIds = query.containerIds
                .map((entry) => entry.trim())
                .filter((entry) => entry.length > 0);

            stream$ = stream$.pipe(filter((event) => {
                const containerId = this.resolveContainerId(event);
                if (typeof containerId !== "string" || containerId.length === 0) {
                    return false;
                }

                return normalizedContainerIds.some((target) => this.matchesIdentifier(containerId, target));
            }));
        }

        if (query.imageIds && query.imageIds.length > 0) {
            const imageIdSet = new Set(query.imageIds);
            stream$ = stream$.pipe(filter((event) => {
                const imageId = this.resolveImageId(event);
                return typeof imageId === "string" && imageIdSet.has(imageId);
            }));
        }

        if (query.serviceIds && query.serviceIds.length > 0) {
            const serviceIdSet = new Set(query.serviceIds);
            stream$ = stream$.pipe(filter((event) => {
                const serviceId = this.resolveServiceId(event);
                return typeof serviceId === "string" && serviceIdSet.has(serviceId);
            }));
        }

        if (query.nodeIds && query.nodeIds.length > 0) {
            const nodeIdSet = new Set(query.nodeIds);
            stream$ = stream$.pipe(filter((event) => {
                const nodeId = this.resolveNodeId(event);
                return typeof nodeId === "string" && nodeIdSet.has(nodeId);
            }));
        }

        if (query.filter) {
            const filterNode = query.filter;
            if (this.isRuntimeEventFilterNode(filterNode)) {
                stream$ = stream$.pipe(filter((event) => this.matchesRuntimeEventFilter(event, filterNode)));
            }
        }

        const sinceEpoch = this.parseTimestamp(query.since);
        if (sinceEpoch !== null) {
            stream$ = stream$.pipe(
                filter((event) => {
                    const eventEpoch = this.parseTimestamp(event.timestamp);
                    return eventEpoch !== null && eventEpoch >= sinceEpoch;
                }),
            );
        }

        const untilEpoch = this.parseTimestamp(query.until);
        if (untilEpoch !== null) {
            stream$ = stream$.pipe(
                filter((event) => {
                    const eventEpoch = this.parseTimestamp(event.timestamp);
                    return eventEpoch !== null && eventEpoch <= untilEpoch;
                }),
            );
        }

        return stream$;
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

    private isRuntimeEventFilterNode(value: unknown): value is RuntimeEventFilterNode {
        return typeof value === "object" && value !== null && !Array.isArray(value);
    }

    private isRuntimeEventFieldFilter(value: unknown): value is RuntimeEventFieldFilter {
        if (typeof value !== "object" || value === null) {
            return false;
        }

        const record = isRecord(value) ? value : {};
        return typeof record.operator === "string" && "value" in record;
    }

    private matchesRuntimeEventFilter(event: DockerRuntimeEvent, filterNode: RuntimeEventFilterNode): boolean {
        for (const [field, fieldFilter] of Object.entries(filterNode)) {
            if (field === "_and" || field === "_or") {
                continue;
            }

            if (!this.isRuntimeEventFieldFilter(fieldFilter)) {
                return false;
            }

            const actualValue = this.getRuntimeEventFieldValue(event, field);

            if (field === "containerId") {
                if (!this.matchesContainerIdFilter(actualValue, fieldFilter.operator, fieldFilter.value)) {
                    return false;
                }

                continue;
            }

            if (!this.matchesFieldFilter(actualValue, fieldFilter.operator, fieldFilter.value)) {
                return false;
            }
        }

        const andNodes = this.toFilterNodeArray(filterNode._and);
        if (andNodes.length > 0) {
            const andMatches = andNodes.every((child) =>
                this.isRuntimeEventFilterNode(child) && this.matchesRuntimeEventFilter(event, child),
            );

            if (!andMatches) {
                return false;
            }
        }

        const orNodes = this.toFilterNodeArray(filterNode._or);
        if (orNodes.length > 0) {
            const orMatches = orNodes.some((child) =>
                this.isRuntimeEventFilterNode(child) && this.matchesRuntimeEventFilter(event, child),
            );

            if (!orMatches) {
                return false;
            }
        }

        return true;
    }

    private getRuntimeEventFieldValue(event: DockerRuntimeEvent, field: string): unknown {
        const eventRecord = isRecord(event) ? event : {};
        if (field in eventRecord && field !== "payload") {
            return eventRecord[field];
        }

        const payload = this.toRecord(event.payload);

        switch (field) {
            case "containerId":
                return payload.containerId ?? event.actorId;
            case "containerName":
                return payload.containerName ?? payload.name ?? null;
            case "serviceId":
                return payload.serviceId ?? null;
            case "serviceName":
                return payload.serviceName ?? payload.name ?? null;
            case "networkId":
                return payload.networkId ?? null;
            case "networkName":
                return payload.networkName ?? payload.name ?? null;
            case "volumeName":
                return payload.volumeName ?? payload.name ?? null;
            case "imageId":
                return payload.imageId ?? event.actorId;
            case "imageName":
                return payload.imageName ?? payload.image ?? payload.name ?? event.from ?? null;
            case "repository":
                return payload.repository ?? null;
            case "tag":
                return payload.tag ?? null;
            case "swarmNodeId":
                return payload.swarmNodeId ?? null;
            case "secretId":
                return payload.secretId ?? null;
            case "secretName":
                return payload.secretName ?? payload.name ?? null;
            case "configId":
                return payload.configId ?? null;
            case "configName":
                return payload.configName ?? payload.name ?? null;
            case "builderId":
                return payload.builderId ?? null;
            case "builderName":
                return payload.builderName ?? payload.name ?? null;
            default:
                return payload[field];
        }
    }

    private toRecord(value: unknown): Record<string, unknown> {
        if (typeof value === "object" && value !== null) {
            return isRecord(value) ? value : {};
        }
        return {};
    }

    private matchesFieldFilter(actualValue: unknown, operator: string, expectedValue: unknown): boolean {
        switch (operator) {
            case "eq":
                return this.areValuesEqual(actualValue, expectedValue);
            case "ne":
                return !this.areValuesEqual(actualValue, expectedValue);
            case "in": {
                const candidates = this.toUnknownArray(expectedValue);
                return candidates.length > 0
                    && candidates.some((candidate) => this.areValuesEqual(actualValue, candidate));
            }
            case "notIn":
            case "nin": {
                const candidates = this.toUnknownArray(expectedValue);
                return candidates.length > 0
                    && candidates.every((candidate) => !this.areValuesEqual(actualValue, candidate));
            }
            case "like":
                return this.matchesStringPattern(actualValue, expectedValue, false, "contains");
            case "ilike":
                return this.matchesStringPattern(actualValue, expectedValue, true, "contains");
            case "startsWith":
                return this.matchesStringPattern(actualValue, expectedValue, false, "startsWith");
            case "endsWith":
                return this.matchesStringPattern(actualValue, expectedValue, false, "endsWith");
            case "contains":
                if (typeof actualValue === "string") {
                    return this.matchesStringPattern(actualValue, expectedValue, false, "contains");
                }

                if (Array.isArray(actualValue)) {
                    return actualValue.some((candidate) => this.areValuesEqual(candidate, expectedValue));
                }

                return false;
            case "regex":
                return this.matchesRegex(actualValue, expectedValue);
            case "gt":
                return this.compareValues(actualValue, expectedValue) > 0;
            case "gte":
                return this.compareValues(actualValue, expectedValue) >= 0;
            case "lt":
                return this.compareValues(actualValue, expectedValue) < 0;
            case "lte":
                return this.compareValues(actualValue, expectedValue) <= 0;
            case "between":
                return this.matchesBetween(actualValue, expectedValue);
            case "isNull":
                return actualValue == null;
            case "isNotNull":
                return actualValue != null;
            default:
                return false;
        }
    }

    private extractFastPathFilters(filterNode: RuntimeEventFilterNode | undefined): RuntimeFastPathFilters {
        if (!filterNode) {
            return {};
        }

        const scopeValues = new Set<string>();
        const sourceValues = new Set<string>();
        const actionValues = new Set<string>();
        const actorIdValues = new Set<string>();
        const containerIdValues = new Set<string>();
        const imageIdValues = new Set<string>();
        const serviceIdValues = new Set<string>();
        const nodeIdValues = new Set<string>();

        this.collectFieldFilterValues(filterNode, "scope", scopeValues);
        this.collectFieldFilterValues(filterNode, "source", sourceValues);
        this.collectFieldFilterValues(filterNode, "action", actionValues);
        this.collectFieldFilterValues(filterNode, "actorId", actorIdValues);
        this.collectFieldFilterValues(filterNode, "containerId", containerIdValues);
        this.collectFieldFilterValues(filterNode, "imageId", imageIdValues);
        this.collectFieldFilterValues(filterNode, "serviceId", serviceIdValues);
        this.collectFieldFilterValues(filterNode, "nodeId", nodeIdValues);
        this.collectFieldFilterValues(filterNode, "swarmNodeId", nodeIdValues);

        return {
            scopes: this.parseStringArray([...scopeValues]),
            sources: this.parseSources([...sourceValues]),
            actions: this.parseStringArray([...actionValues]),
            actorIds: this.parseStringArray([...actorIdValues]),
            containerIds: this.parseStringArray([...containerIdValues]),
            imageIds: this.parseStringArray([...imageIdValues]),
            serviceIds: this.parseStringArray([...serviceIdValues]),
            nodeIds: this.parseStringArray([...nodeIdValues]),
        };
    }

    private resolveContainerId(event: DockerRuntimeEvent): string | null {
        const payload = this.toRecord(event.payload);
        const fromPayload = payload.containerId;
        if (typeof fromPayload === "string" && fromPayload.length > 0) {
            return fromPayload;
        }

        return typeof event.actorId === "string" && event.source === "container"
            ? event.actorId
            : null;
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

    private matchesContainerIdFilter(actualValue: unknown, operator: string, expectedValue: unknown): boolean {
        if (typeof actualValue !== "string") {
            return false;
        }

        if (operator === "eq") {
            return typeof expectedValue === "string"
                && this.matchesIdentifier(actualValue, expectedValue);
        }

        if (operator === "ne") {
            return typeof expectedValue === "string"
                && !this.matchesIdentifier(actualValue, expectedValue);
        }

        if (operator === "in") {
            const candidates = this.toUnknownArray(expectedValue);
            return candidates.length > 0
                && candidates.some((candidate) =>
                    typeof candidate === "string"
                    && this.matchesIdentifier(actualValue, candidate),
                );
        }

        if (operator === "notIn" || operator === "nin") {
            const candidates = this.toUnknownArray(expectedValue);
            return candidates.length > 0
                && candidates.every((candidate) =>
                    typeof candidate !== "string"
                    || !this.matchesIdentifier(actualValue, candidate),
                );
        }

        return this.matchesFieldFilter(actualValue, operator, expectedValue);
    }

    private resolveImageId(event: DockerRuntimeEvent): string | null {
        const payload = this.toRecord(event.payload);
        const fromPayload = payload.imageId;
        if (typeof fromPayload === "string" && fromPayload.length > 0) {
            return fromPayload;
        }

        return typeof event.actorId === "string" && event.source === "image"
            ? event.actorId
            : null;
    }

    private resolveServiceId(event: DockerRuntimeEvent): string | null {
        const payload = this.toRecord(event.payload);
        const value = payload.serviceId;
        return typeof value === "string" && value.length > 0 ? value : null;
    }

    private resolveNodeId(event: DockerRuntimeEvent): string | null {
        if (typeof event.nodeId === "string" && event.nodeId.length > 0) {
            return event.nodeId;
        }

        const payload = this.toRecord(event.payload);
        const swarmNodeId = payload.swarmNodeId;
        return typeof swarmNodeId === "string" && swarmNodeId.length > 0 ? swarmNodeId : null;
    }

    private matchesImageIdentifier(event: DockerRuntimeEvent, imageIdentifier: string): boolean {
        if (event.source !== "image") {
            return false;
        }

        const payload = this.toRecord(event.payload);
        const imageId = typeof payload.imageId === "string" ? payload.imageId : null;
        const imageName = typeof payload.imageName === "string" ? payload.imageName : null;
        const repository = typeof payload.repository === "string" ? payload.repository : null;
        const tag = typeof payload.tag === "string" ? payload.tag : null;
        const actorId = typeof event.actorId === "string" ? event.actorId : null;

        if (imageIdentifier === imageId || imageIdentifier === actorId || imageIdentifier === imageName) {
            return true;
        }

        if (repository && tag && imageIdentifier === `${repository}:${tag}`) {
            return true;
        }

        return repository !== null && imageIdentifier === repository;
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

    private areValuesEqual(left: unknown, right: unknown): boolean {
        if (left == null || right == null) {
            return left == null && right == null;
        }

        if (typeof left === "number" || typeof right === "number") {
            const leftNumber = Number(left);
            const rightNumber = Number(right);
            if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
                return leftNumber === rightNumber;
            }
        }

        return this.toComparableString(left) === this.toComparableString(right);
    }

    private matchesStringPattern(
        actualValue: unknown,
        expectedValue: unknown,
        caseInsensitive: boolean,
        mode: "contains" | "startsWith" | "endsWith",
    ): boolean {
        if (typeof actualValue !== "string" || typeof expectedValue !== "string") {
            return false;
        }

        const actual = caseInsensitive ? actualValue.toLowerCase() : actualValue;
        const expected = caseInsensitive ? expectedValue.toLowerCase() : expectedValue;

        if (mode === "startsWith") {
            return actual.startsWith(expected);
        }

        if (mode === "endsWith") {
            return actual.endsWith(expected);
        }

        return actual.includes(expected);
    }

    private matchesRegex(actualValue: unknown, expectedValue: unknown): boolean {
        if (typeof actualValue !== "string" || typeof expectedValue !== "string") {
            return false;
        }

        try {
            return new RegExp(expectedValue).test(actualValue);
        } catch {
            return false;
        }
    }

    private matchesBetween(actualValue: unknown, expectedValue: unknown): boolean {
        if (!Array.isArray(expectedValue) || expectedValue.length !== 2) {
            return false;
        }

        const [lower, upper] = expectedValue as [unknown, unknown];
        return this.compareValues(actualValue, lower) >= 0 && this.compareValues(actualValue, upper) <= 0;
    }

    private compareValues(left: unknown, right: unknown): number {
        const leftNumber = Number(left);
        const rightNumber = Number(right);
        if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
            return leftNumber - rightNumber;
        }

        const leftDate = this.toTimestamp(left);
        const rightDate = this.toTimestamp(right);
        if (leftDate !== null && rightDate !== null) {
            return leftDate - rightDate;
        }

        return this.toComparableString(left).localeCompare(this.toComparableString(right));
    }

    private toComparableString(value: unknown): string {
        if (typeof value === "string") {
            return value;
        }

        if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") {
            return String(value);
        }

        if (value === null || typeof value === "undefined") {
            return "";
        }

        try {
            return JSON.stringify(value);
        } catch {
            return "";
        }
    }

    private toTimestamp(value: unknown): number | null {
        if (typeof value !== "string" && typeof value !== "number") {
            return null;
        }

        const parsed = Date.parse(String(value));
        return Number.isNaN(parsed) ? null : parsed;
    }

    private parseStringArray(value: unknown): string[] | undefined {
        const normalized = this.toUnknownArray(value)
            .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

        return normalized.length > 0 ? normalized : undefined;
    }

    private parseSources(value: unknown): DockerKnownSource[] | undefined {
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
        const normalized = this.toUnknownArray(value)
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

    private parseTimestamp(value: string | undefined): number | null {
        if (!value || value.length === 0) {
            return null;
        }

        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) {
            return parsed;
        }

        const numericValue = Number(value);
        if (Number.isFinite(numericValue)) {
            return numericValue;
        }

        return null;
    }

    private resolveRefreshInterval(input: number | undefined): number | null {
        if (typeof input !== "number" || !Number.isInteger(input)) {
            return null;
        }

        return Math.max(MIN_INSPECT_REFRESH_INTERVAL_MS, Math.min(MAX_INSPECT_REFRESH_INTERVAL_MS, input));
    }

    private isNotFoundError(error: unknown): boolean {
        if (typeof error !== "object" || error === null) {
            return false;
        }

        const record = isRecord(error) ? error : {};

        if (record.statusCode === 404 || record.status === 404) {
            return true;
        }

        const message = typeof record.message === "string" ? record.message.toLowerCase() : "";
        return message.includes("not found") || message.includes("no such container");
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
        const payload = this.toRecord(event.payload);
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
