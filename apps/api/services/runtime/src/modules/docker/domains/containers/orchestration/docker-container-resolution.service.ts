import { Injectable, Logger } from "@nestjs/common";
import { BadRequestError } from "@deployer/errors";
import { createHash } from "node:crypto";
import type {
    DockerContainerGroupedListInput,
    DockerContainerGroupedListItem,
    DockerContainerGroupedListResult,
    DockerContainerListInput,
} from "@deployer/runtime-contracts/modules/docker/containers/shared";
import type {
    DockerImageListInput,
} from "@deployer/runtime-contracts/modules/docker/images/list";
import type {
    DockerNetworkListInput,
} from "@deployer/runtime-contracts/modules/docker/networks/list";
import type {
    DockerVolumeListInput,
} from "@deployer/runtime-contracts/modules/docker/volumes/list";
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
} from "@deployer/contracts-entities";
import { SystemMeshTopologyService } from "@deployer/shared/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { MeshInternalRequestService } from "@deployer/shared/core/modules/mesh/services/mesh-internal-request.service";
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
import { isRecord, isObjectLike } from "@deployer/type-guards"


import { asIsoString, asNonEmptyString, asNullableIsoString, asNullableString, buildContainerHash, buildFallbackImageRepository, formatError, normalizeEnvironment, normalizeHealth, normalizeImageDigest, normalizeImageLabels, normalizeImageRegistrySegment, normalizeImageRepositoryPath, normalizeImageSizeBytes, normalizeImageTag, normalizeNonNegativeInt, normalizePercent, normalizePorts, normalizeStatus, normalizeStringArray, toError } from "./mesh-entity-normalization";
import { applyContainerFilters, buildDaemonScopedContainerFingerprint, computeSharedDaemonDiagnostics, dedupeResponsesByResponder, getFilterEntry, groupContainersForInventory, isAbortLikeError, matchEq, matchString, mergeContainerHealth, mergeContainerStatus, mergeNetworksFromCatalog, mergeRegistriesFromCatalog, mergeStacksFromCatalog, mergeVolumesFromCatalog, paginate, paginateList, pickBestInspectDetail, resolvePeerBaseUrl, sortContainers, sortItems } from "./mesh-universe-merge";
import type { DockerContainerResolutionOptions, DockerGroupedDaemonDiagnostics, DockerListResult, MeshPeerSessionSummary, PeerFallbackAttemptResult } from "./mesh-universe-types";

const MESH_FANOUT_LIMIT = 500;
const PEER_FALLBACK_TIMEOUT_MS = 1_750;
const PEER_FALLBACK_RETRY_TIMEOUT_MS = 2_750;

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

            const meshResponses = dedupeResponsesByResponder(meshResult.responses);
            const missingMeshResponders = Math.max(0, meshResult.metrics.expectedResponders - meshResponses.length);

            let resolvedResponses = meshResponses;
            let peerFallbackResponses: DockerContainerListResponsePayload[] = [];

            if (missingMeshResponders > 0) {
                peerFallbackResponses = await this.collectPeerFallbackContainerResponses();
                if (peerFallbackResponses.length > 0) {
                    resolvedResponses = dedupeResponsesByResponder([...meshResponses, ...peerFallbackResponses]);
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
            const filtered = applyContainerFilters(merged, input);
            const sorted = sortContainers(filtered, input.sortBy, input.sortDirection);
            const paginated = paginate(sorted, input.limit, input.offset);

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
                `Mesh container resolution failed (${formatError(error)}). Falling back to local repository`,
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
        const grouped = groupContainersForInventory(sorted);
        const diagnostics = universe.diagnostics;

        const paginated = paginateList(grouped, input.limit, input.offset);

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
            localInspectError = toError(error);
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
                return pickBestInspectDetail(meshResult.responses);
            }

            throw localInspectError;
        } catch (error) {
            if (error === localInspectError) {
                throw localInspectError;
            }

            this.logger.warn(
                `Mesh container inspect resolution failed (${formatError(error)}). Falling back to local repository`,
            );

            throw localInspectError;
        }
    }

    async listImages(input: DockerImageListInput): Promise<DockerListResult<DockerImage>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.images.filter((item) => {
            const registryMatch = matchString(item.registry, getFilterEntry(input, "registry"));
            const repositoryMatch = matchString(item.repository, getFilterEntry(input, "repository"));
            const tagMatch = matchString(item.tag ?? "", getFilterEntry(input, "tag"));
            return registryMatch && repositoryMatch && tagMatch;
        });

        const sorted = sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
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

        return paginateList(sorted, input.limit, input.offset);
    }

    async listNetworks(input: DockerNetworkListInput): Promise<DockerListResult<DockerNetwork>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.networks.filter((item) => {
            const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
            const driverMatch = matchEq(item.driver, getFilterEntry(input, "driver"));
            const scopeMatch = matchEq(item.scope, getFilterEntry(input, "scope"));
            return nameMatch && driverMatch && scopeMatch;
        });

        const sorted = sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
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

        return paginateList(sorted, input.limit, input.offset);
    }

    async listVolumes(input: DockerVolumeListInput): Promise<DockerListResult<DockerVolume>> {
        const catalog = await this.resolveRuntimeCatalog();

        const filtered = catalog.volumes.filter((item) => {
            const nameMatch = matchString(item.name, getFilterEntry(input, "name"));
            const driverMatch = matchEq(item.driver, getFilterEntry(input, "driver"));
            return nameMatch && driverMatch;
        });

        const sorted = sortItems(filtered, input.sortBy, input.sortDirection, (item, sortBy) => {
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

        return paginateList(sorted, input.limit, input.offset);
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
            const sortedLocal = sortContainers(localResult.data, input.sortBy, input.sortDirection);
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

            const meshResponses = dedupeResponsesByResponder(meshResult.responses);
            const missingMeshResponders = Math.max(0, meshResult.metrics.expectedResponders - meshResponses.length);

            let resolvedResponses = meshResponses;
            let peerFallbackResponses: DockerContainerListResponsePayload[] = [];

            if (missingMeshResponders > 0) {
                peerFallbackResponses = await this.collectPeerFallbackContainerResponses();
                if (peerFallbackResponses.length > 0) {
                    resolvedResponses = dedupeResponsesByResponder([...meshResponses, ...peerFallbackResponses]);
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
                const sortedLocal = sortContainers(localResult.data, input.sortBy, input.sortDirection);
                return {
                    containers: sortedLocal,
                    diagnostics: {
                        hasSharedDaemonAcrossNodes: false,
                        sharedDaemonGroups: [],
                    },
                };
            }

            const merged = this.mergeMeshResponses(resolvedResponses);
            const filtered = applyContainerFilters(merged, fullScanInput);
            const sorted = sortContainers(filtered, input.sortBy, input.sortDirection);
            const diagnostics = computeSharedDaemonDiagnostics(resolvedResponses);

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
                `Mesh container resolution failed (${formatError(error)}). Falling back to local repository`,
            );

            const localResult = await this.dockerRepository.listContainers(fullScanInput);
            const sortedLocal = sortContainers(localResult.data, input.sortBy, input.sortDirection);
            return {
                containers: sortedLocal,
                diagnostics: {
                    hasSharedDaemonAcrossNodes: false,
                    sharedDaemonGroups: [],
                },
            };
        }
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

                const dedupeFingerprint = buildDaemonScopedContainerFingerprint(normalized);
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
                    status: mergeContainerStatus(existing.status, normalized.status),
                    health: mergeContainerHealth(existing.health, normalized.health),
                });
            }
        }

        return [...dedupedByDaemonFingerprint.values()];
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
        const peerBaseUrl = resolvePeerBaseUrl(peer.endpointUrl, peer.metadata);
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
            if (isAbortLikeError(error)) {
                return {
                    peer,
                    status: "aborted",
                };
            }

            this.logger.debug(
                `Peer fallback request failed for '${peer.peerNodeId}': ${formatError(error)}`,
            );

            return {
                peer,
                status: "networkFailure",
            };
        } finally {
            clearTimeout(timeout);
        }
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
                `Mesh runtime catalog resolution failed (${formatError(error)}). Falling back to local repository`,
            );
            return await this.dockerRepository.getRuntimeCatalogSnapshot();
        }
    }

    private mergeRuntimeCatalogResponses(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerRuntimeCatalog {
        const containers = this.mergeContainersFromCatalog(responses);
        const images = this.mergeImagesFromCatalog(responses);
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

    private mergeContainersFromCatalog(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerContainer[] {
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

    private mergeImagesFromCatalog(responses: readonly DockerRuntimeCatalogResponsePayload[]): DockerImage[] {
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

    private normalizeContainer(input: unknown): DockerContainer | null {
        const parsed = dockerContainerSchema.safeParse(input);
        if (parsed.success) {
            return parsed.data;
        }

        if (!input || typeof input !== "object") {
            return null;
        }

        const source = isRecord(input) ? input : {};
        const id = asNonEmptyString(source.id) ?? null;
        if (!id) {
            return null;
        }

        const name = asNonEmptyString(source.name) ?? `container-${id.slice(0, 8)}`;
        const projectId = asNonEmptyString(source.projectId) ?? `project-${id.slice(0, 8)}`;
        const serviceId = asNonEmptyString(source.serviceId) ?? `service-${id.slice(0, 8)}`;
        const imageId = asNullableString(source.imageId);
        const environment = normalizeEnvironment(source.environment);
        const ports = normalizePorts(source.ports);
        const networkIds = normalizeStringArray(source.networkIds);
        const volumeIds = normalizeStringArray(source.volumeIds);
        const createdAt = asIsoString(source.createdAt);
        const updatedAt = asIsoString(source.updatedAt);

        const fallbackHash = buildContainerHash({
            managedBy:
                asNonEmptyString(source.managedBy) === "deployment_service"
                    ? "deployment_service"
                    : "orphan",
            managedDeploymentId: asNullableString(source.managedDeploymentId),
            managedServiceId: asNullableString(source.managedServiceId),
            managedProjectId: asNullableString(source.managedProjectId),
            name,
            projectId,
            serviceId,
            imageId,
            environment,
            ports,
        });

        const repaired = dockerContainerSchema.safeParse({
            id,
            hash: asNonEmptyString(source.hash) ?? fallbackHash,
            name,
            projectId,
            serviceId,
            stackId: asNullableString(source.stackId),
            imageId,
            status: normalizeStatus(source.status),
            health: normalizeHealth(source.health),
            environment,
            cpuPercent: normalizePercent(source.cpuPercent),
            memoryPercent: normalizePercent(source.memoryPercent),
            restartCount: normalizeNonNegativeInt(source.restartCount),
            ports,
            networkIds,
            volumeIds,
            managedBy:
                asNonEmptyString(source.managedBy) === "deployment_service"
                    ? "deployment_service"
                    : "orphan",
            managedReason: asNullableString(source.managedReason),
            managedDeploymentId: asNullableString(source.managedDeploymentId),
            managedServiceId: asNullableString(source.managedServiceId),
            managedProjectId: asNullableString(source.managedProjectId),
            managedImageRef: asNullableString(source.managedImageRef),
            managedNetworkMode: asNullableString(source.managedNetworkMode),
            logsStreamId: asNullableString(source.logsStreamId),
            startedAt: asNullableIsoString(source.startedAt),
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

        const id = parsed.success ? parsed.data.id : asNonEmptyString(source.id);
        if (!id) {
            return null;
        }

        const normalizedRegistry = normalizeImageRegistrySegment(parsed.success ? parsed.data.registry : source.registry);
        const normalizedRepository = normalizeImageRepositoryPath(parsed.success ? parsed.data.repository : source.repository);
        const hasUnknownRepository = normalizedRepository === "library/unknown";
        const repository = hasUnknownRepository ? buildFallbackImageRepository(id) : normalizedRepository;
        const registry = hasUnknownRepository ? "local" : normalizedRegistry;

        const normalized = dockerImageSchema.safeParse({
            id,
            registry,
            repository,
            tag: normalizeImageTag(parsed.success ? parsed.data.tag : source.tag),
            digest: normalizeImageDigest(parsed.success ? parsed.data.digest : source.digest),
            sizeBytes: normalizeImageSizeBytes(parsed.success ? parsed.data.sizeBytes : source.sizeBytes),
            createdAt: asIsoString(parsed.success ? parsed.data.createdAt : source.createdAt),
            lastSeenAt: asIsoString(parsed.success ? parsed.data.lastSeenAt : source.lastSeenAt),
            labels: normalizeImageLabels(parsed.success ? parsed.data.labels : source.labels),
        });

        if (!normalized.success) {
            this.logger.warn(
                `Failed to normalize docker image '${id}': ${JSON.stringify(normalized.error.issues[0] ?? null)}`,
            );
            return null;
        }

        return normalized.data;
    }

}
