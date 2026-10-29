import { Logger } from "@nestjs/common";
import { serviceOver, type Over } from "@deployer/effect-core";
import type { EffectRuntime } from "@deployer/nest-effect";
import { Context, Effect } from "effect";
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
import type { DockerContainerInspectRequestPayload, DockerContainerInspectResponsePayload, DockerContainerListRequestPayload, DockerContainerListResponsePayload, DockerContainerListResult, DockerRuntimeCatalogResponsePayload } from "../mesh/docker-container-mesh.contracts";
import { DockerContainerMeshService } from "../mesh/docker-container-mesh.service";
import { isRecord, isObjectLike } from "@deployer/type-guards"



import { formatError, normalizeContainer, toError } from "./mesh-entity-normalization";
import { applyContainerFilters, buildDaemonScopedContainerFingerprint, computeSharedDaemonDiagnostics, dedupeResponsesByResponder, getFilterEntry, groupContainersForInventory, isAbortLikeError, matchEq, matchString, mergeContainerHealth, mergeContainerStatus, mergeRuntimeCatalogResponses, paginate, paginateList, pickBestInspectDetail, resolvePeerBaseUrl, sortContainers, sortItems } from "./mesh-universe-merge";
import type { DockerContainerResolutionOptions, DockerGroupedDaemonDiagnostics, DockerListResult, MeshPeerSessionSummary, PeerFallbackAttemptResult } from "./mesh-universe-types";

const MESH_FANOUT_LIMIT = 500;
const PEER_FALLBACK_TIMEOUT_MS = 1_750;
const PEER_FALLBACK_RETRY_TIMEOUT_MS = 2_750;

/** The container resolution logic as a plain class over its four collaborators; the Effect service below builds it per call. */
class ContainerResolutionImpl {
    private readonly logger = new Logger("DockerContainerResolutionService");

    constructor(
        private readonly dockerContainerMeshService: Pick<
            DockerContainerMeshService,
            "listContainersAcrossInstances" | "inspectContainerAcrossInstances"
        >,
        private readonly dockerRepository: Pick<DockerRepository, "listContainers" | "inspectContainer">,
        private readonly systemMeshTopologyService: Pick<SystemMeshTopologyService, "listPeerSessions">,
        private readonly meshInternalRequestService: Pick<MeshInternalRequestService, "buildInternalHeaders">,
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
                const normalized = normalizeContainer(item, (m) => this.logger.warn(m));
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
            const normalized = normalizeContainer(entry, (m) => this.logger.warn(m));
            if (normalized) {
                containers.push(normalized);
            }
        }

        return containers;
    }


}

/** The mesh fan-out that lists and inspects containers on every node. */
export class ContainersMeshPort extends Context.Service<
    ContainersMeshPort,
    Pick<DockerContainerMeshService, "listContainersAcrossInstances" | "inspectContainerAcrossInstances">
>()("runtime/ContainersMeshPort") {}

/** This node's own containers, read from the local engine. */
export class ContainersLocalPort extends Context.Service<
    ContainersLocalPort,
    Pick<DockerRepository, "listContainers" | "inspectContainer">
>()("runtime/ContainersLocalPort") {}

/** The mesh topology, for the direct peer fallback. */
export class MeshTopologyPort extends Context.Service<
    MeshTopologyPort,
    Pick<SystemMeshTopologyService, "listPeerSessions">
>()("runtime/MeshTopologyPort") {}

/** The headers a node uses to call a peer's internal API. */
export class MeshHeadersPort extends Context.Service<
    MeshHeadersPort,
    Pick<MeshInternalRequestService, "buildInternalHeaders">
>()("runtime/MeshHeadersPort") {}

export type DockerContainerResolutionPorts = ContainersMeshPort | ContainersLocalPort | MeshTopologyPort | MeshHeadersPort;

export type DockerContainerResolutionShape = {
    /** One page of containers across the mesh; this node's own when no peer answers or the fan-out fails. */
    readonly listContainers: (
        input: DockerContainerListInput,
        options?: DockerContainerResolutionOptions,
    ) => Effect.Effect<DockerContainerListResult, unknown>;
    /** The inventory grouped by runtime fingerprint, with shared-daemon diagnostics. */
    readonly listContainersGrouped: (
        input: DockerContainerGroupedListInput,
        options?: DockerContainerResolutionOptions,
    ) => Effect.Effect<DockerContainerGroupedListResult, unknown>;
    /** This node's inspect detail, else the best one a peer returns; fails with the local error when nobody has it. */
    readonly inspectContainer: (containerId: string) => Effect.Effect<DockerContainerInspectDetail, unknown>;
};

const resolutionOver = (ports: {
    mesh: ContainersMeshPort["Service"];
    local: ContainersLocalPort["Service"];
    topology: MeshTopologyPort["Service"];
    headers: MeshHeadersPort["Service"];
}): DockerContainerResolutionShape => {
    const impl = new ContainerResolutionImpl(ports.mesh, ports.local, ports.topology, ports.headers);
    return {
        listContainers: (input, options) => Effect.tryPromise({ try: () => impl.listContainers(input, options), catch: (error) => error }),
        listContainersGrouped: (input, options) =>
            Effect.tryPromise({ try: () => impl.listContainersGrouped(input, options), catch: (error) => error }),
        inspectContainer: (containerId) => Effect.tryPromise({ try: () => impl.inspectContainer(containerId), catch: (error) => error }),
    };
};

/**
 * Container listing and inspection across the mesh. A constant that reads the mesh fan-out, the local
 * repository, the topology and the header builder from the Effect context when a method runs.
 */
export class DockerContainerResolution extends Context.Service<
    DockerContainerResolution,
    Over<DockerContainerResolutionShape, DockerContainerResolutionPorts>
>()("runtime/DockerContainerResolution") {
    static readonly live = serviceOver(
        Effect.all({ mesh: ContainersMeshPort, local: ContainersLocalPort, topology: MeshTopologyPort, headers: MeshHeadersPort }),
        resolutionOver,
    );
}

/** Run a container-resolution call for a Nest class that is not on Effect yet; it rejects with the original failure. */
export function withContainerResolution<A>(
    runtime: Pick<EffectRuntime, "runPromiseUnwrapped">,
    use: (
        resolution: Context.Service.Shape<typeof DockerContainerResolution>,
    ) => Effect.Effect<A, unknown, DockerContainerResolutionPorts>,
): Promise<A> {
    return runtime.runPromiseUnwrapped(
        Effect.gen(function* () {
            const resolution = yield* DockerContainerResolution;
            return yield* use(resolution);
        }),
    );
}
