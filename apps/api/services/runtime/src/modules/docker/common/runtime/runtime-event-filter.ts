/**
 * Filtering the docker runtime event stream: the query's fast-path filters, the nested `_and`/`_or` filter tree
 * and its field operators, plus the refresh-interval and not-found rules the inspect streams share. Pure
 * functions (and one RxJS operator chain), tested without an engine or a Nest container.
 */
import { filter } from "rxjs/operators";
import type { Observable } from "rxjs";
import type { DockerRuntimeEvent } from "@deployer/contracts-entities";
import { isRecord } from "@deployer/type-guards";

export type DockerKnownSource = Exclude<DockerRuntimeEvent["source"], "unknown">;

export type RuntimeStreamQuery = {
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

export type RuntimeEventFilterNode = {
    [key: string]: unknown;
    _and?: RuntimeEventFilterNode[];
    _or?: RuntimeEventFilterNode[];
}

export type RuntimeEventFieldFilter = {
    operator: string;
    value: unknown;
}

const MIN_INSPECT_REFRESH_INTERVAL_MS = 400;
const MAX_INSPECT_REFRESH_INTERVAL_MS = 60_000;

export type RuntimeFastPathFilters = {
    scopes?: string[];
    sources?: DockerKnownSource[];
    actions?: string[];
    actorIds?: string[];
    containerIds?: string[];
    imageIds?: string[];
    serviceIds?: string[];
    nodeIds?: string[];
}

export type InspectTriggerOrigin = "initial" | "interval" | "runtime";

export type InspectTrigger = {
    containerId: string;
    origin: InspectTriggerOrigin;
}

export function filterRuntimeEvents(
    source$: Observable<DockerRuntimeEvent>,
    query: RuntimeStreamQuery,
): Observable<DockerRuntimeEvent> {
    let stream$ = source$;

    if (query.sources && query.sources.length > 0) {
        // `query.sources` is `DockerKnownSource[]`, which deliberately EXCLUDES
        // `"unknown"` (a caller cannot ask for it). The set is keyed against
        // `event.source`, whose type still INCLUDES `"unknown"`, so a set typed to the
        // narrower union rejects the lookup. Keying by `string` keeps the comparison —
        // an `"unknown"` source simply never matches, which is the intended behaviour.
        const sourceSet = new Set<string>(query.sources);
        stream$ = stream$.pipe(filter((event) => sourceSet.has(event.source)));
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
            const containerId = resolveContainerId(event);
            if (typeof containerId !== "string" || containerId.length === 0) {
                return false;
            }

            return normalizedContainerIds.some((target) => matchesIdentifier(containerId, target));
        }));
    }

    if (query.imageIds && query.imageIds.length > 0) {
        const imageIdSet = new Set(query.imageIds);
        stream$ = stream$.pipe(filter((event) => {
            const imageId = resolveImageId(event);
            return typeof imageId === "string" && imageIdSet.has(imageId);
        }));
    }

    if (query.serviceIds && query.serviceIds.length > 0) {
        const serviceIdSet = new Set(query.serviceIds);
        stream$ = stream$.pipe(filter((event) => {
            const serviceId = resolveServiceId(event);
            return typeof serviceId === "string" && serviceIdSet.has(serviceId);
        }));
    }

    if (query.nodeIds && query.nodeIds.length > 0) {
        const nodeIdSet = new Set(query.nodeIds);
        stream$ = stream$.pipe(filter((event) => {
            const nodeId = resolveNodeId(event);
            return typeof nodeId === "string" && nodeIdSet.has(nodeId);
        }));
    }

    if (query.filter) {
        const filterNode = query.filter;
        if (isRuntimeEventFilterNode(filterNode)) {
            stream$ = stream$.pipe(filter((event) => matchesRuntimeEventFilter(event, filterNode)));
        }
    }

    const sinceEpoch = parseTimestamp(query.since);
    if (sinceEpoch !== null) {
        stream$ = stream$.pipe(
            filter((event) => {
                const eventEpoch = parseTimestamp(event.timestamp);
                return eventEpoch !== null && eventEpoch >= sinceEpoch;
            }),
        );
    }

    const untilEpoch = parseTimestamp(query.until);
    if (untilEpoch !== null) {
        stream$ = stream$.pipe(
            filter((event) => {
                const eventEpoch = parseTimestamp(event.timestamp);
                return eventEpoch !== null && eventEpoch <= untilEpoch;
            }),
        );
    }

    return stream$;
}

export function isRuntimeEventFilterNode(value: unknown): value is RuntimeEventFilterNode {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRuntimeEventFieldFilter(value: unknown): value is RuntimeEventFieldFilter {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        return false;
    }

    const record = isRecord(value) ? value : {};
    return typeof record.operator === "string" && "value" in record;
}

export function matchesRuntimeEventFilter(event: DockerRuntimeEvent, filterNode: RuntimeEventFilterNode): boolean {
    for (const [field, fieldFilter] of Object.entries(filterNode)) {
        if (field === "_and" || field === "_or") {
            continue;
        }

        if (!isRuntimeEventFieldFilter(fieldFilter)) {
            return false;
        }

        const actualValue = getRuntimeEventFieldValue(event, field);

        if (field === "containerId") {
            if (!matchesContainerIdFilter(actualValue, fieldFilter.operator, fieldFilter.value)) {
                return false;
            }

            continue;
        }

        if (!matchesFieldFilter(actualValue, fieldFilter.operator, fieldFilter.value)) {
            return false;
        }
    }

    const andNodes = toFilterNodeArray(filterNode._and);
    if (andNodes.length > 0) {
        const andMatches = andNodes.every((child) =>
            isRuntimeEventFilterNode(child) && matchesRuntimeEventFilter(event, child),
        );

        if (!andMatches) {
            return false;
        }
    }

    const orNodes = toFilterNodeArray(filterNode._or);
    if (orNodes.length > 0) {
        const orMatches = orNodes.some((child) =>
            isRuntimeEventFilterNode(child) && matchesRuntimeEventFilter(event, child),
        );

        if (!orMatches) {
            return false;
        }
    }

    return true;
}

export function getRuntimeEventFieldValue(event: DockerRuntimeEvent, field: string): unknown {
    const eventRecord = isRecord(event) ? event : {};
    if (field in eventRecord && field !== "payload") {
        return eventRecord[field];
    }

    const payload = toRecord(event.payload);

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

export function toRecord(value: unknown): Record<string, unknown> {
    if (typeof value === "object" && value !== null) {
        return isRecord(value) ? value : {};
    }
    return {};
}

export function matchesFieldFilter(actualValue: unknown, operator: string, expectedValue: unknown): boolean {
    switch (operator) {
        case "eq":
            return areValuesEqual(actualValue, expectedValue);
        case "ne":
            return !areValuesEqual(actualValue, expectedValue);
        case "in": {
            const candidates = toUnknownArray(expectedValue);
            return candidates.length > 0
                && candidates.some((candidate) => areValuesEqual(actualValue, candidate));
        }
        case "notIn":
        case "nin": {
            const candidates = toUnknownArray(expectedValue);
            return candidates.length > 0
                && candidates.every((candidate) => !areValuesEqual(actualValue, candidate));
        }
        case "like":
            return matchesStringPattern(actualValue, expectedValue, false, "contains");
        case "ilike":
            return matchesStringPattern(actualValue, expectedValue, true, "contains");
        case "startsWith":
            return matchesStringPattern(actualValue, expectedValue, false, "startsWith");
        case "endsWith":
            return matchesStringPattern(actualValue, expectedValue, false, "endsWith");
        case "contains":
            if (typeof actualValue === "string") {
                return matchesStringPattern(actualValue, expectedValue, false, "contains");
            }

            if (Array.isArray(actualValue)) {
                return actualValue.some((candidate) => areValuesEqual(candidate, expectedValue));
            }

            return false;
        case "regex":
            return matchesRegex(actualValue, expectedValue);
        case "gt":
            return compareValues(actualValue, expectedValue) > 0;
        case "gte":
            return compareValues(actualValue, expectedValue) >= 0;
        case "lt":
            return compareValues(actualValue, expectedValue) < 0;
        case "lte":
            return compareValues(actualValue, expectedValue) <= 0;
        case "between":
            return matchesBetween(actualValue, expectedValue);
        case "isNull":
            return actualValue == null;
        case "isNotNull":
            return actualValue != null;
        default:
            return false;
    }
}

export function extractFastPathFilters(filterNode: RuntimeEventFilterNode | undefined): RuntimeFastPathFilters {
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

    collectFieldFilterValues(filterNode, "scope", scopeValues);
    collectFieldFilterValues(filterNode, "source", sourceValues);
    collectFieldFilterValues(filterNode, "action", actionValues);
    collectFieldFilterValues(filterNode, "actorId", actorIdValues);
    collectFieldFilterValues(filterNode, "containerId", containerIdValues);
    collectFieldFilterValues(filterNode, "imageId", imageIdValues);
    collectFieldFilterValues(filterNode, "serviceId", serviceIdValues);
    collectFieldFilterValues(filterNode, "nodeId", nodeIdValues);
    collectFieldFilterValues(filterNode, "swarmNodeId", nodeIdValues);

    return {
        scopes: parseStringArray([...scopeValues]),
        sources: parseSources([...sourceValues]),
        actions: parseStringArray([...actionValues]),
        actorIds: parseStringArray([...actorIdValues]),
        containerIds: parseStringArray([...containerIdValues]),
        imageIds: parseStringArray([...imageIdValues]),
        serviceIds: parseStringArray([...serviceIdValues]),
        nodeIds: parseStringArray([...nodeIdValues]),
    };
}

export function resolveContainerId(event: DockerRuntimeEvent): string | null {
    const payload = toRecord(event.payload);
    const fromPayload = payload.containerId;
    if (typeof fromPayload === "string" && fromPayload.length > 0) {
        return fromPayload;
    }

    return typeof event.actorId === "string" && event.source === "container"
        ? event.actorId
        : null;
}

export function matchesIdentifier(actual: string, expected: string): boolean {
    const normalizedActual = actual.trim();
    const normalizedExpected = expected.trim();

    if (normalizedActual.length === 0 || normalizedExpected.length === 0) {
        return false;
    }

    return normalizedActual === normalizedExpected
        || normalizedActual.startsWith(normalizedExpected)
        || normalizedExpected.startsWith(normalizedActual);
}

export function matchesContainerIdFilter(actualValue: unknown, operator: string, expectedValue: unknown): boolean {
    if (typeof actualValue !== "string") {
        return false;
    }

    if (operator === "eq") {
        return typeof expectedValue === "string"
            && matchesIdentifier(actualValue, expectedValue);
    }

    if (operator === "ne") {
        return typeof expectedValue === "string"
            && !matchesIdentifier(actualValue, expectedValue);
    }

    if (operator === "in") {
        const candidates = toUnknownArray(expectedValue);
        return candidates.length > 0
            && candidates.some((candidate) =>
                typeof candidate === "string"
                && matchesIdentifier(actualValue, candidate),
            );
    }

    if (operator === "notIn" || operator === "nin") {
        const candidates = toUnknownArray(expectedValue);
        return candidates.length > 0
            && candidates.every((candidate) =>
                typeof candidate !== "string"
                || !matchesIdentifier(actualValue, candidate),
            );
    }

    return matchesFieldFilter(actualValue, operator, expectedValue);
}

export function resolveImageId(event: DockerRuntimeEvent): string | null {
    const payload = toRecord(event.payload);
    const fromPayload = payload.imageId;
    if (typeof fromPayload === "string" && fromPayload.length > 0) {
        return fromPayload;
    }

    return typeof event.actorId === "string" && event.source === "image"
        ? event.actorId
        : null;
}

export function resolveServiceId(event: DockerRuntimeEvent): string | null {
    const payload = toRecord(event.payload);
    const value = payload.serviceId;
    return typeof value === "string" && value.length > 0 ? value : null;
}

export function resolveNodeId(event: DockerRuntimeEvent): string | null {
    if (typeof event.nodeId === "string" && event.nodeId.length > 0) {
        return event.nodeId;
    }

    const payload = toRecord(event.payload);
    const swarmNodeId = payload.swarmNodeId;
    return typeof swarmNodeId === "string" && swarmNodeId.length > 0 ? swarmNodeId : null;
}

export function matchesImageIdentifier(event: DockerRuntimeEvent, imageIdentifier: string): boolean {
    if (event.source !== "image") {
        return false;
    }

    const payload = toRecord(event.payload);
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

        if (candidate.operator === "in") {
            for (const value of toUnknownArray(candidate.value)) {
                if (typeof value === "string" && value.length > 0) {
                    target.add(value);
                }
            }
        }
    }

    for (const child of toFilterNodeArray(filterNode._and)) {
            if (isRuntimeEventFilterNode(child)) {
                collectFieldFilterValues(child, field, target);
            }
    }

    for (const child of toFilterNodeArray(filterNode._or)) {
            if (isRuntimeEventFilterNode(child)) {
                collectFieldFilterValues(child, field, target);
            }
    }
}

export function toFilterNodeArray(value: unknown): RuntimeEventFilterNode[] {
    if (Array.isArray(value)) {
        return value.filter((item): item is RuntimeEventFilterNode => isRuntimeEventFilterNode(item));
    }

    if (typeof value !== "object" || value === null) {
        return [];
    }

    return Object.entries(isRecord(value) ? value : {})
        .sort(([leftKey], [rightKey]) => compareObjectKeys(leftKey, rightKey))
        .map(([, entryValue]) => entryValue)
        .filter((item): item is RuntimeEventFilterNode => isRuntimeEventFilterNode(item));
}

export function areValuesEqual(left: unknown, right: unknown): boolean {
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

    return toComparableString(left) === toComparableString(right);
}

export function matchesStringPattern(
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

export function matchesRegex(actualValue: unknown, expectedValue: unknown): boolean {
    if (typeof actualValue !== "string" || typeof expectedValue !== "string") {
        return false;
    }

    try {
        return new RegExp(expectedValue).test(actualValue);
    } catch {
        return false;
    }
}

export function matchesBetween(actualValue: unknown, expectedValue: unknown): boolean {
    if (!Array.isArray(expectedValue) || expectedValue.length !== 2) {
        return false;
    }

    const [lower, upper] = expectedValue as [unknown, unknown];
    return compareValues(actualValue, lower) >= 0 && compareValues(actualValue, upper) <= 0;
}

export function compareValues(left: unknown, right: unknown): number {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber)) {
        return leftNumber - rightNumber;
    }

    const leftDate = toTimestamp(left);
    const rightDate = toTimestamp(right);
    if (leftDate !== null && rightDate !== null) {
        return leftDate - rightDate;
    }

    return toComparableString(left).localeCompare(toComparableString(right));
}

export function toComparableString(value: unknown): string {
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

export function toTimestamp(value: unknown): number | null {
    if (typeof value !== "string" && typeof value !== "number") {
        return null;
    }

    const parsed = Date.parse(String(value));
    return Number.isNaN(parsed) ? null : parsed;
}

export function parseStringArray(value: unknown): string[] | undefined {
    const normalized = toUnknownArray(value)
        .filter((entry): entry is string => typeof entry === "string" && entry.length > 0);

    return normalized.length > 0 ? normalized : undefined;
}

export function parseSources(value: unknown): DockerKnownSource[] | undefined {
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
    const normalized = toUnknownArray(value)
        .filter((entry): entry is DockerKnownSource =>
            typeof entry === "string" && sourceSet.has(entry as DockerKnownSource),
        );

    return normalized.length > 0 ? normalized : undefined;
}

export function toUnknownArray(value: unknown): unknown[] {
    if (Array.isArray(value)) {
        return value;
    }

    if (typeof value !== "object" || value === null) {
        return [];
    }

    return Object.entries(isRecord(value) ? value : {})
        .sort(([leftKey], [rightKey]) => compareObjectKeys(leftKey, rightKey))
        .map(([, entryValue]) => entryValue);
}

export function compareObjectKeys(leftKey: string, rightKey: string): number {
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

export function parseTimestamp(value: string | undefined): number | null {
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

export function resolveRefreshInterval(input: number | undefined): number | null {
    if (typeof input !== "number" || !Number.isInteger(input)) {
        return null;
    }

    return Math.max(MIN_INSPECT_REFRESH_INTERVAL_MS, Math.min(MAX_INSPECT_REFRESH_INTERVAL_MS, input));
}

export function isNotFoundError(error: unknown): boolean {
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
