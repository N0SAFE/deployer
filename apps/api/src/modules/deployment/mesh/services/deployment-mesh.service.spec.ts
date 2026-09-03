import { describe, it, expect, vi } from "vitest";
import { DeploymentMeshService } from "./deployment-mesh.service";
import type { SystemMeshTopicService } from "@/core/modules/mesh/services/system-mesh-topic/orchestrator/system-mesh-topic.service";
import type { SystemMeshTopologyService } from "@/core/modules/mesh/services/system-mesh-topology/orchestrator/system-mesh-topology.service";
import { Subject } from "rxjs";

function createMockHandle() {
    // Topic scheme mirrors BaseMeshService.derive*Topic — the CURRENT names
    // (`deployment-internal:deployments:<op>:req|res|cancel`), not the legacy
    // camelCase ones. publish() routes envelopes to the topic subject so
    // observe$ subscribers (callMany + registerCallHandler) see them exactly
    // like the real mesh event bus.
    const t = (entity: string, op: string, suffix: "req" | "res" | "cancel") =>
        `deployment-internal:${entity}:${op}:${suffix}`;

    const subjects = new Map<string, Subject<unknown>>();
    const subjectFor = (topic: string): Subject<unknown> => {
        let subject = subjects.get(topic);
        if (!subject) {
            subject = new Subject<unknown>();
            subjects.set(topic, subject);
        }
        return subject;
    };

    const handle = {
        namespace: "deployment-internal",
        topics: [
            t("deployments", "resolve", "req"),
            t("deployments", "resolve", "res"),
            t("deployments", "resolve", "cancel"),
            t("deployments", "search", "req"),
            t("deployments", "search", "res"),
            t("deployments", "search", "cancel"),
            t("deployments", "list", "req"),
            t("deployments", "list", "res"),
            t("deployments", "list", "cancel"),
        ],
        publish: vi.fn((topic: string, _input: unknown, envelope: unknown) => {
            subjectFor(topic).next(envelope);
        }),
        observe$: vi.fn((topic: string) => subjectFor(topic).asObservable()),
        subscribe: vi.fn(),
        queryByInput$: vi.fn(),
        lookupRoute: vi.fn(),
        request: vi.fn(),
        registerQueryHandler: vi.fn(),
    };

    return {
        handle,
        subjectFor,
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

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000001",
                        serviceId: "00000000-0000-4000-8000-000000000501",
                        status: "ready",
                        environment: "prod",
                        ownerNodeId: "00000000-0000-4000-8000-000000000010",
                        metadata: null,
                    },
                ],
                total: 1,
            },
        }));

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000002",
                        serviceId: "00000000-0000-4000-8000-000000000502",
                        status: "building",
                        environment: "staging",
                        ownerNodeId: "00000000-0000-4000-8000-000000000011",
                        metadata: null,
                    },
                ],
                total: 1,
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

        // Two independent responders → merged into one result set.
        expect(result.items).toHaveLength(2);
        expect(result.total).toBe(2);
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

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000011",
                        serviceId: "00000000-0000-4000-8000-000000000511",
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

    it("enforces bounded fanout collection via maxCollectedResponses", async () => {
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

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000021",
                        serviceId: "00000000-0000-4000-8000-000000000521",
                        status: "ready",
                        environment: "prod",
                        ownerNodeId: "00000000-0000-4000-8000-000000000010",
                        metadata: null,
                    },
                ],
                total: 1,
            },
        }));

        service.registerSearchDeploymentsHandler(() => ({
            payload: {
                items: [
                    {
                        deploymentId: "00000000-0000-4000-8000-000000000022",
                        serviceId: "00000000-0000-4000-8000-000000000522",
                        status: "building",
                        environment: "staging",
                        ownerNodeId: "00000000-0000-4000-8000-000000000011",
                        metadata: null,
                    },
                ],
                total: 1,
            },
        }));

        const result = await service.searchDeploymentsAcrossInstances(
            {
                query: "api",
                limit: 25,
            },
            {
                timeoutMs: 150,
                maxCollectedResponses: 1,
            },
        );

        // Two responders offered 2 unique items; the collection cap keeps the
        // merged result bounded to the single collected response.
        expect(result.items).toHaveLength(1);
        expect(result.total).toBeLessThanOrEqual(2);
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
