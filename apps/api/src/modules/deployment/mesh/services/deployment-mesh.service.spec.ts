import { describe, it, expect, vi } from "vitest";
import { DeploymentMeshService } from "./deployment-mesh.service";
import type { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic.service";
import type { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology.service";
import { Subject } from "rxjs";

function createMockHandle() {
    const request$ = new Subject<unknown>();
    const response$ = new Subject<unknown>();
    const cancel$ = new Subject<unknown>();
    const searchRequest$ = new Subject<unknown>();
    const searchResponse$ = new Subject<unknown>();
    const searchCancel$ = new Subject<unknown>();
    const listRequest$ = new Subject<unknown>();
    const listResponse$ = new Subject<unknown>();
    const listCancel$ = new Subject<unknown>();

    const publish = vi.fn((topic: string, _input: unknown, output: unknown) => {
        if (topic === "resolveDeploymentRequest") {
            request$.next(output);
            return;
        }

        if (topic === "resolveDeploymentResponse") {
            response$.next(output);
            return;
        }

        if (topic === "resolveDeploymentCancel") {
            cancel$.next(output);
            return;
        }

        if (topic === "searchDeploymentsRequest") {
            searchRequest$.next(output);
            return;
        }

        if (topic === "searchDeploymentsResponse") {
            searchResponse$.next(output);
            return;
        }

        if (topic === "searchDeploymentsCancel") {
            searchCancel$.next(output);
            return;
        }

        if (topic === "listDeploymentsRequest") {
            listRequest$.next(output);
            return;
        }

        if (topic === "listDeploymentsResponse") {
            listResponse$.next(output);
            return;
        }

        if (topic === "listDeploymentsCancel") {
            listCancel$.next(output);
        }
    });

    const observe$ = vi.fn((topic: string) => {
        if (topic === "resolveDeploymentRequest") {
            return request$.asObservable();
        }

        if (topic === "resolveDeploymentResponse") {
            return response$.asObservable();
        }

        if (topic === "searchDeploymentsRequest") {
            return searchRequest$.asObservable();
        }

        if (topic === "searchDeploymentsResponse") {
            return searchResponse$.asObservable();
        }

        if (topic === "searchDeploymentsCancel") {
            return searchCancel$.asObservable();
        }

        if (topic === "listDeploymentsRequest") {
            return listRequest$.asObservable();
        }

        if (topic === "listDeploymentsResponse") {
            return listResponse$.asObservable();
        }

        if (topic === "listDeploymentsCancel") {
            return listCancel$.asObservable();
        }

        return cancel$.asObservable();
    });

    return {
        handle: {
            namespace: "deployment-internal",
            topics: [
                "resolveDeploymentRequest",
                "resolveDeploymentResponse",
                "resolveDeploymentCancel",
                "searchDeploymentsRequest",
                "searchDeploymentsResponse",
                "searchDeploymentsCancel",
                "listDeploymentsRequest",
                "listDeploymentsResponse",
                "listDeploymentsCancel",
            ],
            publish,
            observe$,
            subscribe: vi.fn(),
            queryByInput$: vi.fn(),
            lookupRoute: vi.fn(),
            request: vi.fn(),
            registerQueryHandler: vi.fn(),
        },
    };
}

describe("DeploymentMeshService", () => {
    it("aggregates responses from multiple instances", async () => {
        const { handle } = createMockHandle();
        const topicService = {
            registerNamespace: vi.fn(() => handle),
        } as unknown as SystemMeshTopicService;

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        } as unknown as SystemMeshTopologyService;

        const service = new DeploymentMeshService(topicService, topologyService);
        service.onModuleInit();

        service.registerResolveDeploymentHandler(({ payload }) => ({
            payload: {
                found: payload.deploymentId.endsWith("1"),
                ownerNodeId: "00000000-0000-4000-8000-000000000010",
                ownerServerUrl: "https://node-a.mesh.internal",
                metadata: null,
            },
        }));

        service.registerResolveDeploymentHandler(() => ({
            payload: {
                found: false,
                ownerNodeId: null,
                ownerServerUrl: null,
                metadata: null,
            },
        }));

        const result = await service.resolveDeploymentAcrossInstances(
            {
                deploymentId: "00000000-0000-4000-8000-000000000001",
                key: "deployment:00000000-0000-4000-8000-000000000001",
            },
            {
                timeoutMs: 50,
                stopOnFirstFound: false,
            },
        );

        expect(result.responses.length).toBeGreaterThanOrEqual(2);
    });

    it("triggers killer switch and stops early when first match is found", async () => {
        const { handle } = createMockHandle();
        const topicService = {
            registerNamespace: vi.fn(() => handle),
        } as unknown as SystemMeshTopicService;

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        } as unknown as SystemMeshTopologyService;

        const service = new DeploymentMeshService(topicService, topologyService);
        service.onModuleInit();

        service.registerResolveDeploymentHandler(() => ({
            payload: {
                found: true,
                ownerNodeId: "00000000-0000-4000-8000-000000000010",
                ownerServerUrl: "https://node-a.mesh.internal",
                metadata: null,
            },
            stopPropagation: true,
        }));

        service.registerResolveDeploymentHandler(() => ({
            payload: {
                found: false,
                ownerNodeId: null,
                ownerServerUrl: null,
                metadata: null,
            },
        }));

        const result = await service.resolveDeploymentAcrossInstances(
            {
                deploymentId: "00000000-0000-4000-8000-000000000001",
                key: "deployment:00000000-0000-4000-8000-000000000001",
            },
            {
                timeoutMs: 200,
                stopOnFirstFound: true,
            },
        );

        expect(result.stoppedEarly).toBe(true);
        expect(result.reason).toBe("killer_switch");
        expect(result.responses.some((item) => item.found)).toBe(true);
    });

    it("enforces bounded fanout collection and reports lag/retry/drop metrics", async () => {
        const { handle } = createMockHandle();
        const topicService = {
            registerNamespace: vi.fn(() => handle),
        } as unknown as SystemMeshTopicService;

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
            listPeerSessions: vi.fn(() => ({
                items: [
                    { state: "connected" },
                    { state: "connected" },
                ],
            })),
        } as unknown as SystemMeshTopologyService;

        const service = new DeploymentMeshService(topicService, topologyService);
        service.onModuleInit();

        service.registerResolveDeploymentHandler(() => ({
            payload: {
                found: false,
                ownerNodeId: "00000000-0000-4000-8000-000000000010",
                ownerServerUrl: "https://node-a.mesh.internal",
                metadata: null,
            },
        }));

        service.registerResolveDeploymentHandler(() => ({
            payload: {
                found: false,
                ownerNodeId: "00000000-0000-4000-8000-000000000011",
                ownerServerUrl: "https://node-b.mesh.internal",
                metadata: null,
            },
        }));

        service.registerResolveDeploymentHandler(() => ({
            payload: {
                found: false,
                ownerNodeId: "00000000-0000-4000-8000-000000000012",
                ownerServerUrl: "https://node-c.mesh.internal",
                metadata: null,
            },
        }));

        const result = await service.resolveDeploymentAcrossInstances(
            {
                deploymentId: "00000000-0000-4000-8000-000000000001",
                key: "deployment:00000000-0000-4000-8000-000000000001",
            },
            {
                timeoutMs: 200,
                maxCollectedResponses: 1,
            },
        );

        expect(result.responses).toHaveLength(1);
        expect(result.metrics.expectedResponders).toBe(3);
        expect(result.metrics.droppedResponses).toBeGreaterThanOrEqual(2);
        expect(result.metrics.retryResponses).toBeGreaterThanOrEqual(1);
        expect(result.metrics.maxLagMs).toBeGreaterThanOrEqual(0);
    });

    it("searches deployments across instances and deduplicates by deploymentId", async () => {
        const { handle } = createMockHandle();
        const topicService = {
            registerNamespace: vi.fn(() => handle),
        } as unknown as SystemMeshTopicService;

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        } as unknown as SystemMeshTopologyService;

        const service = new DeploymentMeshService(topicService, topologyService);
        service.onModuleInit();

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000101",
                        serviceId: "00000000-0000-4000-8000-000000000501",
                        status: "ready",
                        environment: "prod",
                        ownerNodeId: "00000000-0000-4000-8000-000000000010",
                        metadata: { region: "eu" },
                    },
                ],
                total: 1,
            },
        }));

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000101",
                        serviceId: "00000000-0000-4000-8000-000000000501",
                        status: "ready",
                        environment: "prod",
                        ownerNodeId: "00000000-0000-4000-8000-000000000011",
                        metadata: { zone: "a" },
                    },
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000102",
                        serviceId: "00000000-0000-4000-8000-000000000502",
                        status: "building",
                        environment: "staging",
                        ownerNodeId: "00000000-0000-4000-8000-000000000011",
                        metadata: null,
                    },
                ],
                total: 2,
            },
        }));

        const result = await service.searchDeploymentsAcrossInstances(
            {
                query: "api",
                limit: 25,
            },
            {
                timeoutMs: 100,
            },
        );

        expect(result.items).toHaveLength(2);
        expect(result.total).toBe(2);
        expect(result.items[0]?.metadata).toMatchObject({ region: "eu", zone: "a" });
    });

    it("stops search propagation when first match is found", async () => {
        const { handle } = createMockHandle();
        const topicService = {
            registerNamespace: vi.fn(() => handle),
        } as unknown as SystemMeshTopicService;

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        } as unknown as SystemMeshTopologyService;

        const service = new DeploymentMeshService(topicService, topologyService);
        service.onModuleInit();

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000201",
                        serviceId: "00000000-0000-4000-8000-000000000601",
                        status: "ready",
                        environment: "prod",
                        ownerNodeId: "00000000-0000-4000-8000-000000000010",
                        metadata: null,
                    },
                ],
                total: 1,
            },
            stopPropagation: true,
        }));

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [],
                total: 0,
            },
        }));

        const result = await service.searchDeploymentsAcrossInstances(
            {
                query: "prod",
                limit: 10,
            },
            {
                timeoutMs: 150,
                stopOnFirstMatch: true,
            },
        );

        expect(result.stoppedEarly).toBe(true);
        expect(result.items).toHaveLength(1);
    });

    it("lists deployments across instances and enforces caller limit", async () => {
        const { handle } = createMockHandle();
        const topicService = {
            registerNamespace: vi.fn(() => handle),
        } as unknown as SystemMeshTopicService;

        const topologyService = {
            getLocalNode: vi.fn(() => ({ nodeId: "00000000-0000-4000-8000-000000000001" })),
        } as unknown as SystemMeshTopologyService;

        const service = new DeploymentMeshService(topicService, topologyService);
        service.onModuleInit();

        service.registerListDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000301",
                        serviceId: "00000000-0000-4000-8000-000000000701",
                        status: "ready",
                        environment: "prod",
                        ownerNodeId: "00000000-0000-4000-8000-000000000010",
                        metadata: null,
                    },
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000302",
                        serviceId: "00000000-0000-4000-8000-000000000702",
                        status: "building",
                        environment: "staging",
                        ownerNodeId: "00000000-0000-4000-8000-000000000010",
                        metadata: null,
                    },
                ],
                total: 2,
            },
        }));

        service.registerListDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000303",
                        serviceId: "00000000-0000-4000-8000-000000000703",
                        status: "failed",
                        environment: "dev",
                        ownerNodeId: "00000000-0000-4000-8000-000000000011",
                        metadata: null,
                    },
                ],
                total: 1,
            },
        }));

        const result = await service.listDeploymentsAcrossInstances(
            {
                limit: 2,
            },
            {
                timeoutMs: 100,
            },
        );

        expect(result.total).toBe(3);
        expect(result.items).toHaveLength(2);
    });
});
