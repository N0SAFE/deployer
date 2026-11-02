/**
 * Merging container, image, network, volume and stack lists from many nodes into one universe: dedupe replicas by
 * fingerprint, group for the inventory, worst-status-wins merges, and the filter/sort/paginate rules. Pure.
 */
import { BadRequestError } from "@deployer/errors";
import { dockerContainerInspectDetailSchema, dockerNetworkSchema, dockerRegistrySchema, dockerRuntimeCatalogSchema, dockerStackSchema, dockerVolumeSchema, type DockerContainer, type DockerContainerInspectDetail, type DockerImage, type DockerNetwork, type DockerRegistry, type DockerRuntimeCatalog, type DockerStack, type DockerVolume } from "@deployer/contracts-entities";
import type { DockerContainerGroupedListItem, DockerContainerListInput } from "@deployer/runtime-contracts/modules/docker/containers/shared";
import { isRecord } from "@deployer/type-guards";

import { normalizeComparableValue, normalizeContainer, normalizeContainerGroupName, normalizeImage } from "./mesh-entity-normalization";
import { HEALTH_PRIORITY, STATUS_PRIORITY } from "./mesh-universe-types";

import type { DockerGroupedDaemonDiagnostics, DockerListResult, ParsedFilterEntry } from "./mesh-universe-types";
import type { DockerContainerInspectResponsePayload, DockerContainerListResponsePayload, DockerContainerListResult, DockerRuntimeCatalogResponsePayload } from "../mesh/node-mesh-types";

export function computeSharedDaemonDiagnostics(
    responses: DockerContainerListResponsePayload[],
): DockerGroupedDaemonDiagnostics {
    const nodesByDaemonId = new Map<string, Set<string>>();

    for (const response of responses) {
        const daemonId = response.responderDaemonId;
        const nodeId = response.responderNodeId;
        if (!daemonId || !nodeId) {
            continue;
        }

        const nodes = nodesByDaemonId.get(daemonId) ?? new Set<string>();
        nodes.add(nodeId);
        nodesByDaemonId.set(daemonId, nodes);
    }

    const sharedDaemonGroups = [...nodesByDaemonId.entries()]
        .map(([daemonId, nodeIds]) => ({
            daemonId,
            nodeIds: [...nodeIds].sort(),
        }))
        .filter((entry) => entry.nodeIds.length > 1)
        .sort((left, right) => right.nodeIds.length - left.nodeIds.length);

    return {
        hasSharedDaemonAcrossNodes: sharedDaemonGroups.length > 0,
        sharedDaemonGroups,
    };
}

export function groupContainersForInventory(containers: DockerContainer[]): DockerContainerGroupedListItem[] {
    const dedupedById = dedupeContainersById(containers);
    const groupedByKey = new Map<string, DockerContainer[]>();

    for (const container of dedupedById) {
        const key = buildContainerGroupKey(container);
        const existing = groupedByKey.get(key);
        if (!existing) {
            groupedByKey.set(key, [container]);
            continue;
        }

        existing.push(container);
    }

    const grouped: DockerContainerGroupedListItem[] = [];

    for (const [hash, items] of groupedByKey.entries()) {
        const normalizedInstances = dedupeReplicaInstancesByFingerprint(items);
        const instances = [...normalizedInstances].sort(
            (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt),
        );

        if (instances.length <= 1) {
            const [container] = instances;
            if (container) {
                grouped.push({
                    kind: "single",
                    hash,
                    container,
                });
            }
            continue;
        }

        grouped.push({
            kind: "replica_group",
            hash,
            containers: instances,
        });
    }

    return grouped.sort((left, right) => getGroupedItemUpdatedEpoch(right) - getGroupedItemUpdatedEpoch(left));
}

export function dedupeReplicaInstancesByFingerprint(containers: DockerContainer[]): DockerContainer[] {
    const dedupedByFingerprint = new Map<string, DockerContainer>();

    for (const container of containers) {
        const fingerprint = buildContainerRuntimeFingerprint(container);
        const existing = dedupedByFingerprint.get(fingerprint);

        if (!existing) {
            dedupedByFingerprint.set(fingerprint, container);
            continue;
        }

        const existingUpdatedAt = Date.parse(existing.updatedAt);
        const incomingUpdatedAt = Date.parse(container.updatedAt);
        const representative = incomingUpdatedAt >= existingUpdatedAt ? container : existing;

        dedupedByFingerprint.set(fingerprint, {
            ...representative,
            status: mergeContainerStatus(existing.status, container.status),
            health: mergeContainerHealth(existing.health, container.health),
        });
    }

    return [...dedupedByFingerprint.values()];
}

export function buildContainerRuntimeFingerprint(container: DockerContainer): string {
    const ports = [...container.ports]
        .map((port) => `${String(port.containerPort)}:${port.hostPort == null ? "-" : String(port.hostPort)}/${port.protocol}`)
        .sort()
        .join(",");

    const networks = [...container.networkIds].sort().join(",");
    const volumes = [...container.volumeIds].sort().join(",");

    return [
        container.name,
        container.managedDeploymentId ?? "",
        container.managedServiceId ?? container.serviceId,
        container.managedProjectId ?? container.projectId,
        container.managedImageRef ?? container.imageId ?? "",
        container.environment ?? "none",
        container.createdAt,
        container.startedAt ?? "",
        ports,
        networks,
        volumes,
    ].join("|");
}

export function getGroupedItemUpdatedEpoch(item: DockerContainerGroupedListItem): number {
    if (item.kind === "single") {
        return Date.parse(item.container.updatedAt) || 0;
    }

    return Math.max(
        ...item.containers.map((container) => Date.parse(container.updatedAt) || 0),
    );
}

export function dedupeContainersById(containers: DockerContainer[]): DockerContainer[] {
    const deduped = new Map<string, DockerContainer>();

    for (const container of containers) {
        const existing = deduped.get(container.id);
        if (!existing) {
            deduped.set(container.id, container);
            continue;
        }

        const existingUpdatedAt = Date.parse(existing.updatedAt);
        const incomingUpdatedAt = Date.parse(container.updatedAt);

        const representative = incomingUpdatedAt >= existingUpdatedAt ? container : existing;

        deduped.set(container.id, {
            ...representative,
            status: mergeContainerStatus(existing.status, container.status),
            health: mergeContainerHealth(existing.health, container.health),
        });
    }

    return [...deduped.values()];
}

export function mergeContainerStatus(
    current: DockerContainer["status"],
    incoming: DockerContainer["status"],
): DockerContainer["status"] {
    return STATUS_PRIORITY[incoming] > STATUS_PRIORITY[current] ? incoming : current;
}

export function mergeContainerHealth(
    current: DockerContainer["health"],
    incoming: DockerContainer["health"],
): DockerContainer["health"] {
    return HEALTH_PRIORITY[incoming] > HEALTH_PRIORITY[current] ? incoming : current;
}

export function isDeploymentReplicaContainer(container: DockerContainer): boolean {
    return (
        container.managedBy === "deployment_service"
        && Boolean(container.managedDeploymentId)
        && Boolean(container.managedServiceId)
    );
}

export function buildContainerGroupKey(container: DockerContainer): string {
    if (!isDeploymentReplicaContainer(container)) {
        return `single:${container.id}`;
    }

    const normalizedName = normalizeContainerGroupName(container.name);
    const portSignature = [...container.ports]
        .map((port) => `${String(port.containerPort)}/${port.protocol}`)
        .sort()
        .join(",");

    return [
        "deployment-replica",
        container.managedDeploymentId ?? "deployment-unknown",
        container.managedServiceId ?? container.serviceId,
        container.managedProjectId ?? container.projectId,
        normalizedName,
        container.managedImageRef ?? container.imageId ?? "",
        container.environment ?? "none",
        portSignature,
    ].join("|");
}

export function buildDaemonScopedContainerFingerprint(container: DockerContainer): string {
    const ports = [...container.ports]
        .map((port) => `${String(port.containerPort)}:${port.hostPort == null ? "-" : String(port.hostPort)}/${port.protocol}`)
        .sort()
        .join(",");

    const networks = [...container.networkIds].sort().join(",");

    return [
        container.name,
        container.managedBy,
        container.managedDeploymentId ?? "",
        container.managedServiceId ?? container.serviceId,
        container.managedProjectId ?? container.projectId,
        container.managedImageRef ?? container.imageId ?? "",
        container.environment ?? "none",
        ports,
        networks,
    ].join("|");
}

export function dedupeResponsesByResponder(
    responses: readonly DockerContainerListResponsePayload[],
): DockerContainerListResponsePayload[] {
    const deduped: DockerContainerListResponsePayload[] = [];
    const seenResponderIds = new Set<string>();

    for (const response of responses) {
        const responderNodeId = response.responderNodeId;
        if (!responderNodeId) {
            deduped.push(response);
            continue;
        }

        if (seenResponderIds.has(responderNodeId)) {
            continue;
        }

        seenResponderIds.add(responderNodeId);
        deduped.push(response);
    }

    return deduped;
}

export function isAbortLikeError(error: unknown): boolean {
    if (typeof error !== "object" || error === null) {
        return false;
    }

    const candidate = error as { name?: unknown; message?: unknown };
    const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
    const message = typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";

    return (
        name.includes("abort")
        || message.includes("aborted")
        || message.includes("operation was aborted")
    );
}

export function applyContainerFilters(items: DockerContainer[], input: DockerContainerListInput): DockerContainer[] {
    return items.filter((item) => {
        const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
        const statusMatch = matchEq(item.status, getFilterEntry(input, "status"));
        const projectMatch = matchEq(item.projectId, getFilterEntry(input, "projectId"));
        const serviceMatch = matchEq(item.serviceId, getFilterEntry(input, "serviceId"));
        const managedByMatch = matchEq(item.managedBy, getFilterEntry(input, "managedBy"));
        const managedDeploymentMatch = matchEq(
            item.managedDeploymentId ?? "",
            getFilterEntry(input, "managedDeploymentId"),
        );
        const managedServiceMatch = matchEq(
            item.managedServiceId ?? "",
            getFilterEntry(input, "managedServiceId"),
        );
        const managedProjectMatch = matchEq(
            item.managedProjectId ?? "",
            getFilterEntry(input, "managedProjectId"),
        );

        return (
            nameMatch
            && statusMatch
            && projectMatch
            && serviceMatch
            && managedByMatch
            && managedDeploymentMatch
            && managedServiceMatch
            && managedProjectMatch
        );
    });
}

export function mergeNetworksFromCatalog(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerNetwork[] {
    const merged = new Map<string, DockerNetwork>();

    for (const response of responses) {
        for (const item of response.catalog.networks) {
            const parsed = dockerNetworkSchema.safeParse(item);
            if (!parsed.success) {
                continue;
            }

            const network = parsed.data;
            const existing = merged.get(network.id);
            if (!existing || existing.updatedAt < network.updatedAt) {
                merged.set(network.id, network);
            }
        }
    }

    return [...merged.values()];
}

export function mergeVolumesFromCatalog(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerVolume[] {
    const merged = new Map<string, DockerVolume>();

    for (const response of responses) {
        for (const item of response.catalog.volumes) {
            const parsed = dockerVolumeSchema.safeParse(item);
            if (!parsed.success) {
                continue;
            }

            const volume = parsed.data;
            const existing = merged.get(volume.id);
            if (!existing || existing.updatedAt < volume.updatedAt) {
                merged.set(volume.id, volume);
            }
        }
    }

    return [...merged.values()];
}

export function mergeRegistriesFromCatalog(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerRegistry[] {
    const merged = new Map<string, DockerRegistry>();

    for (const response of responses) {
        for (const item of response.catalog.registries) {
            const parsed = dockerRegistrySchema.safeParse(item);
            if (!parsed.success) {
                continue;
            }

            const registry = parsed.data;
            const existing = merged.get(registry.id);

            if (!existing) {
                merged.set(registry.id, registry);
                continue;
            }

            const repositories = [...new Set([...existing.repositories, ...registry.repositories])].sort();
            const existingLastSyncedAt = existing.lastSyncedAt ?? "";
            const incomingLastSyncedAt = registry.lastSyncedAt ?? "";
            const mergedRegistry = dockerRegistrySchema.parse({
                ...existing,
                repositories,
                status: existing.status === "healthy" || registry.status === "healthy" ? "healthy" : registry.status,
                isPrimary: existing.isPrimary || registry.isPrimary,
                lastSyncedAt: existingLastSyncedAt >= incomingLastSyncedAt
                    ? existing.lastSyncedAt
                    : registry.lastSyncedAt,
                updatedAt: existing.updatedAt > registry.updatedAt ? existing.updatedAt : registry.updatedAt,
            });

            merged.set(registry.id, mergedRegistry);
        }
    }

    return [...merged.values()];
}

export function mergeStacksFromCatalog(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerStack[] {
    const merged = new Map<string, DockerStack>();

    for (const response of responses) {
        for (const item of response.catalog.stacks) {
            const parsed = dockerStackSchema.safeParse(item);
            if (!parsed.success) {
                continue;
            }

            const stack = parsed.data;
            const existing = merged.get(stack.id);
            if (!existing || existing.updatedAt < stack.updatedAt) {
                merged.set(stack.id, stack);
            }
        }
    }

    return [...merged.values()];
}

export function pickBestInspectDetail(responses: readonly DockerContainerInspectResponsePayload[]): DockerContainerInspectDetail {
    const sorted = [...responses].sort((left, right) => {
        const leftEpoch = Date.parse(left.detail.generatedAt);
        const rightEpoch = Date.parse(right.detail.generatedAt);

        if (Number.isNaN(leftEpoch) && Number.isNaN(rightEpoch)) return 0;
        if (Number.isNaN(leftEpoch)) return 1;
        if (Number.isNaN(rightEpoch)) return -1;

        return rightEpoch - leftEpoch;
    });

    const first = sorted[0];
    if (!first) {
        throw new BadRequestError("No inspect response returned from mesh");
    }

    return dockerContainerInspectDetailSchema.parse(first.detail);
}

export function getFilterEntry(input: { filter?: unknown }, key: string): ParsedFilterEntry | undefined {
    if (!input.filter || typeof input.filter !== "object") {
        return undefined;
    }

    const rawEntry = Reflect.get(isRecord(input.filter) ? input.filter : {}, "key");
    if (!rawEntry || typeof rawEntry !== "object") {
        return undefined;
    }

    const operator = (rawEntry as { operator?: unknown }).operator;
    if (typeof operator !== "string") {
        return undefined;
    }

    return {
        operator,
        value: (rawEntry as { value?: unknown }).value,
    };
}

export function matchString(value: string, entry: ParsedFilterEntry | undefined): boolean {
    if (!entry) return true;
    const target = String(entry.value ?? "");

    switch (entry.operator) {
        case "eq":
            return value === target;
        case "like":
        case "ilike":
            return value.toLowerCase().includes(target.toLowerCase());
        default:
            return true;
    }
}

export function matchEq(value: string | boolean, entry: ParsedFilterEntry | undefined): boolean {
    if (!entry) return true;
    if (entry.operator !== "eq") return true;

    if (typeof value === "boolean") {
        const expected = typeof entry.value === "boolean"
            ? entry.value
            : String(entry.value).toLowerCase() === "true";
        return value === expected;
    }

    return value === String(entry.value ?? "");
}

export function sortItems<T>(
    items: T[],
    sortBy: string | undefined,
    sortDirection: "asc" | "desc" | undefined,
    getComparableValue: (item: T, sortBy: string) => string | number | boolean | null | undefined,
): T[] {
    const key = sortBy ?? "updatedAt";
    const direction = sortDirection === "asc" ? 1 : -1;

    return [...items].sort((left, right) => {
        const leftValue = normalizeComparableValue(getComparableValue(left, key));
        const rightValue = normalizeComparableValue(getComparableValue(right, key));

        if (leftValue < rightValue) return -1 * direction;
        if (leftValue > rightValue) return 1 * direction;
        return 0;
    });
}

export function sortContainers(
    items: DockerContainer[],
    sortBy: string | undefined,
    sortDirection: "asc" | "desc" | undefined,
): DockerContainer[] {
    return sortItems(items, sortBy, sortDirection, (item, key) => resolveComparableValue(item, key));
}

export function resolveComparableValue(item: DockerContainer, sortBy: string): string | number {
    switch (sortBy) {
        case "name":
            return item.name;
        case "status":
            return item.status;
        case "createdAt":
            return item.createdAt;
        case "updatedAt":
        default:
            return item.updatedAt;
    }
}

export function paginate(items: DockerContainer[], limit: number, offset: number): DockerContainerListResult {
    return paginateList(items, limit, offset);
}

export function paginateList<T>(items: T[], limit: number, offset: number): DockerListResult<T> {
    const total = items.length;

    return {
        data: items.slice(offset, offset + limit),
        meta: {
            total,
            limit,
            offset,
            hasMore: offset + limit < total,
        },
    };
}

export function mergeRuntimeCatalogResponses(
    responses: readonly DockerRuntimeCatalogResponsePayload[],
    warn: (message: string) => void = () => undefined,
): DockerRuntimeCatalog {
    const containers = mergeContainersFromCatalog(responses, warn);
    const images = mergeImagesFromCatalog(responses, warn);
    const networks = mergeNetworksFromCatalog(responses);
    const volumes = mergeVolumesFromCatalog(responses);
    const registries = mergeRegistriesFromCatalog(responses);
    const stacks = mergeStacksFromCatalog(responses);

    return dockerRuntimeCatalogSchema.parse({
        containers,
        images,
        networks,
        volumes,
        registries,
        stacks,
    });
}

export function mergeContainersFromCatalog(
    responses: readonly DockerRuntimeCatalogResponsePayload[],
    warn: (message: string) => void = () => undefined,
): DockerContainer[] {
    const merged = new Map<string, DockerContainer>();

    for (const response of responses) {
        for (const item of response.catalog.containers) {
            const normalized = normalizeContainer(item, warn);
            if (!normalized) {
                continue;
            }

            const existing = merged.get(normalized.id);
            if (!existing || existing.updatedAt < normalized.updatedAt) {
                merged.set(normalized.id, normalized);
            }
        }
    }

    return [...merged.values()];
}

export function mergeImagesFromCatalog(
    responses: readonly DockerRuntimeCatalogResponsePayload[],
    warn: (message: string) => void = () => undefined,
): DockerImage[] {
    const merged = new Map<string, DockerImage>();

    for (const response of responses) {
        for (const item of response.catalog.images) {
            const image = normalizeImage(item, warn);
            if (!image) {
                continue;
            }

            const existing = merged.get(image.id);
            if (!existing || existing.lastSeenAt < image.lastSeenAt) {
                merged.set(image.id, image);
            }
        }
    }

    return [...merged.values()];
}
