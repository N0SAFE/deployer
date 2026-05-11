import { describe, expect, it, vi } from "vitest";
import { randomUUID } from "node:crypto";
import z from "zod/v4";
import { contractBuilder } from "@/core/modules/events/event-contract.builder";
import { SystemMeshTopicService } from "../system-mesh-topic/orchestrator/system-mesh-topic.service";
import type { SystemMeshTopologyService } from "../system-mesh-topology/orchestrator/system-mesh-topology.service";

describe("SystemMeshTopicService", () => {
    const createTopologyStub = () => {
        let onEnvelope: ((envelope: unknown) => void) | null = null;
        const localNode = {
            nodeId: randomUUID(),
            region: "local",
            roles: ["edge"] as const,
            lifecycleState: "healthy" as const,
            routingMode: "balanced" as const,
            consistencyMode: "hybrid" as const,
            version: "test",
            startedAt: new Date().toISOString(),
            lastSeenAt: new Date().toISOString(),
            metadata: null,
        };

        return {
            getLocalNode: vi.fn(() => localNode),
            upsertResourceIndex: vi.fn(() => ({
                accepted: true,
                sourceNodeId: localNode.nodeId,
                upserted: 0,
                replaced: 0,
            })),
            publishControlEnvelope: vi.fn(() => ({
                accepted: true,
                envelopeId: randomUUID(),
                forwardedTo: [],
            })),
            lookupResource: vi.fn(() => ({
                found: false,
                query: {
                    organizationId: null,
                    kind: "topic",
                    key: "",
                    includeCandidates: true,
                },
                primary: null,
                candidates: [],
            })),
            registerControlEnvelopeHandler: vi.fn((handler: (envelope: unknown) => void) => {
                onEnvelope = handler;
                return () => {
                    onEnvelope = null;
                };
            }),
            __emitEnvelope: (envelope: unknown) => {
                onEnvelope?.(envelope);
            },
        } as unknown as Pick<
            SystemMeshTopologyService,
            "getLocalNode" | "upsertResourceIndex" | "publishControlEnvelope" | "lookupResource" | "registerControlEnvelopeHandler"
        > & {
            __emitEnvelope: (envelope: unknown) => void;
        };
    };

    it("registers namespace and indexes topic resources", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "deployments",
            contracts: {
                statusChanged: contractBuilder()
                    .input(
                        z.object({
                            organizationId: z.uuid().nullable().optional(),
                            deploymentId: z.uuid(),
                        }),
                    )
                    .output(
                        z.object({
                            state: z.enum(["queued", "running", "failed", "succeeded"]),
                        }),
                    )
                    .build(),
            },
        });

        expect(handle.namespace).toBe("deployments");
        expect(handle.topics).toEqual(["statusChanged"]);
        expect(topology.upsertResourceIndex).toHaveBeenCalledTimes(1);
    });

    it("publishes locally and propagates through mesh envelope by default", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();
        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                indexUpdated: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), topic: z.string() }))
                    .output(z.object({ affected: z.number().int().min(0) }))
                    .build(),
            },
        });

        handle.publish(
            "indexUpdated",
            { topic: "projects" },
            { affected: 3 },
            { organizationId: randomUUID() },
        );

        expect(topology.publishControlEnvelope).toHaveBeenCalledTimes(1);
        expect(topology.publishControlEnvelope).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "event_publish",
                payload: expect.objectContaining({
                    event: expect.objectContaining({
                        aggregateType: "search",
                        aggregateId: "search:indexUpdated",
                        eventType: "indexUpdated",
                        version: "1",
                        payload: expect.objectContaining({
                            namespace: "search",
                            topic: "indexUpdated",
                        }),
                    }),
                }),
            }),
        );
    });

    it("supports type-safe observe subscription and lookup route", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();
        const handle = service.registerNamespace({
            namespace: "internal-search",
            contracts: {
                query: contractBuilder()
                    .input(
                        z.object({
                            organizationId: z.uuid().nullable().optional(),
                            q: z.string(),
                        }),
                    )
                    .output(
                        z.object({
                            ids: z.array(z.uuid()),
                        }),
                    )
                    .build(),
            },
        });

        const seen: string[][] = [];
        const subscription = handle.observe$("query", { q: "repo" }).subscribe((event) => {
            seen.push(event.ids);
        });

        const id = randomUUID();
        handle.publish("query", { q: "repo" }, { ids: [id] }, { propagate: false });
        subscription.unsubscribe();

        expect(seen).toEqual([[id]]);

        handle.lookupRoute("query", { organizationId: null, includeCandidates: true });
        expect(topology.lookupResource).toHaveBeenCalledWith(
            expect.objectContaining({
                kind: "topic",
                key: "topic:internal-search:query",
            }),
        );
    });

    it("consumes remote event_publish envelopes and dispatches typed topic payloads", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                queryResult: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), query: z.string() }))
                    .output(z.object({ matches: z.array(z.string()) }))
                    .build(),
            },
        });

        const received: string[][] = [];
        const sub = handle.observe$("queryResult", { query: "deploy" }).subscribe((output) => {
            received.push(output.matches);
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId: "search:queryResult",
                    eventType: "queryResult",
                    version: "1",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["svc-1", "svc-2"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
                sequence: 1,
            },
        });

        sub.unsubscribe();
        service.onModuleDestroy();

        expect(received).toEqual([["svc-1", "svc-2"]]);
    });

    it("ignores malformed event_publish envelopes that do not match typed global event payload", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                queryResult: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), query: z.string() }))
                    .output(z.object({ matches: z.array(z.string()) }))
                    .build(),
            },
        });

        const received: string[][] = [];
        const sub = handle.observe$("queryResult", { query: "deploy" }).subscribe((output) => {
            received.push(output.matches);
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                namespace: "search",
                topic: "queryResult",
                input: { query: "deploy" },
                output: { matches: ["svc-1", "svc-2"] },
            },
        });

        sub.unsubscribe();
        service.onModuleDestroy();

        expect(received).toEqual([]);
    });

    it("treats duplicate event_publish envelopes as idempotent no-op", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                queryResult: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), query: z.string() }))
                    .output(z.object({ matches: z.array(z.string()) }))
                    .build(),
            },
        });

        const received: string[][] = [];
        const sub = handle.observe$("queryResult", { query: "deploy" }).subscribe((output) => {
            received.push(output.matches);
        });

        const duplicateEventId = randomUUID();
        const envelopePayload = {
            event: {
                eventId: duplicateEventId,
                aggregateType: "search",
                aggregateId: "search:queryResult",
                eventType: "queryResult",
                version: "1",
                occurredAt: new Date().toISOString(),
                payload: {
                    namespace: "search",
                    topic: "queryResult",
                    input: { query: "deploy" },
                    output: { matches: ["svc-1", "svc-2"] },
                },
                metadata: {
                    namespace: "search",
                    topic: "queryResult",
                },
            },
            sequence: 1,
        };

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: envelopePayload,
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: envelopePayload,
        });

        sub.unsubscribe();
        service.onModuleDestroy();

        expect(received).toEqual([["svc-1", "svc-2"]]);
    });

    it("allows redelivery of same eventId when first delivery fails contract emission", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                queryResult: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), query: z.string() }))
                    .output(z.object({ matches: z.array(z.string()) }))
                    .build(),
            },
        });

        const received: string[][] = [];
        const sub = handle.observe$("queryResult", { query: "deploy" }).subscribe((output) => {
            received.push(output.matches);
        });

        const replayedEventId = randomUUID();

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                event: {
                    eventId: replayedEventId,
                    aggregateType: "search",
                    aggregateId: "search:queryResult",
                    eventType: "queryResult",
                    version: "1",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: "invalid-shape" },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
                sequence: 1,
            },
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                event: {
                    eventId: replayedEventId,
                    aggregateType: "search",
                    aggregateId: "search:queryResult",
                    eventType: "queryResult",
                    version: "1",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["svc-replayed"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
                sequence: 2,
            },
        });

        sub.unsubscribe();
        service.onModuleDestroy();

        expect(received).toEqual([["svc-replayed"]]);
    });

    it("enforces per-aggregate sequence ordering under shuffled replay delivery", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                queryResult: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), query: z.string() }))
                    .output(z.object({ matches: z.array(z.string()) }))
                    .build(),
            },
        });

        const received: string[][] = [];
        const sub = handle.observe$("queryResult", { query: "deploy" }).subscribe((output) => {
            received.push(output.matches);
        });

        const aggregateId = "search:queryResult";
        const baseEnvelope = {
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
        } as const;

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            ...baseEnvelope,
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId,
                    eventType: "queryResult",
                    version: "2",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["seq-2"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
                sequence: 2,
            },
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            ...baseEnvelope,
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId,
                    eventType: "queryResult",
                    version: "1",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["seq-1-stale"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
                sequence: 1,
            },
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            ...baseEnvelope,
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId,
                    eventType: "queryResult",
                    version: "3",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["seq-3"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
                sequence: 3,
            },
        });

        sub.unsubscribe();
        service.onModuleDestroy();

        expect(received).toEqual([["seq-2"], ["seq-3"]]);
    });

    it("enforces aggregate version guard when sequence is absent", () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                queryResult: contractBuilder()
                    .input(z.object({ organizationId: z.uuid().nullable().optional(), query: z.string() }))
                    .output(z.object({ matches: z.array(z.string()) }))
                    .build(),
            },
        });

        const received: string[][] = [];
        const sub = handle.observe$("queryResult", { query: "deploy" }).subscribe((output) => {
            received.push(output.matches);
        });

        const aggregateId = "search:queryResult:version-only";

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId,
                    eventType: "queryResult",
                    version: "5",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["version-5"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
            },
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId,
                    eventType: "queryResult",
                    version: "4",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["version-4-stale"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
            },
        });

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                event: {
                    eventId: randomUUID(),
                    aggregateType: "search",
                    aggregateId,
                    eventType: "queryResult",
                    version: "6",
                    occurredAt: new Date().toISOString(),
                    payload: {
                        namespace: "search",
                        topic: "queryResult",
                        input: { query: "deploy" },
                        output: { matches: ["version-6"] },
                    },
                    metadata: {
                        namespace: "search",
                        topic: "queryResult",
                    },
                },
            },
        });

        sub.unsubscribe();
        service.onModuleDestroy();

        expect(received).toEqual([["version-5"], ["version-6"]]);
    });

    it("supports typed request/reply over mesh envelopes", async () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "query",
            contracts: {
                findProject: contractBuilder()
                    .input(z.object({ query: z.string() }))
                    .output(z.object({ ids: z.array(z.string()) }))
                    .build(),
                findProjectResult: contractBuilder()
                    .input(z.object({ query: z.string() }))
                    .output(z.object({ ids: z.array(z.string()) }))
                    .build(),
            },
        });

        const localNode = topology.getLocalNode();
        const pendingPromise = handle.request("findProject", "findProjectResult", { query: "api" }, { timeoutMs: 500 });

        const publishMock = topology.publishControlEnvelope as unknown as ReturnType<typeof vi.fn>;
        const publishCalls = publishMock.mock.calls;
        expect(publishCalls.length).toBeGreaterThan(0);
        const lastPublish = publishCalls.at(-1);
        if (!lastPublish) {
            throw new Error("Expected a request envelope publish call");
        }

        const requestEnvelope = lastPublish[0] as {
            payload: { queryId: string };
        };

        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: randomUUID(),
            targetNodeId: localNode.nodeId,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                kind: "topic_query_response",
                queryId: requestEnvelope.payload.queryId,
                namespace: "query",
                responseTopic: "findProjectResult",
                output: { ids: ["project-1"] },
            },
        });

        await expect(pendingPromise).resolves.toEqual({ ids: ["project-1"] });
    });

    it("executes registered query handler and publishes response envelope", async () => {
        const topology = createTopologyStub();
        const service = new SystemMeshTopicService(topology as unknown as SystemMeshTopologyService);
        service.onModuleInit();

        const handle = service.registerNamespace({
            namespace: "search",
            contracts: {
                findService: contractBuilder()
                    .input(z.object({ q: z.string() }))
                    .output(z.object({ results: z.array(z.string()) }))
                    .build(),
                findServiceResult: contractBuilder()
                    .input(z.object({ q: z.string() }))
                    .output(z.object({ results: z.array(z.string()) }))
                    .build(),
            },
        });

        handle.registerQueryHandler("findService", "findServiceResult", (input) => ({
            results: [`${input.q}:svc`],
        }));

        const remoteNodeId = randomUUID();
        topology.__emitEnvelope({
            envelopeId: randomUUID(),
            organizationId: null,
            type: "event_publish",
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                kind: "topic_query_request",
                queryId: randomUUID(),
                namespace: "search",
                requestTopic: "findService",
                responseTopic: "findServiceResult",
                input: { q: "mesh" },
            },
        });

        await new Promise<void>((resolve) => {
            setTimeout(() => resolve(), 0);
        });

        expect(topology.publishControlEnvelope).toHaveBeenCalledWith(
            expect.objectContaining({
                targetNodeId: remoteNodeId,
                payload: expect.objectContaining({
                    kind: "topic_query_response",
                    namespace: "search",
                    responseTopic: "findServiceResult",
                }),
            }),
        );
    });
});
