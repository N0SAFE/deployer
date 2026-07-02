import { Injectable, Logger } from "@nestjs/common";
import { BadRequestError } from "@/core/errors/app-error";
import { createHash } from "node:crypto";
import type {
    DockerContainerGroupedListInput,
    DockerContainerGroupedListItem,
    DockerContainerGroupedListResult,
    DockerContainerListInput,
} from "@repo/api-contracts/modules/docker/containers/shared";
import type {
    DockerImageListInput,
} from "@repo/api-contracts/modules/docker/images/list";
import type {
    DockerNetworkListInput,
} from "@repo/api-contracts/modules/docker/networks/list";
import type {
    DockerRegistryListInput,
} from "@repo/api-contracts/modules/docker/registries/list";
import type {
    DockerStackListInput,
} from "@repo/api-contracts/modules/docker/stacks/list";
import type {
    DockerVolumeListInput,
} from "@repo/api-contracts/modules/docker/volumes/list";
import {
    dockerContainerInspectDetailSchema,
    dockerContainerSchema,
    dockerImageSchema,
    dockerNetworkSchema,
    dockerRegistrySchema,
    dockerRuntimeCatalogSchema,
    dockerStackSchema,
    dockerVolumeSchema,
    type DockerContainer,
    type DockerContainerInspectDetail,
    type DockerImage,
    type DockerNetwork,
    type DockerRegistry,
    type DockerRuntimeCatalog,
    type DockerStack,
    type DockerVolume,
} from "@repo/contracts-entities";
import { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { MeshInternalRequestService } from "@/core/modules/mesh/services/mesh-internal-request.service";
import { DockerRepository } from "../../../repositories/facade/docker.repository";
import type {
    DockerContainerInspectRequestPayload,
    DockerContainerInspectResponsePayload,
    DockerContainerListRequestPayload,
    DockerContainerListResponsePayload,
    DockerContainerListResult,
    DockerRuntimeCatalogResponsePayload,
} from "../mesh/docker-container-mesh.service";
import { DockerContainerMeshService } from "../mesh/docker-container-mesh.service";
import { isRecord, isObjectLike } from "@repo/type-guards"

const MESH_FANOUT_LIMIT = 500;
const PEER_FALLBACK_TIMEOUT_MS = 1_750;
const PEER_FALLBACK_RETRY_TIMEOUT_MS = 2_750;
const DEPLOYMENT_ENVIRONMENTS = new Set(["production", "staging", "preview", "development"] as const);

const STATUS_PRIORITY: Record<DockerContainer["status"], number> = {
    dead: 6,
    exited: 5,
    restarting: 4,
    paused: 3,
    created: 2,
    unknown: 1,
    running: 0,
};

const HEALTH_PRIORITY: Record<DockerContainer["health"], number> = {
    unhealthy: 3,
    starting: 2,
    none: 1,
    healthy: 0,
};

interface ParsedFilterEntry {
    operator: string;
    value: unknown;
}

interface DockerListMeta {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
}

interface DockerListResult<T> {
    data: T[];
    meta: DockerListMeta;
}

interface DockerGroupedDaemonDiagnostics {
    hasSharedDaemonAcrossNodes: boolean;
    sharedDaemonGroups: {
        daemonId: string;
        nodeIds: string[];
    }[];
}

interface DockerContainerResolutionOptions {
    localOnly?: boolean;
}

interface MeshPeerSessionSummary {
    peerNodeId: string;
    endpointUrl: string;
    metadata: unknown;
}

type PeerFallbackAttemptStatus = "ok" | "aborted" | "httpFailure" | "networkFailure";

interface PeerFallbackAttemptResult {
    peer: MeshPeerSessionSummary;
    status: PeerFallbackAttemptStatus;
    response?: DockerContainerListResponsePayload;
}



@Injectable()
export class DockerContainerResolutionService {
    private readonly logger = new Logger(DockerContainerResolutionService.name);

    constructor(
        private readonly dockerContainerMeshService: DockerContainerMeshService,
        private readonly dockerRepository: DockerRepository,
        private readonly systemMeshTopologyService: SystemMeshTopologyService,
        private readonly meshInternalRequestService: MeshInternalRequestService,
    ) {}

    async listContainers(
        input: DockerContainerListInput,
        options?: DockerContainerResolutionOptions,
    ): Promise<DockerContainerListResult> {
        if (options?.localOnly) {
            this.logger.debug("Bypassing mesh fanout for local-only docker container list request");
            return await this.dockerRepository.listContainers(input);
        }

        const meshPayload: DockerContainerListRequestPayload = {
            query: {
                ...input,
                limit: MESH_FANOUT_LIMIT,
                offset: 0,
            },
        };

        try {
            const meshResult = await this.dockerContainerMeshService.listContainersAcrossInstances(meshPayload, {
                timeoutMs: 1_500,
                maxCollectedResponses: 128,
            });

            const meshResponses = this.dedupeResponsesByResponder(meshResult.responses);
            const missingMeshResponders = Math.max(0, meshResult.metrics.expectedResponders - meshResponses.length);

            let resolvedResponses = meshResponses;
            let peerFallbackResponses: DockerContainerListResponsePayload[] = [];

            if (missingMeshResponders > 0) {
                peerFallbackResponses = await this.collectPeerFallbackContainerResponses();
                if (peerFallbackResponses.length > 0) {
                    resolvedResponses = this.dedupeResponsesByResponder([...meshResponses, ...peerFallbackResponses]);
                }
            }

            this.logger.debug(
                [
                    `Mesh listContainers call metrics: responses=${String(meshResult.responses.length)}`,
                    `combinedResponses=${String(resolvedResponses.length)}`,
                    `expected=${String(meshResult.metrics.expectedResponders)}`,
                    `received=${String(meshResult.metrics.receivedResponses)}`,
                    `timedOut=${String(meshResult.metrics.timedOut)}`,
                    `stoppedEarly=${String(meshResult.stoppedEarly)}`,
                    `reason=${meshResult.reason}`,
                    `fallbackResponses=${String(peerFallbackResponses.length)}`,
                    `payloadSizes=[${resolvedResponses.map((response) => String(response.data.length)).join(",")}]`,
                ].join(" | "),
            );

            if (resolvedResponses.length === 0) {
                return await this.dockerRepository.listContainers(input);
            }

            const merged = this.mergeMeshResponses(resolvedResponses);
            const filtered = this.applyContainerFilters(merged, input);
            const sorted = this.sortContainers(filtered, input.sortBy, input.sortDirection);
            const paginated = this.paginate(sorted, input.limit, input.offset);

            this.logger.debug(
                [
                    `Mesh listContainers merge result: merged=${String(merged.length)}`,
                    `filtered=${String(filtered.length)}`,
                    `sorted=${String(sorted.length)}`,
                    `pageSize=${String(paginated.data.length)}`,
                    `dedupedById=${String(merged.length - new Set(merged.map((container) => container.id)).size)}`,
                ].join(" | "),
            );

            return paginated;
        } catch (error) {
            this.logger.warn(
                `Mesh container resolution failed (${this.formatError(error)}). Falling back to local repository`,
            );
            return await this.dockerRepository.listContainers(input);
        }
    }

    async listContainersGrouped(
        input: DockerContainerGroupedListInput,
        options?: DockerContainerResolutionOptions,
    ): Promise<DockerContainerGroupedListResult> {
        const universe = await this.resolveContainerUniverse(input, options);
        const sorted = universe.containers;
        const grouped = this.groupContainersForInventory(sorted);
        const diagnostics = universe.diagnostics;

        const paginated = this.paginateList(grouped, input.limit, input.offset);

        return {
            ...paginated,
            diagnostics,
        };
    }

    async inspectContainer(containerId: string): Promise<DockerContainerInspectDetail> {
        let localInspectError!: Error;

        try {
            return await this.dockerRepository.inspectContainer(containerId);
        } catch (error) {
            localInspectError = this.toError(error);
        }

        const meshPayload: DockerContainerInspectRequestPayload = {
            query: {
                containerId,
            },
        };

        try {
            const meshResult = await this.dockerContainerMeshService.inspectContainerAcrossInstances(meshPayload, {
                timeoutMs: 1_500,
                maxCollectedResponses: 16,
            });

            if (meshResult.responses.length > 0) {
                return this.pickBestInspectDetail(meshResult.responses);
            }

            throw localInspectError;
        } catch (error) {
            if (error === localInspectError) {
                throw localInspectError;
            }

            this.logger.warn(
                `Mesh container inspect resolution failed (${this.formatError(error)}). Falling back to local repository`,
            );

            throw localInspectError;
        }
    }

    async listImages(input: DockerImageListInput): Promise<DockerListResult<DockerImage>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.images.filter((item) => {
            const registryMatch = this.matchString(item.registry, this.getFilterEntry(input, "registry"));
            const repositoryMatch = this.matchString(item.repository, this.getFilterEntry(input, "repository"));
            const tagMatch = this.matchString(item.tag ?? "", this.getFilterEntry(input, "tag"));
            return registryMatch && repositoryMatch && tagMatch;
        });

        const sorted = this.sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
            switch (sortBy) {
                case "createdAt":
                    return item.createdAt;
                case "registry":
                    return item.registry;
                case "repository":
                    return item.repository;
                case "lastSeenAt":
                default:
                    return item.lastSeenAt;
            }
        });

        return this.paginateList(sorted, input.limit, input.offset);
    }

    async listNetworks(input: DockerNetworkListInput): Promise<DockerListResult<DockerNetwork>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.networks.filter((item) => {
            const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
            const driverMatch = this.matchEq(item.driver, this.getFilterEntry(input, "driver"));
            const scopeMatch = this.matchEq(item.scope, this.getFilterEntry(input, "scope"));
            return nameMatch && driverMatch && scopeMatch;
        });

        const sorted = this.sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
            switch (sortBy) {
                case "name":
                    return item.name;
                case "createdAt":
                    return item.createdAt;
                case "updatedAt":
                default:
                    return item.updatedAt;
            }
        });

        return this.paginateList(sorted, input.limit, input.offset);
    }

    async listVolumes(input: DockerVolumeListInput): Promise<DockerListResult<DockerVolume>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.volumes.filter((item) => {
            const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
            const driverMatch = this.matchEq(item.driver, this.getFilterEntry(input, "driver"));
            return nameMatch && driverMatch;
        });

        const sorted = this.sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
            switch (sortBy) {
                case "name":
                    return item.name;
                case "createdAt":
                    return item.createdAt;
                case "updatedAt":
                default:
                    return item.updatedAt;
            }
        });

        return this.paginateList(sorted, input.limit, input.offset);
    }

    async listRegistries(input: DockerRegistryListInput): Promise<DockerListResult<DockerRegistry>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.registries.filter((item) => {
            const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
            const statusMatch = this.matchEq(item.status, this.getFilterEntry(input, "status"));
            const primaryMatch = this.matchEq(item.isPrimary, this.getFilterEntry(input, "isPrimary"));
            return nameMatch && statusMatch && primaryMatch;
        });

        const sorted = this.sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
            switch (sortBy) {
                case "name":
                    return item.name;
                case "url":
                    return item.url;
                case "createdAt":
                    return item.createdAt;
                case "updatedAt":
                default:
                    return item.updatedAt;
            }
        });

        return this.paginateList(sorted, input.limit, input.offset);
    }

    async listStacks(input: DockerStackListInput): Promise<DockerListResult<DockerStack>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.stacks.filter((item) => {
            const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
            const statusMatch = this.matchEq(item.status, this.getFilterEntry(input, "status"));
            const projectMatch = this.matchEq(item.projectId, this.getFilterEntry(input, "projectId"));
            return nameMatch && statusMatch && projectMatch;
        });

        const sorted = this.sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
            switch (sortBy) {
                case "name":
                    return item.name;
                case "projectId":
                    return item.projectId;
                case "createdAt":
                    return item.createdAt;
                case "updatedAt":
                default:
                    return item.updatedAt;
            }
        });

        return this.paginateList(sorted, input.limit, input.offset);
    }

    async getRuntimeCatalogSnapshot(): Promise<DockerRuntimeCatalog> {
        return await this.resolveRuntimeCatalog();
    }

    private async resolveContainerUniverse(
        input: DockerContainerListInput,
        options?: DockerContainerResolutionOptions,
    ): Promise<{ containers: DockerContainer[]; diagnostics: DockerGroupedDaemonDiagnostics }> {
        const fullScanInput: DockerContainerListInput = {
            ...input,
            limit: MESH_FANOUT_LIMIT,
            offset: 0,
        };

        if (options?.localOnly) {
            this.logger.debug("Bypassing mesh fanout for local-only docker container list request");
            const localResult = await this.dockerRepository.listContainers(fullScanInput);
            const sortedLocal = this.sortContainers(localResult.data, input.sortBy, input.sortDirection);
            return {
                containers: sortedLocal,
                diagnostics: {
                    hasSharedDaemonAcrossNodes: false,
                    sharedDaemonGroups: [],
                },
            };
        }

        const meshPayload: DockerContainerListRequestPayload = {
            query: fullScanInput,
        };

        try {
            const meshResult = await this.dockerContainerMeshService.listContainersAcrossInstances(meshPayload, {
                timeoutMs: 1_500,
                maxCollectedResponses: 128,
            });

            const meshResponses = this.dedupeResponsesByResponder(meshResult.responses);
            const missingMeshResponders = Math.max(0, meshResult.metrics.expectedResponders - meshResponses.length);

            let resolvedResponses = meshResponses;
            let peerFallbackResponses: DockerContainerListResponsePayload[] = [];

            if (missingMeshResponders > 0) {
                peerFallbackResponses = await this.collectPeerFallbackContainerResponses();
                if (peerFallbackResponses.length > 0) {
                    resolvedResponses = this.dedupeResponsesByResponder([...meshResponses, ...peerFallbackResponses]);
                }
            }

            this.logger.debug(
                [
                    `Mesh listContainers call metrics: responses=${String(meshResult.responses.length)}`,
                    `combinedResponses=${String(resolvedResponses.length)}`,
                    `expected=${String(meshResult.metrics.expectedResponders)}`,
                    `received=${String(meshResult.metrics.receivedResponses)}`,
                    `timedOut=${String(meshResult.metrics.timedOut)}`,
                    `stoppedEarly=${String(meshResult.stoppedEarly)}`,
                    `reason=${meshResult.reason}`,
                    `fallbackResponses=${String(peerFallbackResponses.length)}`,
                    `payloadSizes=[${resolvedResponses.map((response) => String(response.data.length)).join(",")}]`,
                ].join(" | "),
            );

            if (resolvedResponses.length === 0) {
                const localResult = await this.dockerRepository.listContainers(fullScanInput);
                const sortedLocal = this.sortContainers(localResult.data, input.sortBy, input.sortDirection);
                return {
                    containers: sortedLocal,
                    diagnostics: {
                        hasSharedDaemonAcrossNodes: false,
                        sharedDaemonGroups: [],
                    },
                };
            }

            const merged = this.mergeMeshResponses(resolvedResponses);
            const filtered = this.applyContainerFilters(merged, fullScanInput);
            const sorted = this.sortContainers(filtered, input.sortBy, input.sortDirection);
            const diagnostics = this.computeSharedDaemonDiagnostics(resolvedResponses);

            this.logger.debug(
                [
                    `Mesh listContainers merge result: merged=${String(merged.length)}`,
                    `filtered=${String(filtered.length)}`,
                    `sorted=${String(sorted.length)}`,
                    `dedupedById=${String(merged.length - new Set(merged.map((container) => container.id)).size)}`,
                ].join(" | "),
            );

            return {
                containers: sorted,
                diagnostics,
            };
        } catch (error) {
            this.logger.warn(
                `Mesh container resolution failed (${this.formatError(error)}). Falling back to local repository`,
            );

            const localResult = await this.dockerRepository.listContainers(fullScanInput);
            const sortedLocal = this.sortContainers(localResult.data, input.sortBy, input.sortDirection);
            return {
                containers: sortedLocal,
                diagnostics: {
                    hasSharedDaemonAcrossNodes: false,
                    sharedDaemonGroups: [],
                },
            };
        }
    }

    private computeSharedDaemonDiagnostics(
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

    private groupContainersForInventory(containers: DockerContainer[]): DockerContainerGroupedListItem[] {
        const dedupedById = this.dedupeContainersById(containers);
        const groupedByKey = new Map<string, DockerContainer[]>();

        for (const container of dedupedById) {
            const key = this.buildContainerGroupKey(container);
            const existing = groupedByKey.get(key);
            if (!existing) {
                groupedByKey.set(key, [container]);
                continue;
            }

            existing.push(container);
        }

        const grouped: DockerContainerGroupedListItem[] = [];

        for (const [hash, items] of groupedByKey.entries()) {
            const normalizedInstances = this.dedupeReplicaInstancesByFingerprint(items);
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

        return grouped.sort((left, right) => this.getGroupedItemUpdatedEpoch(right) - this.getGroupedItemUpdatedEpoch(left));
    }

    private dedupeReplicaInstancesByFingerprint(containers: DockerContainer[]): DockerContainer[] {
        const dedupedByFingerprint = new Map<string, DockerContainer>();

        for (const container of containers) {
            const fingerprint = this.buildContainerRuntimeFingerprint(container);
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
                status: this.mergeContainerStatus(existing.status, container.status),
                health: this.mergeContainerHealth(existing.health, container.health),
            });
        }

        return [...dedupedByFingerprint.values()];
    }

    private buildContainerRuntimeFingerprint(container: DockerContainer): string {
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

    private getGroupedItemUpdatedEpoch(item: DockerContainerGroupedListItem): number {
        if (item.kind === "single") {
            return Date.parse(item.container.updatedAt) || 0;
        }

        return Math.max(
            ...item.containers.map((container) => Date.parse(container.updatedAt) || 0),
        );
    }

    private dedupeContainersById(containers: DockerContainer[]): DockerContainer[] {
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
                status: this.mergeContainerStatus(existing.status, container.status),
                health: this.mergeContainerHealth(existing.health, container.health),
            });
        }

        return [...deduped.values()];
    }

    private mergeContainerStatus(
        current: DockerContainer["status"],
        incoming: DockerContainer["status"],
    ): DockerContainer["status"] {
        return STATUS_PRIORITY[incoming] > STATUS_PRIORITY[current] ? incoming : current;
    }

    private mergeContainerHealth(
        current: DockerContainer["health"],
        incoming: DockerContainer["health"],
    ): DockerContainer["health"] {
        return HEALTH_PRIORITY[incoming] > HEALTH_PRIORITY[current] ? incoming : current;
    }

    private isDeploymentReplicaContainer(container: DockerContainer): boolean {
        return (
            container.managedBy === "deployment_service"
            && Boolean(container.managedDeploymentId)
            && Boolean(container.managedServiceId)
        );
    }

    private normalizeContainerGroupName(name: string): string {
        return name.replace(/([._-])\d+$/, "");
    }

    private buildContainerGroupKey(container: DockerContainer): string {
        if (!this.isDeploymentReplicaContainer(container)) {
            return `single:${container.id}`;
        }

        const normalizedName = this.normalizeContainerGroupName(container.name);
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

    private mergeMeshResponses(responses: DockerContainerListResponsePayload[]): DockerContainer[] {
        const dedupedByDaemonFingerprint = new Map<string, DockerContainer>();

        for (const response of responses) {
            const sourceScope = response.responderDaemonId
                ? `daemon:${response.responderDaemonId}`
                : `node:${response.responderNodeId ?? "unknown"}`;

            for (const item of response.data) {
                const normalized = this.normalizeContainer(item);
                if (!normalized) {
                    this.logger.warn("Dropping invalid docker container from mesh response after normalization");
                    continue;
                }

                const dedupeFingerprint = this.buildDaemonScopedContainerFingerprint(normalized);
                const dedupeKey = `${sourceScope}|${dedupeFingerprint}`;
                const existing = dedupedByDaemonFingerprint.get(dedupeKey);

                if (!existing) {
                    dedupedByDaemonFingerprint.set(dedupeKey, normalized);
                    continue;
                }

                const existingUpdatedAt = Date.parse(existing.updatedAt);
                const incomingUpdatedAt = Date.parse(normalized.updatedAt);
                const representative = incomingUpdatedAt >= existingUpdatedAt ? normalized : existing;

                dedupedByDaemonFingerprint.set(dedupeKey, {
                    ...representative,
                    status: this.mergeContainerStatus(existing.status, normalized.status),
                    health: this.mergeContainerHealth(existing.health, normalized.health),
                });
            }
        }

        return [...dedupedByDaemonFingerprint.values()];
    }

    private buildDaemonScopedContainerFingerprint(container: DockerContainer): string {
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

    private dedupeResponsesByResponder(
        responses: DockerContainerListResponsePayload[],
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

    private async collectPeerFallbackContainerResponses(): Promise<DockerContainerListResponsePayload[]> {
        const devAuthKey = process.env.DEV_AUTH_KEY?.trim();
        if (!devAuthKey) {
            return [];
        }

        const connectedPeerSessions = this.systemMeshTopologyService
            .listPeerSessions()
            .items
            .filter((session) => session.state === "connected" && typeof session.peerNodeId === "string");

        const uniquePeers = new Map<string, MeshPeerSessionSummary>();

        for (const session of connectedPeerSessions) {
            const peerNodeId = session.peerNodeId;
            if (!peerNodeId) {
                continue;
            }

            if (uniquePeers.has(peerNodeId)) {
                continue;
            }

            uniquePeers.set(peerNodeId, {
                peerNodeId,
                endpointUrl: session.endpointUrl,
                metadata: session.metadata,
            });
        }

        if (uniquePeers.size === 0) {
            return [];
        }

        const initialAttemptResults = await Promise.all(
            [...uniquePeers.values()].map((peer) =>
                this.fetchPeerFallbackContainers(peer, devAuthKey, PEER_FALLBACK_TIMEOUT_MS),
            ),
        );

        const retryPeers = initialAttemptResults
            .filter((result) => result.status !== "ok")
            .map((result) => result.peer);

        let retryAttemptResults: PeerFallbackAttemptResult[] = [];
        if (retryPeers.length > 0) {
            retryAttemptResults = await Promise.all(
                retryPeers.map((peer) =>
                    this.fetchPeerFallbackContainers(peer, devAuthKey, PEER_FALLBACK_RETRY_TIMEOUT_MS),
                ),
            );
        }

        const successfulByPeer = new Map<string, DockerContainerListResponsePayload>();
        for (const result of initialAttemptResults) {
            if (result.status === "ok" && result.response) {
                successfulByPeer.set(result.peer.peerNodeId, result.response);
            }
        }

        for (const result of retryAttemptResults) {
            if (result.status === "ok" && result.response) {
                successfulByPeer.set(result.peer.peerNodeId, result.response);
            }
        }

        const failedResultByPeer = new Map<string, PeerFallbackAttemptResult>();
        for (const result of initialAttemptResults) {
            if (result.status !== "ok") {
                failedResultByPeer.set(result.peer.peerNodeId, result);
            }
        }
        for (const result of retryAttemptResults) {
            failedResultByPeer.set(result.peer.peerNodeId, result);
        }

        const responses = [...successfulByPeer.values()];
        const failures = [...failedResultByPeer.values()].filter((result) => result.status !== "ok");
        const abortedCount = failures.filter((result) => result.status === "aborted").length;
        const httpFailureCount = failures.filter((result) => result.status === "httpFailure").length;
        const networkFailureCount = failures.filter((result) => result.status === "networkFailure").length;

        if (abortedCount > 0 || httpFailureCount > 0 || networkFailureCount > 0 || retryPeers.length > 0) {
            this.logger.debug(
                [
                    `Peer fallback summary: peers=${String(uniquePeers.size)}`,
                    `ok=${String(responses.length)}`,
                    `aborted=${String(abortedCount)}`,
                    `httpFailures=${String(httpFailureCount)}`,
                    `networkFailures=${String(networkFailureCount)}`,
                    `retried=${String(retryPeers.length)}`,
                    `retryRecovered=${String(retryAttemptResults.filter((result) => result.status === "ok").length)}`,
                ].join(" | "),
            );
        }

        return responses;
    }

    private async fetchPeerFallbackContainers(
        peer: MeshPeerSessionSummary,
        devAuthKey: string,
        timeoutMs: number,
    ): Promise<PeerFallbackAttemptResult> {
        const peerBaseUrl = this.resolvePeerBaseUrl(peer.endpointUrl, peer.metadata);
        if (!peerBaseUrl) {
            return {
                peer,
                status: "networkFailure",
            };
        }

        const internalHeaders = this.meshInternalRequestService.buildInternalHeaders({
            includeLocalOnly: true,
        });

        const requestUrl = new URL("/docker", peerBaseUrl);
        requestUrl.search = new URLSearchParams({
            "query[limit]": String(MESH_FANOUT_LIMIT),
            "query[offset]": "0",
        }).toString();

        const controller = new AbortController();
        const timeout = setTimeout(() => {
            controller.abort();
        }, timeoutMs);

        try {
            const response = await fetch(requestUrl, {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${devAuthKey}`,
                    ...internalHeaders,
                },
                signal: controller.signal,
            });

            if (!response.ok) {
                return {
                    peer,
                    status: "httpFailure",
                };
            }

            const payload = (await response.json());
            const containers = this.extractContainersFromPeerPayload(payload);
            if (containers.length === 0) {
                return {
                    peer,
                    status: "ok",
                };
            }

            const fallbackResponse: DockerContainerListResponsePayload = {
                data: containers,
                meta: {
                    total: containers.length,
                    limit: Math.max(1, containers.length),
                    offset: 0,
                    hasMore: false,
                },
                responderNodeId: peer.peerNodeId,
                responderDaemonId: null,
            };

            return {
                peer,
                status: "ok",
                response: fallbackResponse,
            };
        } catch (error) {
            if (this.isAbortLikeError(error)) {
                return {
                    peer,
                    status: "aborted",
                };
            }

            this.logger.debug(
                `Peer fallback request failed for '${peer.peerNodeId}': ${this.formatError(error)}`,
            );

            return {
                peer,
                status: "networkFailure",
            };
        } finally {
            clearTimeout(timeout);
        }
    }

    private isAbortLikeError(error: unknown): boolean {
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

    private extractContainersFromPeerPayload(payload: unknown): DockerContainer[] {
        if (!payload || typeof payload !== "object") {
            return [];
        }

        const data = (payload as { data?: unknown }).data;
        if (!Array.isArray(data)) {
            return [];
        }

        const containers: DockerContainer[] = [];
        for (const entry of data) {
            const normalized = this.normalizeContainer(entry);
            if (normalized) {
                containers.push(normalized);
            }
        }

        return containers;
    }

    private resolvePeerBaseUrl(endpointUrl: string, metadata: unknown): string | null {
        const metadataServerUrl =
            metadata && typeof metadata === "object"
                ? (metadata as { serverUrl?: unknown }).serverUrl
                : null;

        if (typeof metadataServerUrl === "string" && metadataServerUrl.trim().length > 0) {
            try {
                return new URL(metadataServerUrl).origin;
            } catch {
                return null;
            }
        }

        if (typeof endpointUrl !== "string" || endpointUrl.trim().length === 0) {
            return null;
        }

        try {
            const parsed = new URL(endpointUrl);
            const protocol = parsed.protocol === "wss:" ? "https:" : "http:";
            return `${protocol}//${parsed.host}`;
        } catch {
            return null;
        }
    }

    private applyContainerFilters(items: DockerContainer[], input: DockerContainerListInput): DockerContainer[] {
        return items.filter((item) => {
            const nameMatch = this.matchString(item.name, this.getFilterEntry(input, "name"));
            const statusMatch = this.matchEq(item.status, this.getFilterEntry(input, "status"));
            const projectMatch = this.matchEq(item.projectId, this.getFilterEntry(input, "projectId"));
            const serviceMatch = this.matchEq(item.serviceId, this.getFilterEntry(input, "serviceId"));
            const managedByMatch = this.matchEq(item.managedBy, this.getFilterEntry(input, "managedBy"));
            const managedDeploymentMatch = this.matchEq(
                item.managedDeploymentId ?? "",
                this.getFilterEntry(input, "managedDeploymentId"),
            );
            const managedServiceMatch = this.matchEq(
                item.managedServiceId ?? "",
                this.getFilterEntry(input, "managedServiceId"),
            );
            const managedProjectMatch = this.matchEq(
                item.managedProjectId ?? "",
                this.getFilterEntry(input, "managedProjectId"),
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

    private async resolveRuntimeCatalog(): Promise<DockerRuntimeCatalog> {
        try {
            const meshResult = await this.dockerContainerMeshService.listRuntimeCatalogAcrossInstances({}, {
                timeoutMs: 2_000,
                maxCollectedResponses: 128,
            });

            if (meshResult.responses.length === 0) {
                return await this.dockerRepository.getRuntimeCatalogSnapshot();
            }

            return this.mergeRuntimeCatalogResponses(meshResult.responses);
        } catch (error) {
            this.logger.warn(
                `Mesh runtime catalog resolution failed (${this.formatError(error)}). Falling back to local repository`,
            );
            return await this.dockerRepository.getRuntimeCatalogSnapshot();
        }
    }

    private mergeRuntimeCatalogResponses(responses: DockerRuntimeCatalogResponsePayload[]): DockerRuntimeCatalog {
        const containers = this.mergeContainersFromCatalog(responses);
        const images = this.mergeImagesFromCatalog(responses);
        const networks = this.mergeNetworksFromCatalog(responses);
        const volumes = this.mergeVolumesFromCatalog(responses);
        const registries = this.mergeRegistriesFromCatalog(responses);
        const stacks = this.mergeStacksFromCatalog(responses);

        return dockerRuntimeCatalogSchema.parse({
            containers,
            images,
            networks,
            volumes,
            registries,
            stacks,
        });
    }

    private mergeContainersFromCatalog(responses: DockerRuntimeCatalogResponsePayload[]): DockerContainer[] {
        const merged = new Map<string, DockerContainer>();

        for (const response of responses) {
            for (const item of response.catalog.containers) {
                const normalized = this.normalizeContainer(item);
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

    private mergeImagesFromCatalog(responses: DockerRuntimeCatalogResponsePayload[]): DockerImage[] {
        const merged = new Map<string, DockerImage>();

        for (const response of responses) {
            for (const item of response.catalog.images) {
                const image = this.normalizeImage(item);
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

    private mergeNetworksFromCatalog(responses: DockerRuntimeCatalogResponsePayload[]): DockerNetwork[] {
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

    private mergeVolumesFromCatalog(responses: DockerRuntimeCatalogResponsePayload[]): DockerVolume[] {
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

    private mergeRegistriesFromCatalog(responses: DockerRuntimeCatalogResponsePayload[]): DockerRegistry[] {
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

    private mergeStacksFromCatalog(responses: DockerRuntimeCatalogResponsePayload[]): DockerStack[] {
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

    private pickBestInspectDetail(responses: DockerContainerInspectResponsePayload[]): DockerContainerInspectDetail {
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

    private normalizeContainer(input: unknown): DockerContainer | null {
        const parsed = dockerContainerSchema.safeParse(input);
        if (parsed.success) {
            return parsed.data;
        }

        if (!input || typeof input !== "object") {
            return null;
        }

        const source = isRecord(input) ? input : {};
        const id = this.asNonEmptyString(source.id) ?? null;
        if (!id) {
            return null;
        }

        const name = this.asNonEmptyString(source.name) ?? `container-${id.slice(0, 8)}`;
        const projectId = this.asNonEmptyString(source.projectId) ?? `project-${id.slice(0, 8)}`;
        const serviceId = this.asNonEmptyString(source.serviceId) ?? `service-${id.slice(0, 8)}`;
        const imageId = this.asNullableString(source.imageId);
        const environment = this.normalizeEnvironment(source.environment);
        const ports = this.normalizePorts(source.ports);
        const networkIds = this.normalizeStringArray(source.networkIds);
        const volumeIds = this.normalizeStringArray(source.volumeIds);
        const createdAt = this.asIsoString(source.createdAt);
        const updatedAt = this.asIsoString(source.updatedAt);

        const fallbackHash = this.buildContainerHash({
            managedBy:
                this.asNonEmptyString(source.managedBy) === "deployment_service"
                    ? "deployment_service"
                    : "orphan",
            managedDeploymentId: this.asNullableString(source.managedDeploymentId),
            managedServiceId: this.asNullableString(source.managedServiceId),
            managedProjectId: this.asNullableString(source.managedProjectId),
            name,
            projectId,
            serviceId,
            imageId,
            environment,
            ports,
        });

        const repaired = dockerContainerSchema.safeParse({
            id,
            hash: this.asNonEmptyString(source.hash) ?? fallbackHash,
            name,
            projectId,
            serviceId,
            stackId: this.asNullableString(source.stackId),
            imageId,
            status: this.normalizeStatus(source.status),
            health: this.normalizeHealth(source.health),
            environment,
            cpuPercent: this.normalizePercent(source.cpuPercent),
            memoryPercent: this.normalizePercent(source.memoryPercent),
            restartCount: this.normalizeNonNegativeInt(source.restartCount),
            ports,
            networkIds,
            volumeIds,
            managedBy:
                this.asNonEmptyString(source.managedBy) === "deployment_service"
                    ? "deployment_service"
                    : "orphan",
            managedReason: this.asNullableString(source.managedReason),
            managedDeploymentId: this.asNullableString(source.managedDeploymentId),
            managedServiceId: this.asNullableString(source.managedServiceId),
            managedProjectId: this.asNullableString(source.managedProjectId),
            managedImageRef: this.asNullableString(source.managedImageRef),
            managedNetworkMode: this.asNullableString(source.managedNetworkMode),
            logsStreamId: this.asNullableString(source.logsStreamId),
            startedAt: this.asNullableIsoString(source.startedAt),
            createdAt,
            updatedAt,
        });

        if (!repaired.success) {
            this.logger.warn(
                `Failed to normalize docker container '${id}': ${JSON.stringify(repaired.error.issues[0] ?? null)}`,
            );
            return null;
        }

        return repaired.data;
    }

    private normalizeImage(input: unknown): DockerImage | null {
        const parsed = dockerImageSchema.safeParse(input);

        const source = parsed.success
            ? (isRecord(parsed.data) ? parsed.data : {})
            : (isRecord(input) ? input : null);

        if (!source) {
            return null;
        }

        const id = parsed.success ? parsed.data.id : this.asNonEmptyString(source.id);
        if (!id) {
            return null;
        }

        const normalizedRegistry = this.normalizeImageRegistrySegment(parsed.success ? parsed.data.registry : source.registry);
        const normalizedRepository = this.normalizeImageRepositoryPath(parsed.success ? parsed.data.repository : source.repository);
        const hasUnknownRepository = normalizedRepository === "library/unknown";
        const repository = hasUnknownRepository ? this.buildFallbackImageRepository(id) : normalizedRepository;
        const registry = hasUnknownRepository ? "local" : normalizedRegistry;

        const normalized = dockerImageSchema.safeParse({
            id,
            registry,
            repository,
            tag: this.normalizeImageTag(parsed.success ? parsed.data.tag : source.tag),
            digest: this.normalizeImageDigest(parsed.success ? parsed.data.digest : source.digest),
            sizeBytes: this.normalizeImageSizeBytes(parsed.success ? parsed.data.sizeBytes : source.sizeBytes),
            createdAt: this.asIsoString(parsed.success ? parsed.data.createdAt : source.createdAt),
            lastSeenAt: this.asIsoString(parsed.success ? parsed.data.lastSeenAt : source.lastSeenAt),
            labels: this.normalizeImageLabels(parsed.success ? parsed.data.labels : source.labels),
        });

        if (!normalized.success) {
            this.logger.warn(
                `Failed to normalize docker image '${id}': ${JSON.stringify(normalized.error.issues[0] ?? null)}`,
            );
            return null;
        }

        return normalized.data;
    }

    private buildFallbackImageRepository(imageId: string): string {
        const normalizedId = imageId.replace(/^sha256:/, "").trim();
        const shortId = normalizedId.length > 0 ? normalizedId.slice(0, 12) : "unknown";
        return `untagged/${shortId}`;
    }

    private normalizeImageRegistrySegment(value: unknown): string {
        if (typeof value !== "string") {
            return "docker.io";
        }

        const normalized = value.trim();
        if (normalized.length === 0 || normalized === "<none>" || this.isPlaceholderImageSegment(normalized)) {
            return "docker.io";
        }

        return normalized;
    }

    private normalizeImageRepositoryPath(value: unknown): string {
        if (typeof value !== "string") {
            return "library/unknown";
        }

        const segments = value
            .split("/")
            .map((segment) => segment.trim())
            .filter((segment) => segment.length > 0 && segment !== "<none>" && !this.isPlaceholderImageSegment(segment));

        if (segments.length === 0) {
            return "library/unknown";
        }

        return segments.join("/");
    }

    private normalizeImageTag(value: unknown): string | null {
        if (typeof value !== "string") {
            return null;
        }

        const normalized = value.trim();
        if (normalized.length === 0 || normalized === "<none>" || this.isPlaceholderImageSegment(normalized)) {
            return null;
        }

        return normalized;
    }

    private normalizeImageDigest(value: unknown): string | null {
        if (typeof value !== "string") {
            return null;
        }

        const normalized = value.trim();
        if (normalized.length === 0 || normalized === "<none>" || this.isPlaceholderImageSegment(normalized)) {
            return null;
        }

        return normalized;
    }

    private normalizeImageSizeBytes(value: unknown): number | null {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
            return null;
        }

        return value;
    }

    private normalizeImageLabels(value: unknown): Record<string, string> {
        if (!value || typeof value !== "object") {
            return {};
        }

        const entries = Object.entries(isRecord(value) ? value : {}).filter(
            (entry): entry is [string, string] => typeof entry[1] === "string",
        );

        return Object.fromEntries(entries);
    }

    private isPlaceholderImageSegment(value: string): boolean {
        const normalized = value.trim().toLowerCase();
        return normalized === "undefined" || normalized === "null" || normalized === "none" || normalized === "nan";
    }

    private getFilterEntry(input: { filter?: unknown }, key: string): ParsedFilterEntry | undefined {
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

    private matchString(value: string, entry: ParsedFilterEntry | undefined): boolean {
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

    private matchEq(value: string | boolean, entry: ParsedFilterEntry | undefined): boolean {
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

    private sortItems<T>(
        items: T[],
        sortBy: string | undefined,
        sortDirection: "asc" | "desc" | undefined,
        getComparableValue: (item: T, sortBy: string) => string | number | boolean | null | undefined,
    ): T[] {
        const key = sortBy ?? "updatedAt";
        const direction = sortDirection === "asc" ? 1 : -1;

        return [...items].sort((left, right) => {
            const leftValue = this.normalizeComparableValue(getComparableValue(left, key));
            const rightValue = this.normalizeComparableValue(getComparableValue(right, key));

            if (leftValue < rightValue) return -1 * direction;
            if (leftValue > rightValue) return 1 * direction;
            return 0;
        });
    }

    private normalizeComparableValue(value: string | number | boolean | null | undefined): string | number {
        if (typeof value === "number") return value;
        if (typeof value === "boolean") return value ? 1 : 0;
        if (typeof value === "string") return value;
        return "";
    }

    private buildContainerHash(input: {
        managedBy: DockerContainer["managedBy"];
        managedDeploymentId: string | null;
        managedServiceId: string | null;
        managedProjectId: string | null;
        name: string;
        projectId: string;
        serviceId: string;
        imageId: string | null;
        environment: DockerContainer["environment"];
        ports: DockerContainer["ports"];
    }): string {
        const identity = input.managedDeploymentId
            ? {
                  kind: "deployment",
                  managedBy: input.managedBy,
                  deploymentId: input.managedDeploymentId,
              }
            : {
                  kind: "runtime",
                  managedBy: input.managedBy,
                  projectId: input.managedProjectId ?? input.projectId,
                  serviceId: input.managedServiceId ?? input.serviceId,
                  name: input.name,
                  imageId: input.imageId,
                  environment: input.environment,
              };

        return createHash("sha256")
            .update(
                JSON.stringify({
                    identity,
                    ports: [...input.ports]
                        .map((port) => `${String(port.containerPort)}/${port.protocol}`)
                        .sort(),
                }),
            )
            .digest("hex");
    }

    private asNonEmptyString(value: unknown): string | null {
        return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
    }

    private asNullableString(value: unknown): string | null {
        return this.asNonEmptyString(value);
    }

    private asIsoString(value: unknown): string {
        if (typeof value === "string" && !Number.isNaN(Date.parse(value))) {
            return value;
        }

        return new Date().toISOString();
    }

    private asNullableIsoString(value: unknown): string | null {
        if (value == null) {
            return null;
        }

        return this.asIsoString(value);
    }

    private normalizeStatus(value: unknown): DockerContainer["status"] {
        const normalized = typeof value === "string" ? value.toLowerCase() : "";

        switch (normalized) {
            case "created":
                return "created";
            case "running":
                return "running";
            case "paused":
                return "paused";
            case "restarting":
                return "restarting";
            case "exited":
                return "exited";
            case "dead":
                return "dead";
            case "unknown":
                return "unknown";
            default:
                return "unknown";
        }
    }

    private normalizeHealth(value: unknown): DockerContainer["health"] {
        const normalized = typeof value === "string" ? value.toLowerCase() : "";

        switch (normalized) {
            case "healthy":
                return "healthy";
            case "unhealthy":
                return "unhealthy";
            case "starting":
                return "starting";
            case "none":
                return "none";
            default:
                return "none";
        }
    }

    private normalizeEnvironment(value: unknown): DockerContainer["environment"] {
        if (typeof value !== "string") {
            return null;
        }

        const normalized = value.toLowerCase();
        return DEPLOYMENT_ENVIRONMENTS.has(normalized as "production" | "staging" | "preview" | "development")
            ? (normalized as DockerContainer["environment"])
            : null;
    }

    private normalizePercent(value: unknown): number | null {
        if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 100) {
            return null;
        }

        return value;
    }

    private normalizeNonNegativeInt(value: unknown): number {
        if (typeof value !== "number" || !Number.isInteger(value) || value < 0) {
            return 0;
        }

        return value;
    }

    private normalizeStringArray(value: unknown): string[] {
        if (!Array.isArray(value)) {
            return [];
        }

        return value.filter((item): item is string => typeof item === "string" && item.length > 0);
    }

    private normalizePorts(value: unknown): DockerContainer["ports"] {
        if (!Array.isArray(value)) {
            return [];
        }

        return value
            .map((item) => {
                if (!item || typeof item !== "object") {
                    return null;
                }

                const port = isRecord(item) ? item : {};
                const containerPort =
                    typeof port.containerPort === "number" &&
                    Number.isInteger(port.containerPort) &&
                    port.containerPort >= 1 &&
                    port.containerPort <= 65535
                        ? port.containerPort
                        : null;

                if (containerPort === null) {
                    return null;
                }

                const hostPort =
                    typeof port.hostPort === "number" &&
                    Number.isInteger(port.hostPort) &&
                    port.hostPort >= 1 &&
                    port.hostPort <= 65535
                        ? port.hostPort
                        : null;

                const protocol = port.protocol === "udp" ? "udp" : "tcp";

                return {
                    containerPort,
                    hostPort,
                    protocol,
                };
            })
            .filter((item): item is DockerContainer["ports"][number] => item !== null);
    }

    private sortContainers(
        items: DockerContainer[],
        sortBy: string | undefined,
        sortDirection: "asc" | "desc" | undefined,
    ): DockerContainer[] {
        return this.sortItems(items, sortBy, sortDirection, (item, key) => this.resolveComparableValue(item, key));
    }

    private resolveComparableValue(item: DockerContainer, sortBy: string): string | number {
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

    private paginate(items: DockerContainer[], limit: number, offset: number): DockerContainerListResult {
        return this.paginateList(items, limit, offset);
    }

    private paginateList<T>(items: T[], limit: number, offset: number): DockerListResult<T> {
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

    private formatError(error: unknown): string {
        if (error instanceof Error) {
            return error.message;
        }

        return String(error);
    }

    private toError(error: unknown): Error {
        if (error instanceof Error) {
            return error;
        }

        return new Error(String(error));
    }
}
