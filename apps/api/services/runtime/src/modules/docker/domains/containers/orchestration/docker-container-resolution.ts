import { createHash } from "node:crypto";

import { Logger } from "@nestjs/common";
import { Context, Effect } from "effect";

import {
    
    
    
    
    
    
    
    
    type DockerContainer,
    type DockerContainerInspectDetail,
    
    
    
    
    
    
} from "@deployer/contracts-entities";
import { serviceOver, type Over } from "@deployer/effect-core";
import { BadRequestError } from "@deployer/errors";
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
import { isRecord } from "@deployer/type-guards"

import { DockerRepository } from "../../../repositories/facade/docker.repository";

import { formatError, normalizeContainer, toError } from "./mesh-entity-normalization";
import { applyContainerFilters, buildDaemonScopedContainerFingerprint, computeSharedDaemonDiagnostics, dedupeResponsesByResponder,  groupContainersForInventory,    mergeContainerHealth, mergeContainerStatus,  paginate, paginateList, pickBestInspectDetail, sortContainers } from "./mesh-universe-merge";

import type { DockerContainerResolutionOptions, DockerGroupedDaemonDiagnostics, DockerListResult } from "./mesh-universe-types";
import type { DockerNodeMesh } from "../mesh/docker-node-mesh";
import type { DockerContainerInspectRequestPayload, DockerContainerInspectResponsePayload, DockerContainerListRequestPayload, DockerContainerListResponsePayload, DockerContainerListResult, DockerRuntimeCatalogResponsePayload } from "../mesh/node-mesh-types";





const MESH_FANOUT_LIMIT = 500;

/** The container resolution logic as a plain class over its two collaborators; the Effect service below builds it per call. */
class ContainerResolutionImpl {
    private readonly logger = new Logger("DockerContainerResolutionService");

    constructor(
        private readonly dockerContainerMeshService: Pick<
            DockerNodeMesh,
            "listContainersAcrossInstances" | "inspectContainerAcrossInstances"
        >,
        private readonly dockerRepository: Pick<DockerRepository, "listContainers" | "inspectContainer">,
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

            const resolvedResponses = dedupeResponsesByResponder(meshResult.responses);

            this.logger.debug(
                [
                    `Mesh listContainers call metrics: responses=${String(meshResult.responses.length)}`,
                    `combinedResponses=${String(resolvedResponses.length)}`,
                    `expected=${String(meshResult.metrics.expectedResponders)}`,
                    `received=${String(meshResult.metrics.receivedResponses)}`,
                    `timedOut=${String(meshResult.metrics.timedOut)}`,
                    `stoppedEarly=${String(meshResult.stoppedEarly)}`,
                    `reason=${meshResult.reason}`,
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

            const resolvedResponses = dedupeResponsesByResponder(meshResult.responses);

            this.logger.debug(
                [
                    `Mesh listContainers call metrics: responses=${String(meshResult.responses.length)}`,
                    `combinedResponses=${String(resolvedResponses.length)}`,
                    `expected=${String(meshResult.metrics.expectedResponders)}`,
                    `received=${String(meshResult.metrics.receivedResponses)}`,
                    `timedOut=${String(meshResult.metrics.timedOut)}`,
                    `stoppedEarly=${String(meshResult.stoppedEarly)}`,
                    `reason=${meshResult.reason}`,
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
                const normalized = normalizeContainer(item, (m) => { this.logger.warn(m); });
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

}

/** The mesh fan-out that lists and inspects containers on every node. */
export class ContainersMeshPort extends Context.Service<
    ContainersMeshPort,
    Pick<DockerNodeMesh, "listContainersAcrossInstances" | "inspectContainerAcrossInstances">
>()("runtime/ContainersMeshPort") {}

/** This node's own containers, read from the local engine. */
export class ContainersLocalPort extends Context.Service<
    ContainersLocalPort,
    Pick<DockerRepository, "listContainers" | "inspectContainer">
>()("runtime/ContainersLocalPort") {}

export type DockerContainerResolutionPorts = ContainersMeshPort | ContainersLocalPort;

export type DockerContainerResolutionShape = {
    /** One page of containers across the mesh; this node's own when no peer answers or the fan-out fails. */
    readonly listContainers: (
        input: DockerContainerListInput,
        options?: DockerContainerResolutionOptions,
    ) => Effect.Effect<DockerContainerListResult, unknown, DockerContainerResolutionPorts>;
    /** The inventory grouped by runtime fingerprint, with shared-daemon diagnostics. */
    readonly listContainersGrouped: (
        input: DockerContainerGroupedListInput,
        options?: DockerContainerResolutionOptions,
    ) => Effect.Effect<DockerContainerGroupedListResult, unknown, DockerContainerResolutionPorts>;
    /** This node's inspect detail, else the best one a peer returns; fails with the local error when nobody has it. */
    readonly inspectContainer: (
        containerId: string,
    ) => Effect.Effect<DockerContainerInspectDetail, unknown, DockerContainerResolutionPorts>;
};

const resolutionOver = (ports: {
    mesh: ContainersMeshPort["Service"];
    local: ContainersLocalPort["Service"];
}): DockerContainerResolutionShape => {
    const impl = new ContainerResolutionImpl(ports.mesh, ports.local);
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
        Effect.all({ mesh: ContainersMeshPort, local: ContainersLocalPort }),
        resolutionOver,
    );
}
