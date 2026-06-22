import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import type { DockerContainerListInput } from "@repo/api-contracts/modules/docker/containers/shared";
import type { DockerImageListInput } from "@repo/api-contracts/modules/docker/images/list";
import type { DockerContainer } from "@repo/contracts-entities";
import { DockerContainerResolutionService } from "./docker-container-resolution.service";

function createMeshListResult(
    responses: Array<{
        data: DockerContainer[];
        meta: { total: number; limit: number; offset: number; hasMore: boolean };
        responderNodeId: string;
        responderDaemonId?: string | null;
    }>,
    expectedResponders: number,
) {
    const normalizedResponses = responses.map((response) => ({
        ...response,
        responderDaemonId: response.responderDaemonId ?? null,
    }));

    return {
        correlationId: "corr-1",
        responses: normalizedResponses,
        stoppedEarly: false,
        reason: "timeout" as const,
        metrics: {
            expectedResponders,
            receivedResponses: normalizedResponses.length,
            droppedResponses: 0,
            retryResponses: 0,
            maxLagMs: 0,
            avgLagMs: 0,
            timedOut: false,
        },
    };
}

function createTopologyStub() {
    return {
        listPeerSessions: vi.fn(() => ({ items: [] })),
    };
}

function createMeshInternalRequestServiceStub() {
    return {
        buildInternalHeaders: vi.fn((input?: { includeLocalOnly?: boolean }) =>
            input?.includeLocalOnly ? { "x-mesh-local-only": "1" } : {}),
    };
}

function createContainer(input: {
    id: string;
    hash?: string;
    name: string;
    status?: DockerContainer["status"];
    createdAt?: string;
    updatedAt?: string;
    overrides?: Partial<DockerContainer>;
}): DockerContainer {
    const createdAt = input.createdAt ?? "2026-01-01T00:00:00.000Z";
    const updatedAt = input.updatedAt ?? "2026-01-01T00:00:00.000Z";

    const container: DockerContainer = {
        id: input.id,
        hash: input.hash ?? `hash-${input.id}`,
        name: input.name,
        projectId: "project-1",
        serviceId: "service-1",
        stackId: null,
        imageId: null,
        status: input.status ?? "running",
        health: "none",
        environment: null,
        cpuPercent: null,
        memoryPercent: null,
        restartCount: 0,
        ports: [],
        networkIds: [],
        volumeIds: [],
        managedBy: "orphan",
        managedReason: "unmanaged_runtime_container",
        managedDeploymentId: null,
        managedServiceId: null,
        managedProjectId: null,
        managedImageRef: null,
        managedNetworkMode: null,
        logsStreamId: null,
        startedAt: null,
        createdAt,
        updatedAt,
    };

    return {
        ...container,
        ...(input.overrides ?? {}),
    };
}

function createRuntimeCatalog(imageId: string) {
    return {
        containers: [],
        images: [
            {
                id: imageId,
                registry: "docker.io",
                repository: "library/alpine",
                tag: "latest",
                digest: null,
                sizeBytes: null,
                createdAt: "2026-01-01T00:00:00.000Z",
                lastSeenAt: "2026-01-02T00:00:00.000Z",
                labels: {},
            },
        ],
        networks: [
            {
                id: `net-${imageId}`,
                name: "bridge",
                driver: "bridge",
                scope: "local",
                internal: false,
                attachable: true,
                subnet: null,
                gateway: null,
                containerIds: [],
                labels: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
        volumes: [
            {
                id: `vol-${imageId}`,
                name: `vol-${imageId}`,
                driver: "local",
                mountpoint: null,
                sizeBytes: null,
                usedByContainerIds: [],
                labels: {},
                createdAt: "2026-01-01T00:00:00.000Z",
                updatedAt: "2026-01-01T00:00:00.000Z",
            },
        ],
        registries: [
            {
                id: "docker.io",
                name: "docker.io",
                url: "docker.io",
                authMode: "anonymous",
                status: "unknown",
                isPrimary: true,
                repositories: ["library/alpine"],
                lastSyncedAt: "2026-01-02T00:00:00.000Z",
                createdAt: "2026-01-02T00:00:00.000Z",
                updatedAt: "2026-01-02T00:00:00.000Z",
            },
        ],
        stacks: [],
    };
}

describe("DockerContainerResolutionService", () => {
    const baseInput: DockerContainerListInput = {
        limit: 2,
        offset: 1,
        sortBy: "name",
        sortDirection: "asc",
        filter: {},
    };

    const imageListInput: DockerImageListInput = {
        limit: 50,
        offset: 0,
        sortBy: "lastSeenAt",
        sortDirection: "desc",
        filter: {},
    };

    it("merges containers from mesh instances and preserves duplicate hash entries for UI grouping", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => createMeshListResult([
                {
                    data: [
                        createContainer({ id: "ctr-3", name: "gamma", updatedAt: "2026-01-03T00:00:00.000Z" }),
                        createContainer({ id: "ctr-1", name: "alpha", updatedAt: "2026-01-01T00:00:00.000Z" }),
                    ],
                    meta: { total: 2, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-a",
                },
                {
                    data: [
                        createContainer({ id: "ctr-2", name: "beta", updatedAt: "2026-01-02T00:00:00.000Z" }),
                        createContainer({ id: "ctr-1", name: "alpha", updatedAt: "2026-01-04T00:00:00.000Z" }),
                    ],
                    meta: { total: 2, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-b",
                },
            ], 2)),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listContainers(baseInput);

        expect(dockerContainerMeshService.listContainersAcrossInstances).toHaveBeenCalledWith(
            {
                query: {
                    ...baseInput,
                    limit: 500,
                    offset: 0,
                },
            },
            {
                timeoutMs: 1_500,
                maxCollectedResponses: 128,
            },
        );

        expect(result.meta).toEqual({ total: 4, limit: 2, offset: 1, hasMore: true });
        expect(result.data.map((item) => item.id)).toEqual(["ctr-1", "ctr-2"]);
        expect(result.data[0]?.name).toBe("alpha");
        expect(result.data[1]?.name).toBe("beta");
        expect(dockerRepository.listContainers).not.toHaveBeenCalled();
    });

    it("falls back to local repository if mesh resolution fails", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => {
                throw new Error("mesh unavailable");
            }),
        };

        const dockerRepository = {
            listContainers: vi.fn(() => ({
                data: [createContainer({ id: "local-1", name: "local" })],
                meta: { total: 1, limit: 2, offset: 1, hasMore: false },
            })),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listContainers(baseInput);

        expect(dockerRepository.listContainers).toHaveBeenCalledWith(baseInput);
        expect(result.data.map((item) => item.id)).toEqual(["local-1"]);
        expect(result.meta.total).toBe(1);
    });

    it("groups containers server-side into single entries and deployment replica groups", async () => {
        const replicaPorts: DockerContainer["ports"] = [
            {
                containerPort: 3000,
                hostPort: 4100,
                protocol: "tcp",
            },
        ];

        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => createMeshListResult([
                {
                    data: [
                        createContainer({
                            id: "replica-a",
                            name: "web-1",
                            updatedAt: "2026-01-04T00:00:00.000Z",
                            overrides: {
                                managedBy: "deployment_service",
                                managedDeploymentId: "dep-1",
                                managedServiceId: "svc-1",
                                managedProjectId: "proj-1",
                                managedImageRef: "docker.io/acme/web:latest",
                                environment: "production",
                                ports: replicaPorts,
                            },
                        }),
                        createContainer({
                            id: "orphan-1",
                            name: "redis",
                            updatedAt: "2026-01-02T00:00:00.000Z",
                        }),
                        createContainer({
                            id: "shared-dup",
                            name: "queue",
                            status: "running",
                            updatedAt: "2026-01-01T00:00:00.000Z",
                        }),
                    ],
                    meta: { total: 3, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-a",
                    responderDaemonId: "daemon-shared-1",
                },
                {
                    data: [
                        createContainer({
                            id: "replica-b",
                            name: "web-2",
                            updatedAt: "2026-01-03T00:00:00.000Z",
                            overrides: {
                                managedBy: "deployment_service",
                                managedDeploymentId: "dep-1",
                                managedServiceId: "svc-1",
                                managedProjectId: "proj-1",
                                managedImageRef: "docker.io/acme/web:latest",
                                environment: "production",
                                ports: replicaPorts,
                            },
                        }),
                        createContainer({
                            id: "replica-a-mirror",
                            name: "web-1",
                            status: "dead",
                            updatedAt: "2026-01-06T00:00:00.000Z",
                            overrides: {
                                managedBy: "deployment_service",
                                managedDeploymentId: "dep-1",
                                managedServiceId: "svc-1",
                                managedProjectId: "proj-1",
                                managedImageRef: "docker.io/acme/web:latest",
                                environment: "production",
                                ports: replicaPorts,
                                createdAt: "2026-01-01T00:00:00.000Z",
                            },
                        }),
                        createContainer({
                            id: "shared-dup",
                            name: "queue",
                            status: "dead",
                            updatedAt: "2026-01-05T00:00:00.000Z",
                        }),
                    ],
                    meta: { total: 2, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-b",
                    responderDaemonId: "daemon-shared-1",
                },
            ], 2)),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listContainersGrouped({
            ...baseInput,
            limit: 50,
            offset: 0,
        });

        expect(result.meta.total).toBe(3);
        expect(result.diagnostics.hasSharedDaemonAcrossNodes).toBe(true);
        expect(result.diagnostics.sharedDaemonGroups).toEqual([
            {
                daemonId: "daemon-shared-1",
                nodeIds: ["node-a", "node-b"],
            },
        ]);

        const replicaGroup = result.data.find((entry) => entry.kind === "replica_group");
        expect(replicaGroup).toBeDefined();
        if (replicaGroup?.kind === "replica_group") {
            expect(replicaGroup.containers).toHaveLength(2);
            expect(replicaGroup.containers.map((container) => container.name).sort()).toEqual([
                "web-1",
                "web-2",
            ]);
            const web1Container = replicaGroup.containers.find((container) => container.name === "web-1");
            expect(web1Container?.status).toBe("dead");
        }

        const dedupedShared = result.data.find(
            (entry) => entry.kind === "single" && entry.container.id === "shared-dup",
        );
        expect(dedupedShared).toBeDefined();
        if (dedupedShared?.kind === "single") {
            expect(dedupedShared.container.status).toBe("dead");
        }
    });

    it("dedupes same-daemon mirrored entries during mesh merge even when container ids differ", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => createMeshListResult([
                {
                    data: [
                        createContainer({
                            id: "mirror-a",
                            name: "nextjs-nestjs-web-mesh-dev",
                            updatedAt: "2026-01-04T00:00:00.000Z",
                            overrides: {
                                managedBy: "deployment_service",
                                managedDeploymentId: "dep-mesh-web",
                                managedServiceId: "web-mesh",
                                managedProjectId: "mesh-project",
                                managedImageRef: "repo/web-mesh:latest",
                                environment: "development",
                                ports: [{ containerPort: 3000, hostPort: 3000, protocol: "tcp" }],
                            },
                        }),
                    ],
                    meta: { total: 1, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-a",
                    responderDaemonId: "daemon-shared-web",
                },
                {
                    data: [
                        createContainer({
                            id: "mirror-b",
                            name: "nextjs-nestjs-web-mesh-dev",
                            updatedAt: "2026-01-05T00:00:00.000Z",
                            overrides: {
                                managedBy: "deployment_service",
                                managedDeploymentId: "dep-mesh-web",
                                managedServiceId: "web-mesh",
                                managedProjectId: "mesh-project",
                                managedImageRef: "repo/web-mesh:latest",
                                environment: "development",
                                ports: [{ containerPort: 3000, hostPort: 3000, protocol: "tcp" }],
                            },
                        }),
                    ],
                    meta: { total: 1, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-b",
                    responderDaemonId: "daemon-shared-web",
                },
            ], 2)),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listContainersGrouped({
            ...baseInput,
            limit: 10,
            offset: 0,
        });

        expect(result.meta.total).toBe(1);
        expect(result.data).toHaveLength(1);
        expect(result.data[0]?.kind).toBe("single");
    });

    it("returns local repository list in local-only mode without mesh fanout", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => {
                throw new Error("mesh should not be called in local-only mode");
            }),
        };

        const dockerRepository = {
            listContainers: vi.fn(() => ({
                data: [createContainer({ id: "local-only-1", name: "local-only" })],
                meta: { total: 1, limit: 2, offset: 1, hasMore: false },
            })),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listContainers(baseInput, { localOnly: true });

        expect(dockerContainerMeshService.listContainersAcrossInstances).not.toHaveBeenCalled();
        expect(dockerRepository.listContainers).toHaveBeenCalledWith(baseInput);
        expect(result.data.map((item) => item.id)).toEqual(["local-only-1"]);
    });

    it("uses local-only header in peer fallback requests to prevent recursive mesh fanout", async () => {
        const originalDevAuthKey = process.env.DEV_AUTH_KEY;
        process.env.DEV_AUTH_KEY = "test-dev-key";

        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => createMeshListResult([
                {
                    data: [createContainer({ id: "mesh-1", name: "mesh-1" })],
                    meta: { total: 1, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-a",
                },
            ], 2)),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
        };

        const systemMeshTopologyService = {
            listPeerSessions: vi.fn(() => ({
                items: [
                    {
                        state: "connected",
                        peerNodeId: "node-b",
                        endpointUrl: "ws://node-b.example.test/mesh",
                        metadata: { serverUrl: "http://node-b.example.test" },
                    },
                ],
            })),
        };
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const fetchMock = vi.fn(async (_input: unknown, _init?: RequestInit) => ({
            ok: true,
            json: async () => ({ data: [] }),
        }));
        vi.stubGlobal("fetch", fetchMock);

        try {
            const service = new DockerContainerResolutionService(
                dockerContainerMeshService as never,
                dockerRepository as never,
                systemMeshTopologyService as never,
                meshInternalRequestService as never,
            );

            await service.listContainers(baseInput);

            expect(fetchMock).toHaveBeenCalledTimes(1);
            const requestInit = fetchMock.mock.calls[0]?.[1];
            const headers = requestInit?.headers as Record<string, string> | undefined;
            expect(headers?.["x-mesh-local-only"]).toBe("1");
        } finally {
            vi.unstubAllGlobals();
            if (typeof originalDevAuthKey === "undefined") {
                delete process.env.DEV_AUTH_KEY;
            } else {
                process.env.DEV_AUTH_KEY = originalDevAuthKey;
            }
        }
    });

    it("retries aborted peer fallback once and recovers additional mesh responses", async () => {
        const originalDevAuthKey = process.env.DEV_AUTH_KEY;
        process.env.DEV_AUTH_KEY = "test-dev-key";

        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(() => createMeshListResult([
                {
                    data: [createContainer({ id: "mesh-1", name: "mesh-1" })],
                    meta: { total: 1, limit: 500, offset: 0, hasMore: false },
                    responderNodeId: "node-a",
                },
            ], 2)),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
        };

        const systemMeshTopologyService = {
            listPeerSessions: vi.fn(() => ({
                items: [
                    {
                        state: "connected",
                        peerNodeId: "node-b",
                        endpointUrl: "ws://node-b.example.test/mesh",
                        metadata: { serverUrl: "http://node-b.example.test" },
                    },
                ],
            })),
        };
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const abortError = Object.assign(new Error("operation was aborted"), { name: "AbortError" });
        const fetchMock = vi
            .fn()
            .mockRejectedValueOnce(abortError)
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ data: [createContainer({ id: "peer-1", name: "peer-1" })] }),
            });
        vi.stubGlobal("fetch", fetchMock);

        try {
            const service = new DockerContainerResolutionService(
                dockerContainerMeshService as never,
                dockerRepository as never,
                systemMeshTopologyService as never,
                meshInternalRequestService as never,
            );

            const result = await service.listContainers({
                ...baseInput,
                limit: 10,
                offset: 0,
            });

            expect(fetchMock).toHaveBeenCalledTimes(2);
            expect(result.meta.total).toBe(2);
            expect(result.data.map((item) => item.id).sort()).toEqual(["mesh-1", "peer-1"]);
        } finally {
            vi.unstubAllGlobals();
            if (typeof originalDevAuthKey === "undefined") {
                delete process.env.DEV_AUTH_KEY;
            } else {
                process.env.DEV_AUTH_KEY = originalDevAuthKey;
            }
        }
    });

    it("falls back to mesh inspect when local inspect misses and picks the newest generatedAt", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(),
            inspectContainerAcrossInstances: vi.fn(() => ({
                responses: [
                    {
                        detail: {
                            containerId: "ctr-1",
                            generatedAt: "2026-01-01T10:00:00.000Z",
                            layers: [],
                            processes: [],
                            streamingLogsSupported: true,
                            networkConfig: [],
                            portMappings: [],
                            mounts: [],
                            environment: [],
                            runtimeConfig: {
                                user: null,
                                workingDir: null,
                                entrypoint: [],
                                command: [],
                                restartPolicy: "no",
                                restartMaxRetries: null,
                                privileged: false,
                                readOnlyRootFs: false,
                                oomKillDisable: false,
                                ipcMode: null,
                                pidMode: null,
                                networkMode: null,
                                cgroupnsMode: null,
                                watchMode: "disabled",
                                healthcheckCommand: null,
                                healthcheckIntervalSec: null,
                                healthcheckTimeoutSec: null,
                                healthcheckRetries: null,
                            },
                            composeConfig: null,
                        },
                        responderNodeId: "node-a",
                    },
                    {
                        detail: {
                            containerId: "ctr-1",
                            generatedAt: "2026-01-01T11:00:00.000Z",
                            layers: [],
                            processes: [],
                            streamingLogsSupported: true,
                            networkConfig: [],
                            portMappings: [],
                            mounts: [],
                            environment: [],
                            runtimeConfig: {
                                user: "root",
                                workingDir: "/app",
                                entrypoint: [],
                                command: [],
                                restartPolicy: "always",
                                restartMaxRetries: null,
                                privileged: false,
                                readOnlyRootFs: false,
                                oomKillDisable: false,
                                ipcMode: null,
                                pidMode: null,
                                networkMode: "bridge",
                                cgroupnsMode: null,
                                watchMode: "vite",
                                healthcheckCommand: null,
                                healthcheckIntervalSec: null,
                                healthcheckTimeoutSec: null,
                                healthcheckRetries: null,
                            },
                            composeConfig: null,
                        },
                        responderNodeId: "node-b",
                    },
                ],
            })),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
            inspectContainer: vi.fn(() => {
                throw new NotFoundException("Container 'ctr-1' not found");
            }),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const detail = await service.inspectContainer("ctr-1");

        expect(dockerContainerMeshService.inspectContainerAcrossInstances).toHaveBeenCalledWith(
            { query: { containerId: "ctr-1" } },
            { timeoutMs: 1_500, maxCollectedResponses: 16 },
        );
        expect(detail.generatedAt).toBe("2026-01-01T11:00:00.000Z");
        expect(detail.runtimeConfig.watchMode).toBe("vite");
        expect(dockerRepository.inspectContainer).toHaveBeenCalledWith("ctr-1");
    });

    it("returns local inspect directly without mesh fanout when local inspect succeeds", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(),
            inspectContainerAcrossInstances: vi.fn(() => {
                throw new Error("mesh inspect unavailable");
            }),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
            inspectContainer: vi.fn(() => ({
                containerId: "local-ctr",
                generatedAt: "2026-01-01T12:00:00.000Z",
                layers: [],
                processes: [],
                streamingLogsSupported: true,
                networkConfig: [],
                portMappings: [],
                mounts: [],
                environment: [],
                runtimeConfig: {
                    user: null,
                    workingDir: null,
                    entrypoint: [],
                    command: [],
                    restartPolicy: "no",
                    restartMaxRetries: null,
                    privileged: false,
                    readOnlyRootFs: false,
                    oomKillDisable: false,
                    ipcMode: null,
                    pidMode: null,
                    networkMode: null,
                    cgroupnsMode: null,
                    watchMode: "disabled",
                    healthcheckCommand: null,
                    healthcheckIntervalSec: null,
                    healthcheckTimeoutSec: null,
                    healthcheckRetries: null,
                },
                composeConfig: null,
            })),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const detail = await service.inspectContainer("local-ctr");

        expect(dockerRepository.inspectContainer).toHaveBeenCalledWith("local-ctr");
        expect(dockerContainerMeshService.inspectContainerAcrossInstances).not.toHaveBeenCalled();
        expect(detail.containerId).toBe("local-ctr");
    });

    it("rethrows local not-found when mesh has no inspect response", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(),
            inspectContainerAcrossInstances: vi.fn(() => ({
                responses: [],
            })),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
            inspectContainer: vi.fn(() => {
                throw new NotFoundException("Container 'ghost-ctr' not found");
            }),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        await expect(service.inspectContainer("ghost-ctr")).rejects.toBeInstanceOf(NotFoundException);
        expect(dockerRepository.inspectContainer).toHaveBeenCalledTimes(1);
        expect(dockerContainerMeshService.inspectContainerAcrossInstances).toHaveBeenCalledWith(
            { query: { containerId: "ghost-ctr" } },
            { timeoutMs: 1_500, maxCollectedResponses: 16 },
        );
    });

    it("lists images from mesh runtime catalog responses", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(),
            inspectContainerAcrossInstances: vi.fn(),
            listRuntimeCatalogAcrossInstances: vi.fn(() => ({
                responses: [
                    {
                        catalog: createRuntimeCatalog("img-1"),
                        responderNodeId: "node-a",
                    },
                    {
                        catalog: createRuntimeCatalog("img-2"),
                        responderNodeId: "node-b",
                    },
                ],
            })),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
            inspectContainer: vi.fn(),
            getRuntimeCatalogSnapshot: vi.fn(),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listImages(imageListInput);

        expect(dockerContainerMeshService.listRuntimeCatalogAcrossInstances).toHaveBeenCalledWith(
            {},
            {
                timeoutMs: 2_000,
                maxCollectedResponses: 128,
            },
        );
        expect(result.meta.total).toBe(2);
        expect(result.data.map((item) => item.id).sort()).toEqual(["img-1", "img-2"]);
        expect(dockerRepository.getRuntimeCatalogSnapshot).not.toHaveBeenCalled();
    });

    it("normalizes placeholder image repository entries from mesh runtime catalog responses", async () => {
        const catalogWithPlaceholderImage = createRuntimeCatalog("img-valid");
        catalogWithPlaceholderImage.images.push({
            id: "img-placeholder",
            registry: "undefined",
            repository: "undefined",
            tag: "latest",
            digest: null,
            sizeBytes: null,
            createdAt: "2026-01-01T00:00:00.000Z",
            lastSeenAt: "2026-01-03T00:00:00.000Z",
            labels: {},
        });

        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(),
            inspectContainerAcrossInstances: vi.fn(),
            listRuntimeCatalogAcrossInstances: vi.fn(() => ({
                responses: [
                    {
                        catalog: catalogWithPlaceholderImage,
                        responderNodeId: "node-a",
                    },
                ],
            })),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
            inspectContainer: vi.fn(),
            getRuntimeCatalogSnapshot: vi.fn(),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listImages(imageListInput);

        expect(result.meta.total).toBe(2);
        expect(result.data.map((item) => item.id).sort()).toEqual(["img-placeholder", "img-valid"]);

        const placeholderImage = result.data.find((item) => item.id === "img-placeholder");
        expect(placeholderImage).toBeDefined();
        expect(placeholderImage?.registry).toBe("local");
        expect(placeholderImage?.repository).toBe("untagged/img-placehol");
    });

    it("falls back to local runtime catalog when mesh runtime catalog call fails", async () => {
        const dockerContainerMeshService = {
            listContainersAcrossInstances: vi.fn(),
            inspectContainerAcrossInstances: vi.fn(),
            listRuntimeCatalogAcrossInstances: vi.fn(() => {
                throw new Error("mesh runtime catalog unavailable");
            }),
        };

        const dockerRepository = {
            listContainers: vi.fn(),
            inspectContainer: vi.fn(),
            getRuntimeCatalogSnapshot: vi.fn(() => createRuntimeCatalog("img-local")),
        };

        const systemMeshTopologyService = createTopologyStub();
        const meshInternalRequestService = createMeshInternalRequestServiceStub();

        const service = new DockerContainerResolutionService(
            dockerContainerMeshService as never,
            dockerRepository as never,
            systemMeshTopologyService as never,
            meshInternalRequestService as never,
        );

        const result = await service.listImages(imageListInput);

        expect(dockerRepository.getRuntimeCatalogSnapshot).toHaveBeenCalledTimes(1);
        expect(result.meta.total).toBe(1);
        expect(result.data[0]?.id).toBe("img-local");
    });
});
