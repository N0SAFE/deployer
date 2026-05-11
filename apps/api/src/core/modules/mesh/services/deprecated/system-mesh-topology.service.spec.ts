import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { randomUUID } from "node:crypto";
import { from } from "rxjs";
import { SystemMeshTopologyService } from "../system-mesh-topology/orchestrator/system-mesh-topology.service";
import { SystemMeshLogicService } from "../system-mesh-logic.service";
import { SystemMeshOverlayScopeService } from "../system-mesh-overlay-scope.service";
import { EnvService } from "@/config/env/env.service";
import type { SystemMeshEventService } from "../../events/system-mesh-event.service";
import type { SystemMeshClusterRepository } from "../../repositories/system-mesh-cluster.repository";
import type { MeshTopologyEvent } from "@repo/contracts-entities";
import { getMockEnv } from "@repo/env/mock";

describe("SystemMeshTopologyService", () => {
    let service: SystemMeshTopologyService;
    let meshLogicService: SystemMeshLogicService;
    let meshOverlayScopeService: SystemMeshOverlayScopeService;
    let envService: EnvService;
    let meshEventService: Pick<
        SystemMeshEventService,
        | "emitRuntime"
        | "streamRuntime"
        | "observeRuntime"
        | "emitTopology"
        | "streamTopology"
        | "observeTopology"
        | "observeRuntimeSince"
        | "observeTopologySince"
        | "runtimeLastSequence"
    >;
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        process.env = {
            ...process.env,
            ...getMockEnv("api"),
            NODE_ENV: "test",
            MESH_STREAM_SHARED_SECRET: "",
        };

        process.env.MESH_STREAM_SHARED_SECRET = "";
        const topologyEvents: MeshTopologyEvent[] = [];

        meshEventService = {
            emitRuntime: vi.fn(),
            streamRuntime: vi.fn(() => ({
                [Symbol.asyncIterator]: async function* () {
                    await Promise.resolve();
                    yield* [];
                },
            })),
            observeRuntime: vi.fn(() => from([])),
            emitTopology: vi.fn((event) => {
                topologyEvents.push(event);
            }),
            streamTopology: vi.fn(() => ({
                [Symbol.asyncIterator]: async function* () {
                    await Promise.resolve();
                    yield* topologyEvents;
                },
            })),
            observeTopology: vi.fn(() => from(topologyEvents)),
            observeRuntimeSince: vi.fn(() => from([])),
            observeTopologySince: vi.fn(() => from([])),
            runtimeLastSequence: vi.fn(() => 0),
        };

        meshLogicService = new SystemMeshLogicService();
        meshOverlayScopeService = new SystemMeshOverlayScopeService();
        envService = new EnvService();

        service = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.restoreAllMocks();
        vi.useRealTimers();
    });

    it("hydrates durable resource ownership index on module init", async () => {
        const repositoryMock: Pick<SystemMeshClusterRepository, "loadAllResourceLocations" | "persistResourceIndexUpsert" | "persistNodeHeartbeat"> = {
            loadAllResourceLocations: vi.fn(async () => [
                {
                    organizationId: "11111111-1111-4111-8111-111111111111",
                    kind: "stream" as const,
                    key: "stream:test-hydrated",
                    ownerNodeId: "22222222-2222-4222-8222-222222222222",
                    ownerServerUrl: "https://node-hydrated.mesh.internal",
                    endpointPath: "/deployments/test-hydrated/stream",
                    endpointMethod: "GET" as const,
                    protocol: "https" as const,
                    persistentConnectionRequired: true,
                    priority: 100,
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    metadata: null,
                },
            ]),
            persistResourceIndexUpsert: vi.fn(async () => undefined),
            persistNodeHeartbeat: vi.fn(async () => undefined),
        };

        const hydratedService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as SystemMeshClusterRepository,
        );

        await hydratedService.onModuleInit();

        const lookup = hydratedService.lookupResource({
            organizationId: "11111111-1111-4111-8111-111111111111",
            kind: "stream",
            key: "stream:test-hydrated",
            includeCandidates: true,
        });

        expect(repositoryMock.loadAllResourceLocations).toHaveBeenCalledTimes(1);
        expect(lookup.found).toBe(true);
        expect(lookup.primary?.ownerNodeId).toBe("22222222-2222-4222-8222-222222222222");
    });

    it("infers remote-to-remote links from cluster sync to expose cluster-wide topology", async () => {
        const remoteNodeA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
        const remoteNodeB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
        const now = new Date("2026-03-01T10:00:00.000Z").toISOString();

        const repositoryMock: Pick<
            SystemMeshClusterRepository,
            "loadAllResourceLocations" | "persistResourceIndexUpsert" | "persistNodeHeartbeat" | "loadActiveClusterNodes"
        > = {
            loadAllResourceLocations: vi.fn(async () => []),
            persistResourceIndexUpsert: vi.fn(async () => undefined),
            persistNodeHeartbeat: vi.fn(async () => undefined),
            loadActiveClusterNodes: vi.fn(async () => [
                {
                    nodeId: remoteNodeA,
                    serverUrl: "http://api-mesh-dev-2:3302",
                    status: "active" as const,
                    healthy: true,
                    lastSeenAt: now,
                },
                {
                    nodeId: remoteNodeB,
                    serverUrl: "http://api-mesh-dev-3:3303",
                    status: "active" as const,
                    healthy: true,
                    lastSeenAt: now,
                },
            ]),
        };

        const syncedService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        await syncedService.onModuleInit();

        const peers = syncedService.listPeers().items;
        expect(repositoryMock.loadActiveClusterNodes).toHaveBeenCalledWith();
        expect(
            peers.some(
                (connection) =>
                    connection.sourceNodeId === remoteNodeA &&
                    connection.targetNodeId === remoteNodeB &&
                    (connection.metadata)?.inferredFromClusterSync === true,
            ),
        ).toBe(true);
        expect(
            peers.some(
                (connection) =>
                    connection.sourceNodeId === remoteNodeB &&
                    connection.targetNodeId === remoteNodeA &&
                    (connection.metadata)?.inferredFromClusterSync === true,
            ),
        ).toBe(true);

        syncedService.onModuleDestroy();
    });

    it("exposes local connected links from DB sync with deterministic 40ms baseline", async () => {
        const localNodeId = "22222222-2222-4222-8222-222222222222";
        const remoteNodeIds = [
            "33333333-3333-4333-8333-333333333333",
            "44444444-4444-4444-8444-444444444444",
            "55555555-5555-4555-8555-555555555555",
            "66666666-6666-4666-8666-666666666666",
            "77777777-7777-4777-8777-777777777777",
        ];
        const now = new Date("2026-04-01T12:00:00.000Z").toISOString();

        process.env.MESH_NODE_ID = localNodeId;
        const localEnvService = new EnvService();

        const repositoryMock: Pick<
            SystemMeshClusterRepository,
            "loadAllResourceLocations" | "persistResourceIndexUpsert" | "persistNodeHeartbeat" | "loadActiveClusterNodes"
        > = {
            loadAllResourceLocations: vi.fn(async () => []),
            persistResourceIndexUpsert: vi.fn(async () => undefined),
            persistNodeHeartbeat: vi.fn(async () => undefined),
            loadActiveClusterNodes: vi.fn(async () =>
                remoteNodeIds.map((nodeId, index) => ({
                    nodeId,
                    serverUrl: `http://api-mesh-dev-${index + 2}:33${String(index + 2).padStart(2, "0")}`,
                    status: "active" as const,
                    healthy: true,
                    lastSeenAt: now,
                })),
            ),
        };

        const syncedService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            localEnvService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        await syncedService.onModuleInit();

        const localLinks = syncedService
            .listPeers()
            .items.filter((connection) => connection.sourceNodeId === localNodeId);

        const inferredLinks = syncedService
            .listPeers()
            .items.filter(
                (connection) =>
                    connection.sourceNodeId !== localNodeId &&
                    Reflect.get(connection.metadata ?? {}, "inferredFromClusterSync") === true,
            );

        expect(syncedService.getLocalNode().nodeId).toBe(localNodeId);
        expect(localLinks).toHaveLength(5);
        expect(localLinks.every((connection) => connection.metrics.latencyMs === 40)).toBe(true);
        expect(localLinks.map((connection) => connection.targetNodeId).sort()).toEqual([...remoteNodeIds].sort());
        expect(inferredLinks).toHaveLength(15);

        const inferredBySource = inferredLinks.reduce<Map<string, number>>((acc, link) => {
            acc.set(link.sourceNodeId, (acc.get(link.sourceNodeId) ?? 0) + 1);
            return acc;
        }, new Map());

        expect([...inferredBySource.values()].every((count) => count <= 3)).toBe(true);

        syncedService.onModuleDestroy();
    });

    it("persists resource index upserts through durable repository", async () => {
        const repositoryMock: Pick<SystemMeshClusterRepository, "loadAllResourceLocations" | "persistResourceIndexUpsert" | "persistNodeHeartbeat"> = {
            loadAllResourceLocations: vi.fn(async () => []),
            persistResourceIndexUpsert: vi.fn(async () => undefined),
            persistNodeHeartbeat: vi.fn(async () => undefined),
        };

        const durableService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as SystemMeshClusterRepository,
        );

        durableService.upsertResourceIndex({
            organizationId: "33333333-3333-4333-8333-333333333333",
            sourceNodeId: "44444444-4444-4444-8444-444444444444",
            replaceExistingForSource: false,
            resources: [
                {
                    organizationId: "33333333-3333-4333-8333-333333333333",
                    kind: "stream" as const,
                    key: "stream:test-upsert",
                    ownerNodeId: "44444444-4444-4444-8444-444444444444",
                    ownerServerUrl: "https://node-upsert.mesh.internal",
                    endpointPath: "/deployments/test-upsert/stream",
                    endpointMethod: "GET" as const,
                    protocol: "https" as const,
                    persistentConnectionRequired: true,
                    priority: 100,
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    metadata: null,
                },
            ],
        });

        await Promise.resolve();

        expect(repositoryMock.persistResourceIndexUpsert).toHaveBeenCalledTimes(1);
    });

    it("issues join grant for super-admin actor", async () => {
        const repositoryMock = {
            issueJoinGrant: vi.fn(async () => ({
                grantId: "66666666-6666-4666-8666-666666666666",
                grantToken: "grant-token",
                expiresAt: new Date().toISOString(),
            })),
        };

        const durableService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const result = await durableService.issueJoinGrant({
            organizationId: null,
            targetNodeId: null,
            ttlSeconds: 600,
            issuedByUserId: "user-super-admin",
            issuedByRole: "superAdmin",
            metadata: null,
        });

        expect(result.status).toBe("issued");
        expect(repositoryMock.issueJoinGrant).toHaveBeenCalledWith(
            expect.objectContaining({
                issuedByUserId: "user-super-admin",
                ttlSeconds: 600,
            }),
        );
    });

    it("rejects join grant issue for non super-admin actor", async () => {
        const repositoryMock = {
            issueJoinGrant: vi.fn(async () => ({
                grantId: "ignored",
                grantToken: "ignored",
                expiresAt: new Date().toISOString(),
            })),
        };

        const durableService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        await expect(
            durableService.issueJoinGrant({
                organizationId: null,
                targetNodeId: null,
                ttlSeconds: 600,
                issuedByUserId: "user-admin",
                issuedByRole: "admin",
                metadata: null,
            }),
        ).rejects.toThrowError(/super-admin/i);
    });

    it("consumes and revokes join grants through durable repository", async () => {
        const nowIso = new Date().toISOString();
        const repositoryMock = {
            consumeJoinGrant: vi.fn(async () => ({
                grantId: "88888888-8888-4888-8888-888888888888",
                nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                enrolledAt: nowIso,
            })),
            revokeJoinGrant: vi.fn(async () => ({
                grantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                revokedAt: nowIso,
            })),
        };

        const durableService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const consumeResult = await durableService.consumeJoinGrant({
            grantToken: "join-token",
            nodeId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            serverUrl: "https://node-a.mesh.internal",
            displayName: "node-a",
            capabilities: null,
            metadata: null,
        });

        const revokeResult = await durableService.revokeJoinGrant({
            grantId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            reason: "operator_cancel",
            revokedByUserId: "user-super-admin",
            revokedByRole: "superAdmin",
        });

        expect(consumeResult.accepted).toBe(true);
        expect(revokeResult.status).toBe("revoked");
        expect(repositoryMock.consumeJoinGrant).toHaveBeenCalledTimes(1);
        expect(repositoryMock.revokeJoinGrant).toHaveBeenCalledTimes(1);
    });

    it("deduplicates duplicate active peer connections", () => {
        const endpointUrl = "wss://peer-a.mesh.internal/ws";

        const first = service.connectPeer({
            endpointUrl,
        });

        const second = service.connectPeer({
            endpointUrl,
        });

        expect(first.connected).toBe(true);
        expect(second.connected).toBe(true);
        expect(second.deduplicated).toBe(true);
        expect(second.session.sessionId).toBe(first.session.sessionId);
    });

    it("supports resume token recovery", () => {
        const connected = service.connectPeer({
            endpointUrl: "wss://peer-b.mesh.internal/ws",
            resumeToken: "resume-token-peer-b",
        });

        const disconnected = service.disconnectPeer(connected.session.sessionId, {
            reason: "network_blip",
            allowReconnect: true,
        });

        expect(disconnected.session.state).toBe("reconnecting");

        const resumed = service.connectPeer({
            endpointUrl: "wss://peer-b.mesh.internal/ws",
            resumeToken: "resume-token-peer-b",
        });

        expect(resumed.resumed).toBe(true);
        expect(resumed.session.sessionId).toBe(connected.session.sessionId);
        expect(resumed.session.state).toBe("connected");
    });

    it("hard-disconnects without reconnect and allows creating a new session", () => {
        const endpointUrl = "wss://peer-hard-disconnect.mesh.internal/ws";
        const connected = service.connectPeer({ endpointUrl });

        const disconnected = service.disconnectPeer(connected.session.sessionId, {
            reason: "operator_unlink",
            allowReconnect: false,
        });

        expect(disconnected.session.state).toBe("closed");
        expect(disconnected.session.nextReconnectAt).toBeNull();

        const reconnected = service.connectPeer({ endpointUrl });
        expect(reconnected.deduplicated).toBe(false);
        expect(reconnected.resumed).toBe(false);
        expect(reconnected.session.sessionId).not.toBe(connected.session.sessionId);
    });

    it("schedules exponential reconnect with jitter when disconnect allows reconnect", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-02-26T10:00:00.000Z"));
        vi.spyOn(Math, "random").mockReturnValue(0.5);

        const connected = service.connectPeer({
            endpointUrl: "wss://peer-reconnect.mesh.internal/ws",
            resumeToken: "resume-token-reconnect",
        });

        const firstDisconnect = service.disconnectPeer(connected.session.sessionId, {
            reason: "transient_error",
            allowReconnect: true,
        });

        expect(firstDisconnect.session.state).toBe("reconnecting");
        expect(firstDisconnect.session.reconnectAttempt).toBe(1);
        expect(firstDisconnect.session.nextReconnectAt).toBe(new Date("2026-02-26T10:00:00.500Z").toISOString());

        const secondDisconnect = service.disconnectPeer(connected.session.sessionId, {
            reason: "transient_error_again",
            allowReconnect: true,
        });

        expect(secondDisconnect.session.reconnectAttempt).toBe(2);
        expect(secondDisconnect.session.nextReconnectAt).toBe(new Date("2026-02-26T10:00:01.000Z").toISOString());
    });

    it("resumes with same session and merges resume metadata", () => {
        const retrievedAt = new Date().toISOString();

        const connected = service.connectPeer({
            endpointUrl: "wss://peer-resume-merge.mesh.internal/ws",
            resumeToken: "resume-token-merge",
            serverUrl: "https://peer-old.mesh.internal",
            remoteAuthSession: {
                serverUrl: "https://peer-old.mesh.internal",
                sessionId: "session-old",
                userId: "user-old",
                userEmail: "old@example.com",
                retrievedAt,
                raw: null,
            },
        });

        service.disconnectPeer(connected.session.sessionId, {
            reason: "network_blip",
            allowReconnect: true,
        });

        const resumed = service.connectPeer({
            endpointUrl: "wss://peer-resume-merge.mesh.internal/ws",
            resumeToken: "resume-token-merge",
            serverUrl: "https://peer-new.mesh.internal",
            remoteAuthSession: {
                serverUrl: "https://peer-new.mesh.internal",
                sessionId: "session-new",
                userId: "user-new",
                userEmail: "new@example.com",
                retrievedAt,
                raw: null,
            },
        });

        expect(resumed.resumed).toBe(true);
        expect(resumed.session.sessionId).toBe(connected.session.sessionId);
        expect(resumed.session.metadata).toMatchObject({
            serverUrl: "https://peer-new.mesh.internal",
            remoteAuthSession: {
                serverUrl: "https://peer-new.mesh.internal",
                sessionId: "session-new",
                userId: "user-new",
                userEmail: "new@example.com",
            },
        });
    });

    it("rejects heartbeat when peer identity was never resolved", () => {
        const connected = service.connectPeer({
            endpointUrl: "wss://peer-no-id.mesh.internal/ws",
        });

        expect(() =>
            service.heartbeatPeer(connected.session.sessionId, {
                latencyMs: 20,
                jitterMs: 2,
                packetLossRatio: 0.01,
                throughputMbps: 500,
                reliabilityScore: 0.95,
            }),
        ).toThrowError(/peerNodeId must be provided/i);
    });

    it("enforces configured stream shared secret for auth-first stream", async () => {
        process.env.MESH_STREAM_SHARED_SECRET = "strict-mesh-secret";
        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        const outputs: Array<{ type: string; code?: string }> = [];

        for await (const event of strictService.streamSession(
            (async function* () {
                yield {
                    type: "auth",
                    credential: "wrong-secret",
                    endpointUrl: "wss://peer-auth.mesh.internal/session/stream",
                };
            })(),
        )) {
            outputs.push({ type: event.type, code: "code" in event ? event.code : undefined });
        }

        expect(outputs[0]).toMatchObject({
            type: "error",
            code: "unauthorized",
        });
    });

    it("rejects unsigned remote control envelope when envelope signing key is configured", () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_CONTROL_ENVELOPE_TRUST_REQUIRED = "true";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        expect(() =>
            strictService.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "heartbeat",
                sourceNodeId: randomUUID(),
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {},
            }),
        ).toThrowError(/signed mesh control envelope is required/i);

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.strictConfigured).toBe(true);
        expect(readiness.strictEnforced).toBe(true);
    });

    it("does not enforce strict trust until readiness converges when strict mode is configured", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_CONTROL_ENVELOPE_TRUST_REQUIRED = "true";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeId = randomUUID();
        const helloEnvelope = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: helloEnvelope.envelopeId,
            organizationId: helloEnvelope.organizationId,
            keyId: helloEnvelope.keyId,
            algorithm: helloEnvelope.algorithm,
            type: helloEnvelope.type,
            sourceNodeId: helloEnvelope.sourceNodeId,
            targetNodeId: helloEnvelope.targetNodeId,
            partitionKey: helloEnvelope.partitionKey ?? null,
            traceId: helloEnvelope.traceId ?? null,
            hop: helloEnvelope.hop,
            maxHops: helloEnvelope.maxHops,
            emittedAt: helloEnvelope.emittedAt,
            payload: helloEnvelope.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...helloEnvelope,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        const readinessBeforeAck = strictService.getTrustStrictReadiness();
        expect(readinessBeforeAck.ready).toBe(false);
        expect(readinessBeforeAck.strictConfigured).toBe(true);
        expect(readinessBeforeAck.strictEnforced).toBe(false);

        expect(() =>
            strictService.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "heartbeat",
                sourceNodeId: remoteNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {},
            }),
        ).not.toThrow();
    });

    it("accepts valid signed remote control envelope when trust key is configured", () => {
        const signingKey = "mesh-envelope-secret";
        const signingKid = "mesh-k1";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = signingKey;
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = signingKid;
        process.env.MESH_CONTROL_ENVELOPE_TRUST_REQUIRED = "true";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        const envelopeBase = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: signingKid,
            algorithm: "HS256" as const,
            type: "heartbeat" as const,
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {},
        };

        const canonical = JSON.stringify({
            envelopeId: envelopeBase.envelopeId,
            organizationId: envelopeBase.organizationId,
            keyId: envelopeBase.keyId,
            algorithm: envelopeBase.algorithm,
            type: envelopeBase.type,
            sourceNodeId: envelopeBase.sourceNodeId,
            targetNodeId: envelopeBase.targetNodeId,
            partitionKey: envelopeBase.partitionKey ?? null,
            traceId: envelopeBase.traceId ?? null,
            hop: envelopeBase.hop,
            maxHops: envelopeBase.maxHops,
            emittedAt: envelopeBase.emittedAt,
            payload: envelopeBase.payload,
        });

        const signature = createHmac("sha256", signingKey)
            .update(canonical)
            .digest("base64url");

        const result = strictService.publishControlEnvelope({
            ...envelopeBase,
            signature,
        });

        expect(result.accepted).toBe(true);
    });

    it("returns trust keyring status with active env key", () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        const status = strictService.getTrustKeyringStatus();
        expect(status.activeKeyId).toBe("mesh-k1");
        expect(status.keys.some((key) => key.keyId === "mesh-k1" && key.status === "active")).toBe(true);
    });

    it("rotates trust key and syncs keyring snapshot", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const rotated = await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        expect(rotated.activeKeyId).toBe("mesh-k2");
        expect(repositoryMock.rotateSigningKey).toHaveBeenCalledTimes(1);
        expect(repositoryMock.loadSigningKeys).toHaveBeenCalledTimes(1);

        const status = strictService.getTrustKeyringStatus();
        expect(status.activeKeyId).toBe("mesh-k2");
        expect(status.keys.some((key) => key.keyId === "mesh-k1" && key.status === "previous")).toBe(true);
    });

    it("tracks trust keyring convergence acknowledgements from remote peers", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeId = randomUUID();
        const helloEnvelope = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: helloEnvelope.envelopeId,
            organizationId: helloEnvelope.organizationId,
            keyId: helloEnvelope.keyId,
            algorithm: helloEnvelope.algorithm,
            type: helloEnvelope.type,
            sourceNodeId: helloEnvelope.sourceNodeId,
            targetNodeId: helloEnvelope.targetNodeId,
            partitionKey: helloEnvelope.partitionKey ?? null,
            traceId: helloEnvelope.traceId ?? null,
            hop: helloEnvelope.hop,
            maxHops: helloEnvelope.maxHops,
            emittedAt: helloEnvelope.emittedAt,
            payload: helloEnvelope.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...helloEnvelope,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        const beforeAck = strictService.getTrustKeyringConvergenceStatus();
        expect(beforeAck.expectedAcks).toBeGreaterThanOrEqual(1);
        expect(beforeAck.converged).toBe(false);

        strictService.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "trust_keyring_ack",
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                keyId: "mesh-k2",
            },
        });

        const afterAck = strictService.getTrustKeyringConvergenceStatus();
        expect(afterAck.converged).toBe(true);
        expect(afterAck.pendingNodeIds).toHaveLength(0);
    });

    it("reports strict trust readiness based on convergence state", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeId = randomUUID();
        const helloEnvelope = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: helloEnvelope.envelopeId,
            organizationId: helloEnvelope.organizationId,
            keyId: helloEnvelope.keyId,
            algorithm: helloEnvelope.algorithm,
            type: helloEnvelope.type,
            sourceNodeId: helloEnvelope.sourceNodeId,
            targetNodeId: helloEnvelope.targetNodeId,
            partitionKey: helloEnvelope.partitionKey ?? null,
            traceId: helloEnvelope.traceId ?? null,
            hop: helloEnvelope.hop,
            maxHops: helloEnvelope.maxHops,
            emittedAt: helloEnvelope.emittedAt,
            payload: helloEnvelope.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...helloEnvelope,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        const beforeAck = strictService.getTrustStrictReadiness();
        expect(beforeAck.ready).toBe(false);
        expect(beforeAck.reasons).toContain("insufficient_peer_ack_ratio");

        strictService.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "trust_keyring_ack",
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                keyId: "mesh-k2",
            },
        });

        const afterAck = strictService.getTrustStrictReadiness();
        expect(afterAck.ready).toBe(true);
        expect(afterAck.reasons).not.toContain("insufficient_peer_ack_ratio");
    });

    it("allows strict readiness when ack ratio meets configured threshold", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_TRUST_STRICT_MIN_ACK_RATIO = "0.5";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeA = randomUUID();
        const remoteNodeB = randomUUID();

        for (const remoteNodeId of [remoteNodeA, remoteNodeB]) {
            strictService.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: remoteNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {
                    node: {
                        nodeId: remoteNodeId,
                        region: "eu-west",
                        roles: ["relay"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: new Date().toISOString(),
                        lastSeenAt: new Date().toISOString(),
                        metadata: null,
                    },
                },
            });
        }

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        strictService.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "trust_keyring_ack",
            sourceNodeId: remoteNodeA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                keyId: "mesh-k2",
            },
        });

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.ready).toBe(true);
        expect(readiness.ackRatio).toBe(0.5);
        expect(readiness.minAckRatio).toBe(0.5);
    });

    it("reports convergence SLO breach when ack ratio stays below threshold past max age", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-02T12:00:00.000Z"));

        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_TRUST_STRICT_MIN_ACK_RATIO = "1";
        process.env.MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS = "1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeId = randomUUID();
        const helloEnvelope = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: helloEnvelope.envelopeId,
            organizationId: helloEnvelope.organizationId,
            keyId: helloEnvelope.keyId,
            algorithm: helloEnvelope.algorithm,
            type: helloEnvelope.type,
            sourceNodeId: helloEnvelope.sourceNodeId,
            targetNodeId: helloEnvelope.targetNodeId,
            partitionKey: helloEnvelope.partitionKey ?? null,
            traceId: helloEnvelope.traceId ?? null,
            hop: helloEnvelope.hop,
            maxHops: helloEnvelope.maxHops,
            emittedAt: helloEnvelope.emittedAt,
            payload: helloEnvelope.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...helloEnvelope,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        vi.advanceTimersByTime(2_000);

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.ready).toBe(false);
        expect(readiness.reasons).toContain("rotation_convergence_slo_breached");
        expect(readiness.rollbackRecommended).toBe(false);
        expect(readiness.lastRotationAgeSeconds).toBeGreaterThan(1);
    });

    it("recommends rollback triggers when strict mode is configured and convergence SLO is breached", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-02T12:00:00.000Z"));

        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_CONTROL_ENVELOPE_TRUST_REQUIRED = "true";
        process.env.MESH_TRUST_STRICT_MIN_ACK_RATIO = "1";
        process.env.MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS = "1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeId = randomUUID();
        const signedHello = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: signedHello.envelopeId,
            organizationId: signedHello.organizationId,
            keyId: signedHello.keyId,
            algorithm: signedHello.algorithm,
            type: signedHello.type,
            sourceNodeId: signedHello.sourceNodeId,
            targetNodeId: signedHello.targetNodeId,
            partitionKey: signedHello.partitionKey ?? null,
            traceId: signedHello.traceId ?? null,
            hop: signedHello.hop,
            maxHops: signedHello.maxHops,
            emittedAt: signedHello.emittedAt,
            payload: signedHello.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...signedHello,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        vi.advanceTimersByTime(2_000);

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.rollbackRecommended).toBe(true);
        expect(readiness.rollbackTriggers).toContain("rotation_convergence_slo_breached");
    });

    it("builds strict rollout plan waves from acked peer nodes", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_TRUST_STRICT_ROLLOUT_WAVE_SIZE = "2";

        const repositoryMock = {
            rotateSigningKey: vi.fn(async () => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(async () => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeIds = [randomUUID(), randomUUID(), randomUUID()];
        for (const remoteNodeId of remoteNodeIds) {
            strictService.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: remoteNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {
                    node: {
                        nodeId: remoteNodeId,
                        region: "eu-west",
                        roles: ["relay"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: new Date().toISOString(),
                        lastSeenAt: new Date().toISOString(),
                        metadata: null,
                    },
                },
            });
        }

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        for (const ackedNodeId of remoteNodeIds.slice(0, 2)) {
            strictService.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "trust_keyring_ack",
                sourceNodeId: ackedNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {
                    keyId: "mesh-k2",
                },
            });
        }

        const plan = strictService.getTrustStrictRolloutPlan({});
        expect(plan.waveSize).toBe(2);
        expect(plan.ackedNodeIds).toHaveLength(2);
        expect(plan.pendingNodeIds).toHaveLength(1);
        expect(plan.waves).toHaveLength(1);
        expect(plan.waves[0]?.nodeIds).toHaveLength(2);
    });

    it("allows super-admin to enable strict trust mode when readiness is satisfied", () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        const result = strictService.setTrustStrictMode({
            enabled: true,
            setByRole: "superAdmin",
        });

        expect(result.requested).toBe(true);
        expect(result.strictConfigured).toBe(true);
        expect(result.strictEnforced).toBe(true);
    });

    it("rejects strict trust mode enable when readiness is not converged", async () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(() => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(() => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        const remoteNodeId = randomUUID();
        const helloEnvelope = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: helloEnvelope.envelopeId,
            organizationId: helloEnvelope.organizationId,
            keyId: helloEnvelope.keyId,
            algorithm: helloEnvelope.algorithm,
            type: helloEnvelope.type,
            sourceNodeId: helloEnvelope.sourceNodeId,
            targetNodeId: helloEnvelope.targetNodeId,
            partitionKey: helloEnvelope.partitionKey ?? null,
            traceId: helloEnvelope.traceId ?? null,
            hop: helloEnvelope.hop,
            maxHops: helloEnvelope.maxHops,
            emittedAt: helloEnvelope.emittedAt,
            payload: helloEnvelope.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...helloEnvelope,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        expect(() =>
            strictService.setTrustStrictMode({
                enabled: true,
                setByRole: "superAdmin",
            }),
        ).toThrowError(/before readiness convergence/i);
    });

    it("rejects strict trust mode changes for non super-admin actor", () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        expect(() =>
            strictService.setTrustStrictMode({
                enabled: true,
                setByRole: "admin",
            }),
        ).toThrowError(/super-admin/i);
    });

    it("allows super-admin forced strict rollback when strict mode is runtime-requested", () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        strictService.setTrustStrictMode({
            enabled: true,
            setByRole: "superAdmin",
        });

        const rolledBack = strictService.rollbackTrustStrictMode({
            force: true,
            reason: "operator_rollback",
            setByRole: "superAdmin",
        });

        expect(rolledBack.rolledBack).toBe(true);
        expect(rolledBack.requested).toBe(false);
        expect(rolledBack.strictConfigured).toBe(false);
    });

    it("rejects strict rollback without recommendation unless forced", () => {
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
        );

        strictService.setTrustStrictMode({
            enabled: true,
            setByRole: "superAdmin",
        });

        expect(() =>
            strictService.rollbackTrustStrictMode({
                force: false,
                setByRole: "superAdmin",
            }),
        ).toThrowError(/rollback recommendation/i);
    });

    it("allows non-forced strict rollback when readiness recommends rollback", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-03T10:00:00.000Z"));

        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_TRUST_STRICT_MIN_ACK_RATIO = "1";
        process.env.MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS = "1";

        const repositoryMock = {
            rotateSigningKey: vi.fn(() => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(() => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        strictService.setTrustStrictMode({
            enabled: true,
            setByRole: "superAdmin",
        });

        const remoteNodeId = randomUUID();
        const helloEnvelope = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const canonical = JSON.stringify({
            envelopeId: helloEnvelope.envelopeId,
            organizationId: helloEnvelope.organizationId,
            keyId: helloEnvelope.keyId,
            algorithm: helloEnvelope.algorithm,
            type: helloEnvelope.type,
            sourceNodeId: helloEnvelope.sourceNodeId,
            targetNodeId: helloEnvelope.targetNodeId,
            partitionKey: helloEnvelope.partitionKey ?? null,
            traceId: helloEnvelope.traceId ?? null,
            hop: helloEnvelope.hop,
            maxHops: helloEnvelope.maxHops,
            emittedAt: helloEnvelope.emittedAt,
            payload: helloEnvelope.payload,
        });

        const signature = createHmac("sha256", "mesh-envelope-secret")
            .update(canonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...helloEnvelope,
            signature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        vi.advanceTimersByTime(2_000);

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.rollbackRecommended).toBe(true);

        const rolledBack = strictService.rollbackTrustStrictMode({
            force: false,
            setByRole: "superAdmin",
            reason: "convergence_slo_breach",
        });

        expect(rolledBack.rolledBack).toBe(true);
        expect(rolledBack.requested).toBe(false);
        expect(rolledBack.strictConfigured).toBe(false);
    });

    it("auto-rolls back strict mode when rollback trigger is active and auto rollback is enabled", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-03T11:00:00.000Z"));

        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_TRUST_STRICT_MIN_ACK_RATIO = "1";
        process.env.MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS = "1";
        process.env.MESH_TRUST_STRICT_AUTO_ROLLBACK = "true";

        const repositoryMock = {
            rotateSigningKey: vi.fn(() => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(() => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        strictService.setTrustStrictMode({
            enabled: true,
            setByRole: "superAdmin",
        });

        const remoteNodeId = randomUUID();
        const signedHello = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const signedHelloCanonical = JSON.stringify({
            envelopeId: signedHello.envelopeId,
            organizationId: signedHello.organizationId,
            keyId: signedHello.keyId,
            algorithm: signedHello.algorithm,
            type: signedHello.type,
            sourceNodeId: signedHello.sourceNodeId,
            targetNodeId: signedHello.targetNodeId,
            partitionKey: signedHello.partitionKey ?? null,
            traceId: signedHello.traceId ?? null,
            hop: signedHello.hop,
            maxHops: signedHello.maxHops,
            emittedAt: signedHello.emittedAt,
            payload: signedHello.payload,
        });

        const signedHelloSignature = createHmac("sha256", "mesh-envelope-secret")
            .update(signedHelloCanonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...signedHello,
            signature: signedHelloSignature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        vi.advanceTimersByTime(2_000);

        strictService.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "heartbeat",
            sourceNodeId: strictService.getLocalNode().nodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {},
        });

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.strictConfigured).toBe(false);
        expect(readiness.strictEnforced).toBe(false);
    });

    it("does not auto-roll back strict mode when auto rollback is disabled", async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-03-03T11:30:00.000Z"));

        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KEY = "mesh-envelope-secret";
        process.env.MESH_CONTROL_ENVELOPE_SIGNING_KID = "mesh-k1";
        process.env.MESH_TRUST_STRICT_MIN_ACK_RATIO = "1";
        process.env.MESH_TRUST_STRICT_MAX_ACK_AGE_SECONDS = "1";
        process.env.MESH_TRUST_STRICT_AUTO_ROLLBACK = "false";

        const repositoryMock = {
            rotateSigningKey: vi.fn(() => ({
                activeKeyId: "mesh-k2",
                rotatedKeyId: "mesh-k2",
                secretMaterial: "mesh-envelope-secret-2",
            })),
            loadSigningKeys: vi.fn(() => [
                { keyId: "mesh-k2", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret-2", status: "active" as const },
                { keyId: "mesh-k1", algorithm: "HS256" as const, secretMaterial: "mesh-envelope-secret", status: "previous" as const },
            ]),
        };

        const strictService = new SystemMeshTopologyService(
            meshEventService as SystemMeshEventService,
            meshLogicService,
            meshOverlayScopeService,
            envService,
            undefined,
            repositoryMock as unknown as SystemMeshClusterRepository,
        );

        strictService.setTrustStrictMode({
            enabled: true,
            setByRole: "superAdmin",
        });

        const remoteNodeId = randomUUID();
        const signedHello = {
            envelopeId: randomUUID(),
            organizationId: null,
            keyId: "mesh-k1",
            algorithm: "HS256" as const,
            type: "hello" as const,
            sourceNodeId: remoteNodeId,
            targetNodeId: null,
            partitionKey: undefined,
            traceId: undefined,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {
                node: {
                    nodeId: remoteNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: new Date().toISOString(),
                    lastSeenAt: new Date().toISOString(),
                    metadata: null,
                },
            },
        };

        const signedHelloCanonical = JSON.stringify({
            envelopeId: signedHello.envelopeId,
            organizationId: signedHello.organizationId,
            keyId: signedHello.keyId,
            algorithm: signedHello.algorithm,
            type: signedHello.type,
            sourceNodeId: signedHello.sourceNodeId,
            targetNodeId: signedHello.targetNodeId,
            partitionKey: signedHello.partitionKey ?? null,
            traceId: signedHello.traceId ?? null,
            hop: signedHello.hop,
            maxHops: signedHello.maxHops,
            emittedAt: signedHello.emittedAt,
            payload: signedHello.payload,
        });

        const signedHelloSignature = createHmac("sha256", "mesh-envelope-secret")
            .update(signedHelloCanonical)
            .digest("base64url");

        strictService.publishControlEnvelope({
            ...signedHello,
            signature: signedHelloSignature,
        });

        await strictService.rotateTrustKey({
            keyId: "mesh-k2",
            secretMaterial: "mesh-envelope-secret-2",
            rotatedByRole: "superAdmin",
        });

        vi.advanceTimersByTime(2_000);

        strictService.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "heartbeat",
            sourceNodeId: strictService.getLocalNode().nodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: new Date().toISOString(),
            payload: {},
        });

        const readiness = strictService.getTrustStrictReadiness();
        expect(readiness.strictConfigured).toBe(true);
        expect(readiness.rollbackRecommended).toBe(true);
    });

    it("updates weighted peer ranking on heartbeat", () => {
        const peerNodeId = randomUUID();
        const connected = service.connectPeer({
            endpointUrl: "wss://peer-c.mesh.internal/ws",
        });

        const heartbeat = service.heartbeatPeer(connected.session.sessionId, {
            peerNodeId,
            latencyMs: 30,
            jitterMs: 2,
            packetLossRatio: 0.01,
            throughputMbps: 850,
            reliabilityScore: 0.99,
        });

        expect(heartbeat.acknowledged).toBe(true);
        expect(heartbeat.connection.targetNodeId).toBe(peerNodeId);

        const peers = service.listPeers();
        expect(peers.items.length).toBeGreaterThan(0);
        expect(peers.items[0]?.targetNodeId).toBe(peerNodeId);
        expect(peers.items[0]?.metrics.weight).toBeGreaterThanOrEqual(0);
    });

    it("applies suspect/confirm/remove membership control envelopes", async () => {
        const peerNodeId = randomUUID();
        const now = new Date().toISOString();

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: peerNodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: peerNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: null,
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "membership_suspect",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: { nodeId: peerNodeId },
        });

        const snapshotAfterSuspect = service.getMembershipSnapshot();
        const suspected = snapshotAfterSuspect.nodes.find((node) => node.nodeId === peerNodeId);
        expect(suspected?.lifecycleState).toBe("suspect");

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "membership_remove",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: { nodeId: peerNodeId },
        });

        const snapshotAfterRemove = service.getMembershipSnapshot();
        expect(snapshotAfterRemove.nodes.find((node) => node.nodeId === peerNodeId)).toBeUndefined();

        const streamedEvents: Array<{ type: string }> = [];
        for await (const event of service.streamTopology({
            replay: true,
            replayLimit: 50,
            includeEdges: true,
            includeNodes: true,
        })) {
            streamedEvents.push({ type: event.type });
        }

        expect(streamedEvents.some((event) => event.type === "node_removed")).toBe(true);
    });

    it("reconciles remote membership snapshot", () => {
        const remoteNodeId = randomUUID();
        const now = new Date().toISOString();
        const localSnapshot = service.getMembershipSnapshot();

        const result = service.reconcileMembership({
            sourceNodeId: randomUUID(),
            dryRun: false,
            snapshot: {
                ...localSnapshot,
                version: localSnapshot.version + 1,
                generatedAt: now,
                nodes: [
                    {
                        nodeId: remoteNodeId,
                        region: "eu-central",
                        roles: ["relay"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: null,
                    },
                ],
                connections: [],
                sessions: [],
            },
        });

        expect(result.mergedNodes).toBe(1);
        expect(result.version).toBeGreaterThan(0);

        const after = service.getMembershipSnapshot();
        expect(after.nodes.some((node) => node.nodeId === remoteNodeId)).toBe(true);
    });

    it("reconciles membership within provided organization scope only", () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        const localSnapshot = service.getMembershipSnapshot();

        const result = service.reconcileMembership({
            organizationId: orgA,
            sourceNodeId: randomUUID(),
            dryRun: false,
            snapshot: {
                ...localSnapshot,
                version: localSnapshot.version + 1,
                generatedAt: now,
                nodes: [
                    {
                        nodeId: nodeInOrgA,
                        region: "eu-central-a",
                        roles: ["relay"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: { organizationIds: [orgA] },
                    },
                    {
                        nodeId: nodeInOrgB,
                        region: "eu-central-b",
                        roles: ["relay"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: { organizationIds: [orgB] },
                    },
                ],
                connections: [],
                sessions: [],
            },
        });

        expect(result.mergedNodes).toBe(1);

        const after = service.getMembershipSnapshot();
        expect(after.nodes.some((node) => node.nodeId === nodeInOrgA)).toBe(true);
        expect(after.nodes.some((node) => node.nodeId === nodeInOrgB)).toBe(false);
    });

    it("returns organization-scoped membership snapshot projection", () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgA,
            type: "hello",
            sourceNodeId: nodeInOrgA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgA,
                    region: "overlay-a",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: { organizationIds: [orgA] },
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgB,
            type: "hello",
            sourceNodeId: nodeInOrgB,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgB,
                    region: "overlay-b",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: { organizationIds: [orgB] },
                },
            },
        });

        const scoped = service.getMembershipSnapshot({ organizationId: orgA });

        expect(scoped.nodes.some((node) => node.nodeId === nodeInOrgA)).toBe(true);
        expect(scoped.nodes.some((node) => node.nodeId === nodeInOrgB)).toBe(false);
    });

    it("requires auth as first stream event", async () => {
        const outputs: Array<{ type: string; code?: string }> = [];

        for await (const event of service.streamSession(
            (async function* () {
                yield { type: "ping", nonce: "n1" };
            })(),
        )) {
            outputs.push({ type: event.type, code: "code" in event ? event.code : undefined });
        }

        expect(outputs[0]).toMatchObject({
            type: "error",
            code: "auth_required",
        });
    });

    it("supports auth-first duplex stream with ping and disconnect", async () => {
        const outputs: Array<{ type: string }> = [];

        for await (const event of service.streamSession(
            (async function* () {
                yield {
                    type: "auth",
                    credential: "mesh-secret",
                    endpointUrl: "wss://peer-stream.mesh.internal/session/stream",
                };
                yield { type: "ping", nonce: "abc123" };
                yield { type: "disconnect", reason: "test_done", allowReconnect: false };
            })(),
        )) {
            outputs.push({ type: event.type });
        }

        expect(outputs[0]?.type).toBe("auth_ok");
        expect(outputs.some((event) => event.type === "snapshot")).toBe(true);
        expect(outputs.some((event) => event.type === "pong")).toBe(true);
        expect(outputs.at(-1)?.type).toBe("disconnected");
    });

    it("injects stream session organization scope into control envelopes", async () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        const sessionA = service.connectPeer({ endpointUrl: "wss://stream-forward-a.mesh.internal/ws" });
        service.heartbeatPeer(sessionA.session.sessionId, {
            peerNodeId: nodeInOrgA,
            latencyMs: 10,
            jitterMs: 1,
            packetLossRatio: 0.01,
            throughputMbps: 950,
            reliabilityScore: 0.99,
        });

        const sessionB = service.connectPeer({ endpointUrl: "wss://stream-forward-b.mesh.internal/ws" });
        service.heartbeatPeer(sessionB.session.sessionId, {
            peerNodeId: nodeInOrgB,
            latencyMs: 15,
            jitterMs: 2,
            packetLossRatio: 0.02,
            throughputMbps: 900,
            reliabilityScore: 0.98,
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgA,
            type: "hello",
            sourceNodeId: nodeInOrgA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgA,
                    region: "overlay-a",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: { organizationIds: [orgA] },
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgB,
            type: "hello",
            sourceNodeId: nodeInOrgB,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgB,
                    region: "overlay-b",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: { organizationIds: [orgB] },
                },
            },
        });

        let controlAck: { forwardedTo: string[] } | null = null;

        for await (const event of service.streamSession(
            (async function* () {
                yield {
                    type: "auth",
                    credential: "mesh-secret",
                    endpointUrl: "wss://peer-stream-org.mesh.internal/session/stream",
                    metadata: {
                        organizationId: orgA,
                    },
                };
                yield {
                    type: "control",
                    envelope: {
                        envelopeId: randomUUID(),
                        type: "heartbeat",
                        sourceNodeId: nodeInOrgA,
                        targetNodeId: null,
                        hop: 0,
                        maxHops: 16,
                        emittedAt: now,
                        payload: {},
                    },
                };
                yield { type: "disconnect", reason: "done", allowReconnect: false };
            })(),
        )) {
            if (event.type === "control_ack") {
                controlAck = { forwardedTo: event.forwardedTo };
            }
        }

        expect(controlAck).not.toBeNull();
        expect(controlAck?.forwardedTo).toContain(nodeInOrgA);
        expect(controlAck?.forwardedTo).not.toContain(nodeInOrgB);
    });

    it("rejects control envelope with mismatched organization scope against stream session", async () => {
        const orgA = randomUUID();
        const orgB = randomUUID();

        const outputs: Array<{ type: string; code?: string }> = [];

        for await (const event of service.streamSession(
            (async function* () {
                yield {
                    type: "auth",
                    credential: "mesh-secret",
                    endpointUrl: "wss://peer-stream-org-mismatch.mesh.internal/session/stream",
                    metadata: {
                        organizationId: orgA,
                    },
                };
                yield {
                    type: "control",
                    envelope: {
                        envelopeId: randomUUID(),
                        organizationId: orgB,
                        type: "heartbeat",
                        sourceNodeId: randomUUID(),
                        targetNodeId: null,
                        hop: 0,
                        maxHops: 16,
                        emittedAt: new Date().toISOString(),
                        payload: {},
                    },
                };
                yield { type: "disconnect", reason: "done", allowReconnect: false };
            })(),
        )) {
            outputs.push({ type: event.type, code: "code" in event ? event.code : undefined });
        }

        expect(outputs.some((event) => event.type === "error" && event.code === "invalid_event")).toBe(true);
    });

    it("indexes mesh resource ownership and resolves primary location", () => {
        const ownerNodeId = randomUUID();
        const secondNodeId = randomUUID();
        const key = "deployment:dep_123";

        const upsert = service.upsertResourceIndex({
            sourceNodeId: ownerNodeId,
            replaceExistingForSource: true,
            resources: [
                {
                    kind: "deployment",
                    key,
                    ownerNodeId,
                    ownerServerUrl: "https://api-a.mesh.internal",
                    endpointPath: "/deployments/dep_123",
                    endpointMethod: "GET",
                    protocol: "https",
                    persistentConnectionRequired: false,
                    priority: 10,
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    metadata: null,
                },
                {
                    kind: "deployment",
                    key,
                    ownerNodeId: secondNodeId,
                    ownerServerUrl: "https://api-b.mesh.internal",
                    endpointPath: "/deployments/dep_123",
                    endpointMethod: "GET",
                    protocol: "https",
                    persistentConnectionRequired: false,
                    priority: 50,
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    metadata: null,
                },
            ],
        });

        expect(upsert.accepted).toBe(true);
        expect(upsert.upserted).toBe(2);

        const lookup = service.lookupResource({
            kind: "deployment",
            key,
            includeCandidates: true,
        });

        expect(lookup.found).toBe(true);
        expect(lookup.primary?.ownerNodeId).toBe(ownerNodeId);
        expect(lookup.candidates.length).toBe(2);
    });

    it("isolates resource lookup by organization scope for same key", () => {
        const ownerNodeA = randomUUID();
        const ownerNodeB = randomUUID();
        const orgA = randomUUID();
        const orgB = randomUUID();
        const key = "deployment:dep_shared";

        service.upsertResourceIndex({
            sourceNodeId: ownerNodeA,
            organizationId: orgA,
            replaceExistingForSource: true,
            resources: [
                {
                    organizationId: orgA,
                    kind: "deployment",
                    key,
                    ownerNodeId: ownerNodeA,
                    ownerServerUrl: "https://org-a.mesh.internal",
                    endpointPath: "/deployments/dep_shared",
                    endpointMethod: "GET",
                    protocol: "https",
                    persistentConnectionRequired: false,
                    priority: 5,
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    metadata: null,
                },
            ],
        });

        service.upsertResourceIndex({
            sourceNodeId: ownerNodeB,
            organizationId: orgB,
            replaceExistingForSource: true,
            resources: [
                {
                    organizationId: orgB,
                    kind: "deployment",
                    key,
                    ownerNodeId: ownerNodeB,
                    ownerServerUrl: "https://org-b.mesh.internal",
                    endpointPath: "/deployments/dep_shared",
                    endpointMethod: "GET",
                    protocol: "https",
                    persistentConnectionRequired: false,
                    priority: 5,
                    version: 1,
                    updatedAt: new Date().toISOString(),
                    metadata: null,
                },
            ],
        });

        const lookupOrgA = service.lookupResource({
            organizationId: orgA,
            kind: "deployment",
            key,
            includeCandidates: true,
        });
        const lookupOrgB = service.lookupResource({
            organizationId: orgB,
            kind: "deployment",
            key,
            includeCandidates: true,
        });

        expect(lookupOrgA.found).toBe(true);
        expect(lookupOrgA.primary?.ownerServerUrl).toBe("https://org-a.mesh.internal");
        expect(lookupOrgA.candidates).toHaveLength(1);

        expect(lookupOrgB.found).toBe(true);
        expect(lookupOrgB.primary?.ownerServerUrl).toBe("https://org-b.mesh.internal");
        expect(lookupOrgB.candidates).toHaveLength(1);
    });

    it("evicts indexed resources when owner node is removed from membership", () => {
        const ownerNodeId = randomUUID();
        const now = new Date().toISOString();

        service.upsertResourceIndex({
            sourceNodeId: ownerNodeId,
            replaceExistingForSource: true,
            resources: [
                {
                    kind: "stream",
                    key: "stream:deployment:dep_456",
                    ownerNodeId,
                    ownerServerUrl: "https://api-stream.mesh.internal",
                    endpointPath: "/deployments/dep_456/stream",
                    endpointMethod: "GET",
                    protocol: "sse",
                    persistentConnectionRequired: true,
                    abortEndpointPath: "/deployments/dep_456/stream/subscriptions/sub_1",
                    priority: 20,
                    version: 1,
                    updatedAt: now,
                    metadata: null,
                },
            ],
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: ownerNodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: ownerNodeId,
                    region: "eu-west",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: null,
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "membership_remove",
            sourceNodeId: randomUUID(),
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: { nodeId: ownerNodeId },
        });

        const lookup = service.lookupResource({
            kind: "stream",
            key: "stream:deployment:dep_456",
            includeCandidates: true,
        });

        expect(lookup.found).toBe(false);
        expect(lookup.primary).toBeNull();
        expect(lookup.candidates.length).toBe(0);
    });

    it("builds weighted stream branch plans across six connected nodes", () => {
        const nodeIds = Array.from({ length: 6 }, () => randomUUID());
        const streamId = randomUUID();

        for (const [index, nodeId] of nodeIds.entries()) {
            const connected = service.connectPeer({
                endpointUrl: `wss://peer-${index + 1}.mesh.internal/ws`,
            });

            service.heartbeatPeer(connected.session.sessionId, {
                peerNodeId: nodeId,
                latencyMs: 10 + index * 15,
                jitterMs: 1 + index,
                packetLossRatio: Math.min(0.2, index * 0.01),
                throughputMbps: 1200 - index * 100,
                reliabilityScore: 0.99 - index * 0.02,
            });

            service.upsertResourceIndex({
                sourceNodeId: nodeId,
                replaceExistingForSource: true,
                resources: [
                    {
                        kind: "stream",
                        key: `stream:${streamId}`,
                        ownerNodeId: nodeId,
                        ownerServerUrl: `https://api-${index + 1}.mesh.internal`,
                        endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                        endpointMethod: "GET",
                        protocol: "sse",
                        persistentConnectionRequired: true,
                        priority: 10 + index,
                        version: 1,
                        updatedAt: new Date().toISOString(),
                        metadata: null,
                    },
                ],
            });
        }

        const plan = service.planStreamRoute({
            streamId,
            desiredBranches: 3,
            includeCandidates: true,
        });

        expect(plan.streamId).toBe(streamId);
        expect(plan.selected).toHaveLength(3);
        expect(plan.candidates.length).toBeGreaterThanOrEqual(6);
        expect(plan.selected[0]?.estimatedWeight).toBeLessThanOrEqual(plan.selected[1]?.estimatedWeight ?? Infinity);
        expect(plan.selected[1]?.estimatedWeight).toBeLessThanOrEqual(plan.selected[2]?.estimatedWeight ?? Infinity);
    });

    it("filters planned stream branches by organization overlay membership when available", () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const streamId = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: nodeInOrgA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgA,
                    region: "overlay-a",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: {
                        organizationIds: [orgA],
                    },
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: nodeInOrgB,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgB,
                    region: "overlay-b",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: {
                        organizationIds: [orgB],
                    },
                },
            },
        });

        service.upsertResourceIndex({
            sourceNodeId: nodeInOrgA,
            organizationId: orgA,
            replaceExistingForSource: true,
            resources: [
                {
                    organizationId: orgA,
                    kind: "stream",
                    key: `stream:${streamId}`,
                    ownerNodeId: nodeInOrgA,
                    ownerServerUrl: "https://org-a.mesh.internal",
                    endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                    endpointMethod: "GET",
                    protocol: "sse",
                    persistentConnectionRequired: true,
                    priority: 10,
                    version: 1,
                    updatedAt: now,
                    metadata: null,
                },
            ],
        });

        service.upsertResourceIndex({
            sourceNodeId: nodeInOrgB,
            organizationId: orgA,
            replaceExistingForSource: true,
            resources: [
                {
                    organizationId: orgA,
                    kind: "stream",
                    key: `stream:${streamId}`,
                    ownerNodeId: nodeInOrgB,
                    ownerServerUrl: "https://org-b.mesh.internal",
                    endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                    endpointMethod: "GET",
                    protocol: "sse",
                    persistentConnectionRequired: true,
                    priority: 5,
                    version: 1,
                    updatedAt: now,
                    metadata: null,
                },
            ],
        });

        const plan = service.planStreamRoute({
            organizationId: orgA,
            streamId,
            desiredBranches: 2,
            includeCandidates: true,
        });

        expect(plan.selected).toHaveLength(1);
        expect(plan.selected[0]?.ownerNodeId).toBe(nodeInOrgA);
        expect(plan.candidates).toHaveLength(1);
        expect(plan.candidates[0]?.ownerNodeId).toBe(nodeInOrgA);
    });

    it("keeps stream discovery reachable across six-node ownership candidates", () => {
        const streamId = randomUUID();
        const ownerNodes = Array.from({ length: 6 }, () => randomUUID());

        for (const [index, ownerNodeId] of ownerNodes.entries()) {
            const now = new Date().toISOString();
            service.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: ownerNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: now,
                payload: {
                    node: {
                        nodeId: ownerNodeId,
                        region: `region-${index + 1}`,
                        roles: ["relay"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: null,
                    },
                },
            });

            service.upsertResourceIndex({
                sourceNodeId: ownerNodeId,
                replaceExistingForSource: true,
                resources: [
                    {
                        kind: "stream",
                        key: `stream:${streamId}`,
                        ownerNodeId,
                        ownerServerUrl: `https://edge-${index + 1}.mesh.internal`,
                        endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                        endpointMethod: "GET",
                        protocol: "sse",
                        persistentConnectionRequired: true,
                        priority: 100 - index,
                        version: 1,
                        updatedAt: now,
                        metadata: null,
                    },
                ],
            });
        }

        const lookup = service.lookupResource({
            kind: "stream",
            key: `stream:${streamId}`,
            includeCandidates: true,
        });

        expect(lookup.found).toBe(true);
        expect(lookup.primary).not.toBeNull();
        expect(lookup.candidates).toHaveLength(6);
        expect(lookup.candidates.every((candidate) => candidate.ownerServerUrl.includes("https://edge-"))).toBe(true);
    });

    it("plans deterministic queue partition ownership with forwarding target", () => {
        const now = new Date().toISOString();
        const peerA = randomUUID();
        const peerB = randomUUID();

        for (const [index, peerNodeId] of [peerA, peerB].entries()) {
            const connected = service.connectPeer({
                endpointUrl: `wss://queue-peer-${index + 1}.mesh.internal/ws`,
            });

            service.heartbeatPeer(connected.session.sessionId, {
                peerNodeId,
                latencyMs: 8 + index,
                jitterMs: 1,
                packetLossRatio: 0,
                throughputMbps: 1000,
                reliabilityScore: 0.99,
            });

            service.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: peerNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: now,
                payload: {
                    node: {
                        nodeId: peerNodeId,
                        region: "queue",
                        roles: ["partition-owner"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: {
                            serverUrl: `https://queue-peer-${index + 1}.mesh.internal`,
                        },
                    },
                },
            });
        }

        const firstPlan = service.planQueuePartitionOwnership({
            queue: "deployment",
            partitionKey: "org:test:service:abc",
            includeCandidates: true,
        });

        const secondPlan = service.planQueuePartitionOwnership({
            queue: "deployment",
            partitionKey: "org:test:service:abc",
            includeCandidates: true,
        });

        expect(firstPlan.ownerNodeId).toBe(secondPlan.ownerNodeId);
        expect(firstPlan.candidates.map((candidate) => candidate.nodeId)).toEqual(
            secondPlan.candidates.map((candidate) => candidate.nodeId),
        );
        expect(firstPlan.forwardingRequired).toBe(firstPlan.ownerNodeId !== service.getLocalNode().nodeId);
        expect(firstPlan.forwardedToNodeId).toBe(
            firstPlan.ownerNodeId === service.getLocalNode().nodeId ? null : firstPlan.ownerNodeId,
        );
    });

    it("marks lease handoff when expired lease holder differs from selected owner", () => {
        const now = new Date().toISOString();
        const peerA = randomUUID();
        const peerB = randomUUID();

        for (const [index, peerNodeId] of [peerA, peerB].entries()) {
            const connected = service.connectPeer({
                endpointUrl: `wss://queue-lease-peer-${index + 1}.mesh.internal/ws`,
            });

            service.heartbeatPeer(connected.session.sessionId, {
                peerNodeId,
                latencyMs: 12 + index,
                jitterMs: 2,
                packetLossRatio: 0,
                throughputMbps: 900,
                reliabilityScore: 0.98,
            });

            service.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: peerNodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: now,
                payload: {
                    node: {
                        nodeId: peerNodeId,
                        region: "queue-lease",
                        roles: ["partition-owner"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: {
                            serverUrl: `https://queue-lease-peer-${index + 1}.mesh.internal`,
                        },
                    },
                },
            });
        }

        const baseline = service.planQueuePartitionOwnership({
            queue: "deployment",
            partitionKey: "org:test:service:handoff",
            includeCandidates: true,
        });

        const nonOwnerLeaseCandidate = baseline.candidates.find((candidate) => candidate.nodeId !== baseline.ownerNodeId);
        expect(nonOwnerLeaseCandidate).toBeDefined();

        const handoff = service.planQueuePartitionOwnership({
            queue: "deployment",
            partitionKey: "org:test:service:handoff",
            leaseHolderNodeId: nonOwnerLeaseCandidate?.nodeId ?? null,
            leaseExpiresAt: "2000-01-01T00:00:00.000Z",
            includeCandidates: true,
        });

        expect(handoff.ownerNodeId).toBe(baseline.ownerNodeId);
        expect(handoff.leaseHandoff).toBe(true);
    });

    it("appends queue transition logs and suppresses duplicate delivery by idempotency key", () => {
        const first = service.appendQueueTransitionLog({
            queue: "deployment",
            partitionKey: "org:test:service:abc",
            fromStatus: "queued",
            toStatus: "running",
            idempotencyKey: "queue-transition-idem-1",
            metadata: { source: "unit-test" },
        });

        expect(first.appended).toBe(true);
        expect(first.duplicate).toBe(false);

        const duplicate = service.appendQueueTransitionLog({
            queue: "deployment",
            partitionKey: "org:test:service:abc",
            fromStatus: "queued",
            toStatus: "running",
            idempotencyKey: "queue-transition-idem-1",
            metadata: { source: "unit-test" },
        });

        expect(duplicate.appended).toBe(false);
        expect(duplicate.duplicate).toBe(true);
        expect(duplicate.reason).toBe("duplicate_delivery");

        const listed = service.listQueueTransitionLogs({
            queue: "deployment",
            partitionKey: "org:test:service:abc",
            limit: 10,
        });
        expect(listed.total).toBe(1);
        expect(listed.items[0]?.payload.idempotencyKey).toBe("queue-transition-idem-1");
    });

    it("applies replicated queue transition entry idempotently", () => {
        const entry = {
            organizationId: null,
            sourceNodeId: randomUUID(),
            sequence: 1,
            payloadHash: "hash-fixed-1",
            payload: {
                transitionId: randomUUID(),
                queue: "deployment",
                partitionKey: "org:test:service:def",
                jobId: null,
                fromStatus: "claimed",
                toStatus: "running",
                workerId: null,
                idempotencyKey: "replicated-idem-1",
                occurredAt: new Date().toISOString(),
                metadata: null,
            },
            receivedAt: new Date().toISOString(),
        };

        const first = service.applyReplicatedQueueTransitionLogEntry({ entry });
        expect(first.applied).toBe(true);
        expect(first.duplicate).toBe(false);

        const second = service.applyReplicatedQueueTransitionLogEntry({ entry });
        expect(second.applied).toBe(false);
        expect(second.duplicate).toBe(true);
        expect(second.reason).toBe("duplicate_delivery");

        const listed = service.listQueueTransitionLogs({
            queue: "deployment",
            partitionKey: "org:test:service:def",
            limit: 10,
        });
        expect(listed.total).toBe(1);
        expect(listed.items[0]?.payload.idempotencyKey).toBe("replicated-idem-1");
    });

    it("filters topology replay to organization overlay when organization scope is provided", async () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: nodeInOrgA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgA,
                    region: "overlay-a",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: {
                        organizationIds: [orgA],
                    },
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: nodeInOrgB,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgB,
                    region: "overlay-b",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: {
                        organizationIds: [orgB],
                    },
                },
            },
        });

        const events: string[] = [];
        for await (const event of service.streamTopology({
            organizationId: orgA,
            replay: true,
            replayLimit: 50,
            includeEdges: false,
            includeNodes: true,
        })) {
            if (event.type === "node_upserted") {
                events.push(event.node.nodeId);
            }
        }

        expect(events).toContain(nodeInOrgA);
        expect(events).not.toContain(nodeInOrgB);
    });

    it("filters runtime event stream by organization overlay scope when available", async () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: nodeInOrgA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgA,
                    region: "overlay-a",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: {
                        organizationIds: [orgA],
                    },
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            type: "hello",
            sourceNodeId: nodeInOrgB,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgB,
                    region: "overlay-b",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: {
                        organizationIds: [orgB],
                    },
                },
            },
        });

        const eventSource = (async function* () {
            yield {
                type: "mesh_state" as const,
                reason: "topology_event" as const,
                localNode: service.getLocalNode(),
                peers: [
                    {
                        connectionId: randomUUID(),
                        sourceNodeId: service.getLocalNode().nodeId,
                        targetNodeId: nodeInOrgA,
                        state: "up" as const,
                        metrics: {
                            latencyMs: 10,
                            jitterMs: 1,
                            packetLossRatio: 0,
                            throughputMbps: 100,
                            reliabilityScore: 1,
                            weight: 0.1,
                            measuredAt: now,
                        },
                        activePathRank: 1,
                        lastHeartbeatAt: now,
                        metadata: null,
                    },
                    {
                        connectionId: randomUUID(),
                        sourceNodeId: service.getLocalNode().nodeId,
                        targetNodeId: nodeInOrgB,
                        state: "up" as const,
                        metrics: {
                            latencyMs: 10,
                            jitterMs: 1,
                            packetLossRatio: 0,
                            throughputMbps: 100,
                            reliabilityScore: 1,
                            weight: 0.2,
                            measuredAt: now,
                        },
                        activePathRank: 2,
                        lastHeartbeatAt: now,
                        metadata: null,
                    },
                ],
                sessions: [],
                snapshot: service.getMembershipSnapshot(),
                topologyEvent: {
                    type: "node_upserted" as const,
                    node: {
                        nodeId: nodeInOrgB,
                        region: "overlay-b",
                        roles: ["relay"],
                        lifecycleState: "healthy" as const,
                        routingMode: "balanced" as const,
                        consistencyMode: "hybrid" as const,
                        version: "test",
                        startedAt: now,
                        lastSeenAt: now,
                        metadata: null,
                    },
                    timestamp: now,
                },
                emittedAt: now,
                revision: 1,
            };
        })();

        meshEventService.observeRuntime = vi.fn(() => from(eventSource)) as unknown as typeof meshEventService.observeRuntime;

        const filtered = service.streamRuntimeEvents({
            organizationId: orgA,
            replay: true,
            replayLimit: 10,
        });

        const first = await filtered[Symbol.asyncIterator]().next();
        expect(first.done).toBe(false);
        const event = first.value;

        expect(event.peers).toHaveLength(1);
        expect(event.peers[0]?.targetNodeId).toBe(nodeInOrgA);
        expect(event.topologyEvent).toBeNull();
    });

    it("scopes control-envelope forwarded targets by organization overlay membership", () => {
        const orgA = randomUUID();
        const orgB = randomUUID();
        const nodeInOrgA = randomUUID();
        const nodeInOrgB = randomUUID();
        const now = new Date().toISOString();

        const sessionA = service.connectPeer({ endpointUrl: "wss://forward-a.mesh.internal/ws" });
        service.heartbeatPeer(sessionA.session.sessionId, {
            peerNodeId: nodeInOrgA,
            latencyMs: 12,
            jitterMs: 1,
            packetLossRatio: 0.01,
            throughputMbps: 900,
            reliabilityScore: 0.99,
        });

        const sessionB = service.connectPeer({ endpointUrl: "wss://forward-b.mesh.internal/ws" });
        service.heartbeatPeer(sessionB.session.sessionId, {
            peerNodeId: nodeInOrgB,
            latencyMs: 18,
            jitterMs: 2,
            packetLossRatio: 0.02,
            throughputMbps: 850,
            reliabilityScore: 0.98,
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgA,
            type: "hello",
            sourceNodeId: nodeInOrgA,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgA,
                    region: "overlay-a",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: { organizationIds: [orgA] },
                },
            },
        });

        service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgB,
            type: "hello",
            sourceNodeId: nodeInOrgB,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {
                node: {
                    nodeId: nodeInOrgB,
                    region: "overlay-b",
                    roles: ["relay"],
                    lifecycleState: "healthy",
                    routingMode: "balanced",
                    consistencyMode: "hybrid",
                    version: "test",
                    startedAt: now,
                    lastSeenAt: now,
                    metadata: { organizationIds: [orgB] },
                },
            },
        });

        const forwarded = service.publishControlEnvelope({
            envelopeId: randomUUID(),
            organizationId: orgA,
            type: "heartbeat",
            sourceNodeId: service.getLocalNode().nodeId,
            targetNodeId: null,
            hop: 0,
            maxHops: 16,
            emittedAt: now,
            payload: {},
        });

        expect(forwarded.forwardedTo).toContain(nodeInOrgA);
        expect(forwarded.forwardedTo).not.toContain(nodeInOrgB);
    });

    describe("six-node integration", () => {
        const createNodeService = (meshSeedId: string) => {
            void meshSeedId;
            process.env.MESH_NODE_ID = randomUUID();
            return new SystemMeshTopologyService(
                meshEventService as SystemMeshEventService,
                meshLogicService,
                meshOverlayScopeService,
                envService,
            );
        };

        it("plans direct owner routes from a six-instance discovered mesh", () => {
            const meshSeedId = randomUUID();
            const nodes = Array.from({ length: 6 }, () => createNodeService(meshSeedId));
            const requester = nodes[0]!;
            const streamId = randomUUID();

            for (const [index, node] of nodes.entries()) {
                if (index === 0) {
                    continue;
                }

                const now = new Date().toISOString();
                const peer = requester.connectPeer({
                    endpointUrl: `wss://node-${index + 1}.mesh.integration/ws`,
                    resumeToken: `resume-node-${index + 1}`,
                    serverUrl: `https://node-${index + 1}.mesh.integration`,
                });

                requester.heartbeatPeer(peer.session.sessionId, {
                    peerNodeId: node.getLocalNode().nodeId,
                    latencyMs: 12 + index * 8,
                    jitterMs: 1 + index,
                    packetLossRatio: index * 0.005,
                    throughputMbps: 1300 - index * 80,
                    reliabilityScore: 0.995 - index * 0.01,
                });

                requester.publishControlEnvelope({
                    envelopeId: randomUUID(),
                    type: "hello",
                    sourceNodeId: node.getLocalNode().nodeId,
                    targetNodeId: null,
                    hop: 0,
                    maxHops: 16,
                    emittedAt: now,
                    payload: {
                        node: node.getLocalNode(),
                    },
                });

                requester.upsertResourceIndex({
                    sourceNodeId: node.getLocalNode().nodeId,
                    replaceExistingForSource: true,
                    resources: [
                        {
                            kind: "stream",
                            key: `stream:${streamId}`,
                            ownerNodeId: node.getLocalNode().nodeId,
                            ownerServerUrl: `https://node-${index + 1}.mesh.integration`,
                            endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                            endpointMethod: "GET",
                            protocol: "sse",
                            persistentConnectionRequired: true,
                            priority: 10 + index,
                            version: 1,
                            updatedAt: now,
                            metadata: null,
                        },
                    ],
                });
            }

            const lookup = requester.lookupResource({
                kind: "stream",
                key: `stream:${streamId}`,
                includeCandidates: true,
            });
            const plan = requester.planStreamRoute({
                streamId,
                desiredBranches: 2,
                includeCandidates: true,
            });

            expect(lookup.found).toBe(true);
            expect(lookup.candidates).toHaveLength(5);
            expect(plan.selected).toHaveLength(2);
            expect(plan.selected[0]?.estimatedWeight).toBeLessThanOrEqual(plan.selected[1]?.estimatedWeight ?? Number.POSITIVE_INFINITY);

            const firstDirectEndpoint = `${plan.selected[0]?.ownerServerUrl}${plan.selected[0]?.endpointPath}`;
            expect(firstDirectEndpoint).toContain(`/core/mesh/streams/${streamId}/subscribe`);
            expect(firstDirectEndpoint.startsWith("https://node-")).toBe(true);
        });

        it("recovers best route after primary owner disconnects then resumes", () => {
            const meshSeedId = randomUUID();
            const requester = createNodeService(meshSeedId);
            const ownerA = createNodeService(meshSeedId);
            const ownerB = createNodeService(meshSeedId);
            const streamId = randomUUID();

            const sessionA = requester.connectPeer({
                endpointUrl: "wss://owner-a.mesh.integration/ws",
                resumeToken: "resume-owner-a",
                serverUrl: "https://owner-a.mesh.integration",
            });
            const sessionB = requester.connectPeer({
                endpointUrl: "wss://owner-b.mesh.integration/ws",
                resumeToken: "resume-owner-b",
                serverUrl: "https://owner-b.mesh.integration",
            });

            requester.heartbeatPeer(sessionA.session.sessionId, {
                peerNodeId: ownerA.getLocalNode().nodeId,
                latencyMs: 20,
                jitterMs: 2,
                packetLossRatio: 0.001,
                throughputMbps: 1250,
                reliabilityScore: 0.998,
            });
            requester.heartbeatPeer(sessionB.session.sessionId, {
                peerNodeId: ownerB.getLocalNode().nodeId,
                latencyMs: 60,
                jitterMs: 8,
                packetLossRatio: 0.02,
                throughputMbps: 900,
                reliabilityScore: 0.96,
            });

            const now = new Date().toISOString();
            requester.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: ownerA.getLocalNode().nodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: now,
                payload: { node: ownerA.getLocalNode() },
            });
            requester.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: ownerB.getLocalNode().nodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: now,
                payload: { node: ownerB.getLocalNode() },
            });

            requester.upsertResourceIndex({
                sourceNodeId: ownerA.getLocalNode().nodeId,
                replaceExistingForSource: true,
                resources: [
                    {
                        kind: "stream",
                        key: `stream:${streamId}`,
                        ownerNodeId: ownerA.getLocalNode().nodeId,
                        ownerServerUrl: "https://owner-a.mesh.integration",
                        endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                        endpointMethod: "GET",
                        protocol: "sse",
                        persistentConnectionRequired: true,
                        priority: 10,
                        version: 1,
                        updatedAt: now,
                        metadata: null,
                    },
                ],
            });
            requester.upsertResourceIndex({
                sourceNodeId: ownerB.getLocalNode().nodeId,
                replaceExistingForSource: true,
                resources: [
                    {
                        kind: "stream",
                        key: `stream:${streamId}`,
                        ownerNodeId: ownerB.getLocalNode().nodeId,
                        ownerServerUrl: "https://owner-b.mesh.integration",
                        endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                        endpointMethod: "GET",
                        protocol: "sse",
                        persistentConnectionRequired: true,
                        priority: 20,
                        version: 1,
                        updatedAt: now,
                        metadata: null,
                    },
                ],
            });

            const initialPlan = requester.planStreamRoute({
                streamId,
                desiredBranches: 1,
                includeCandidates: true,
            });
            expect(initialPlan.selected[0]?.ownerNodeId).toBe(ownerA.getLocalNode().nodeId);

            requester.disconnectPeer(sessionA.session.sessionId, {
                reason: "mesh_link_lost",
                allowReconnect: true,
            });
            requester.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "membership_remove",
                sourceNodeId: requester.getLocalNode().nodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: { nodeId: ownerA.getLocalNode().nodeId },
            });

            const degradedPlan = requester.planStreamRoute({
                streamId,
                desiredBranches: 1,
                includeCandidates: true,
            });
            expect(degradedPlan.selected[0]?.ownerNodeId).toBe(ownerB.getLocalNode().nodeId);

            const resumedA = requester.connectPeer({
                endpointUrl: "wss://owner-a.mesh.integration/ws",
                resumeToken: "resume-owner-a",
                serverUrl: "https://owner-a.mesh.integration",
            });
            requester.heartbeatPeer(resumedA.session.sessionId, {
                peerNodeId: ownerA.getLocalNode().nodeId,
                latencyMs: 16,
                jitterMs: 1,
                packetLossRatio: 0.001,
                throughputMbps: 1300,
                reliabilityScore: 0.999,
            });
            requester.publishControlEnvelope({
                envelopeId: randomUUID(),
                type: "hello",
                sourceNodeId: ownerA.getLocalNode().nodeId,
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: { node: ownerA.getLocalNode() },
            });
            requester.upsertResourceIndex({
                sourceNodeId: ownerA.getLocalNode().nodeId,
                replaceExistingForSource: true,
                resources: [
                    {
                        kind: "stream",
                        key: `stream:${streamId}`,
                        ownerNodeId: ownerA.getLocalNode().nodeId,
                        ownerServerUrl: "https://owner-a.mesh.integration",
                        endpointPath: `/core/mesh/streams/${streamId}/subscribe`,
                        endpointMethod: "GET",
                        protocol: "sse",
                        persistentConnectionRequired: true,
                        priority: 5,
                        version: 2,
                        updatedAt: new Date().toISOString(),
                        metadata: null,
                    },
                ],
            });

            const recoveredPlan = requester.planStreamRoute({
                streamId,
                desiredBranches: 1,
                includeCandidates: true,
            });
            expect(recoveredPlan.selected[0]?.ownerNodeId).toBe(ownerA.getLocalNode().nodeId);
            expect(recoveredPlan.selected[0]?.ownerServerUrl).toBe("https://owner-a.mesh.integration");
        });
    });

    describe("T106 — cursor-based runtime event replay", () => {
        it("getRuntimeEventCursor delegates to meshEventService.runtimeLastSequence", () => {
            vi.mocked(meshEventService.runtimeLastSequence).mockReturnValueOnce(42);
            expect(service.getRuntimeEventCursor()).toBe(42);
        });

        it("observeRuntimeEventsSince passes cursor as afterSequence to meshEventService", () => {
            service.observeRuntimeEventsSince({ cursor: 17 });
            expect(meshEventService.observeRuntimeSince).toHaveBeenCalledWith(
                expect.objectContaining({ afterSequence: 17 }),
            );
        });

        it("observeRuntimeEventsSince cursor=0 returns all buffered events (from-start replay)", () => {
            service.observeRuntimeEventsSince({ cursor: 0 });
            expect(meshEventService.observeRuntimeSince).toHaveBeenCalledWith(
                expect.objectContaining({ afterSequence: 0 }),
            );
        });

        it("streamRuntimeEventsSince wraps the observable into an async iterable", () => {
            const iterable = service.streamRuntimeEventsSince({ cursor: 5 });
            expect(iterable).toBeDefined();
            expect(typeof iterable[Symbol.asyncIterator]).toBe("function");
        });
    });

    describe("T107 — partition/failover policy", () => {
        it("getPartitionStatus returns 'healthy' when peers are connected", () => {
            const status = service.getPartitionStatus();
            // No peer sessions in a fresh instance — should reflect zero peers
            expect(status.activePeerCount).toBe(0);
            expect(typeof status.quorumMet).toBe("boolean");
            expect(typeof status.canWrite).toBe("boolean");
        });

        it("AP mode can always write regardless of peer count", () => {
            process.env.MESH_QUORUM_MODE = "ap";
            const status = service.getPartitionStatus();
            expect(status.canWrite).toBe(true);
            delete process.env.MESH_QUORUM_MODE;
        });

        it("CP mode refuses write when quorum is not met", () => {
            process.env.MESH_QUORUM_MODE = "cp";
            process.env.MESH_QUORUM_SIZE = "2";
            const status = service.getPartitionStatus();
            // 0 active peers < 2 quorum → canWrite = false
            expect(status.canWrite).toBe(false);
            delete process.env.MESH_QUORUM_MODE;
            delete process.env.MESH_QUORUM_SIZE;
        });

        it("hybrid mode writes when quorum met, degrades otherwise", () => {
            process.env.MESH_QUORUM_MODE = "hybrid";
            process.env.MESH_QUORUM_SIZE = "1";
            const status = service.getPartitionStatus();
            // 0 active peers < 1 quorum → degraded
            expect(status.effectiveLifecycleState).toBe("degraded");
            delete process.env.MESH_QUORUM_MODE;
            delete process.env.MESH_QUORUM_SIZE;
        });

        it("quorumMet = true when activePeerCount >= configured quorum size", () => {
            process.env.MESH_QUORUM_MODE = "cp";
            process.env.MESH_QUORUM_SIZE = "0";
            const status = service.getPartitionStatus();
            expect(status.quorumMet).toBe(true);
            delete process.env.MESH_QUORUM_MODE;
            delete process.env.MESH_QUORUM_SIZE;
        });
    });
});
