import { beforeEach, describe, expect, it, vi } from "vitest";
import { SystemMeshController } from "./system-mesh.controller";

function createImplementMock() {
    type HandlerFn = (opts: { input: unknown; context: unknown }) => unknown;

    const chainable = {
        use: vi.fn().mockReturnThis(),
        handler: vi.fn((fn: HandlerFn) => ({ handler: fn })),
    };

    return chainable;
}

vi.mock("@orpc/nest", () => ({
    implement: vi.fn(() => createImplementMock()),
    Implement: vi.fn(() => () => {}),
}));

vi.mock("@/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
    requireMesh: vi.fn(() => ({})),
}));

describe("SystemMeshController", () => {
    let controller: SystemMeshController;
    let service: {
        getLocalNode: ReturnType<typeof vi.fn>;
        listPeers: ReturnType<typeof vi.fn>;
        listPeerSessions: ReturnType<typeof vi.fn>;
        connectPeer: ReturnType<typeof vi.fn>;
        disconnectPeer: ReturnType<typeof vi.fn>;
        heartbeatPeer: ReturnType<typeof vi.fn>;
        getMembershipSnapshot: ReturnType<typeof vi.fn>;
        reconcileMembership: ReturnType<typeof vi.fn>;
        observeTopology: ReturnType<typeof vi.fn>;
        observeRuntimeEvents: ReturnType<typeof vi.fn>;
        publishControlEnvelope: ReturnType<typeof vi.fn>;
        streamSession: ReturnType<typeof vi.fn>;
        lookupResource: ReturnType<typeof vi.fn>;
        upsertResourceIndex: ReturnType<typeof vi.fn>;
        planStreamRoute: ReturnType<typeof vi.fn>;
        planQueuePartitionOwnership: ReturnType<typeof vi.fn>;
        issueJoinGrant: ReturnType<typeof vi.fn>;
        consumeJoinGrant: ReturnType<typeof vi.fn>;
        registerNodeInCluster: ReturnType<typeof vi.fn>;
        revokeJoinGrant: ReturnType<typeof vi.fn>;
        getTrustKeyringStatus: ReturnType<typeof vi.fn>;
        getTrustKeyringSecrets: ReturnType<typeof vi.fn>;
        rotateTrustKey: ReturnType<typeof vi.fn>;
        getTrustKeyringConvergenceStatus: ReturnType<typeof vi.fn>;
        getTrustStrictReadiness: ReturnType<typeof vi.fn>;
        setTrustStrictMode: ReturnType<typeof vi.fn>;
        getTrustStrictRolloutPlan: ReturnType<typeof vi.fn>;
        rollbackTrustStrictMode: ReturnType<typeof vi.fn>;
    };
    let eventSyncService: {
        listStreams: ReturnType<typeof vi.fn>;
        getStreamById: ReturnType<typeof vi.fn>;
        streamSync: ReturnType<typeof vi.fn>;
    };
    let systemMetricsService: {
        getSnapshot: ReturnType<typeof vi.fn>;
    };

    beforeEach(() => {
        service = {
            getLocalNode: vi.fn(),
            listPeers: vi.fn(),
            listPeerSessions: vi.fn(),
            connectPeer: vi.fn(),
            disconnectPeer: vi.fn(),
            heartbeatPeer: vi.fn(),
            getMembershipSnapshot: vi.fn(),
            reconcileMembership: vi.fn(),
            observeTopology: vi.fn(),
            observeRuntimeEvents: vi.fn(),
            publishControlEnvelope: vi.fn(),
            streamSession: vi.fn(),
            lookupResource: vi.fn(),
            upsertResourceIndex: vi.fn(),
            planStreamRoute: vi.fn(),
            planQueuePartitionOwnership: vi.fn(),
            issueJoinGrant: vi.fn(),
            consumeJoinGrant: vi.fn(),
            registerNodeInCluster: vi.fn(),
            revokeJoinGrant: vi.fn(),
            getTrustKeyringStatus: vi.fn(),
            getTrustKeyringSecrets: vi.fn(),
            rotateTrustKey: vi.fn(),
            getTrustKeyringConvergenceStatus: vi.fn(),
            getTrustStrictReadiness: vi.fn(),
            setTrustStrictMode: vi.fn(),
            getTrustStrictRolloutPlan: vi.fn(),
            rollbackTrustStrictMode: vi.fn(),
        };
        eventSyncService = {
            listStreams: vi.fn(),
            getStreamById: vi.fn(),
            streamSync: vi.fn(),
        };
        systemMetricsService = {
            getSnapshot: vi.fn(),
        };
        controller = new SystemMeshController(service as never, eventSyncService as never, systemMetricsService as never);
    });

    it("should expose all ORPC handlers", () => {
        const methods: Array<keyof SystemMeshController> = [
            "getLocalNode",
            "listPeers",
            "listPeerSessions",
            "listEventStreams",
            "findEventStreamById",
            "subscribeEventStream",
            "planStreamRoute",
            "connectPeer",
            "disconnectPeer",
            "heartbeatPeer",
            "membershipSnapshot",
            "reconcileMembership",
            "streamTopology",
            "streamEvents",
            "publishControlEnvelope",
            "streamSession",
            "lookupResource",
            "upsertResourceIndex",
            "planQueuePartition",
            "issueJoinGrant",
            "consumeJoinGrant",
            "registerNode",
            "revokeJoinGrant",
            "trustKeyringStatus",
            "trustKeyringSecrets",
            "trustKeyringRotate",
            "trustKeyringConvergenceStatus",
            "trustStrictReadiness",
            "trustStrictModeSet",
            "trustStrictRolloutPlan",
            "trustStrictRollback",
        ];

        for (const method of methods) {
            const impl = (controller[method] as unknown as () => { handler: unknown })();
            expect(impl).toBeDefined();
            expect(typeof impl.handler).toBe("function");
        }
    });

    it("uses auth session activeOrganizationId for plan/lookup/upsert when input organizationId is missing", () => {
        const orgId = "org-active-123";
        service.planStreamRoute.mockReturnValue({});
        service.lookupResource.mockReturnValue({});
        service.upsertResourceIndex.mockReturnValue({});
        service.planQueuePartitionOwnership.mockReturnValue({});

        const context = {
            auth: {
                session: {
                    activeOrganizationId: orgId,
                },
            },
        };

        const planImpl = controller.planStreamRoute() as unknown as { handler: (opts: { input: unknown; context: unknown }) => unknown };
        planImpl.handler({
            input: {
                organizationId: null,
                streamId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
                desiredBranches: 1,
                includeCandidates: true,
            },
            context,
        });

        const lookupImpl = controller.lookupResource() as unknown as { handler: (opts: { input: unknown; context: unknown }) => unknown };
        lookupImpl.handler({
            input: {
                organizationId: null,
                kind: "stream",
                key: "stream:test",
                includeCandidates: true,
            },
            context,
        });

        const upsertImpl = controller.upsertResourceIndex() as unknown as { handler: (opts: { input: unknown; context: unknown }) => unknown };
        upsertImpl.handler({
            input: {
                organizationId: null,
                sourceNodeId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
                replaceExistingForSource: false,
                resources: [],
            },
            context,
        });

        const queuePlanImpl = controller.planQueuePartition() as unknown as { handler: (opts: { input: unknown; context: unknown }) => unknown };
        queuePlanImpl.handler({
            input: {
                organizationId: null,
                queue: "deployment",
                partitionKey: "service:abc",
                includeCandidates: true,
            },
            context,
        });

        expect(service.planStreamRoute).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
        expect(service.lookupResource).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
        expect(service.upsertResourceIndex).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
        expect(service.planQueuePartitionOwnership).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
    });

    it("prefers explicit organizationId over auth session active organization", () => {
        service.lookupResource.mockReturnValue({});

        const explicitOrgId = "org-explicit-456";
        const context = {
            auth: {
                session: {
                    activeOrganizationId: "org-active-123",
                },
            },
        };

        const lookupImpl = controller.lookupResource() as unknown as { handler: (opts: { input: unknown; context: unknown }) => unknown };
        lookupImpl.handler({
            input: {
                organizationId: explicitOrgId,
                kind: "deployment",
                key: "deployment:test",
                includeCandidates: true,
            },
            context,
        });

        expect(service.lookupResource).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: explicitOrgId }),
        );
    });

    it("passes auth session active organization to streamEvents", () => {
        const orgId = "org-active-999";
        service.observeRuntimeEvents.mockReturnValue({
            subscribe: vi.fn(() => ({ unsubscribe: vi.fn() })),
        });

        const streamImpl = controller.streamEvents() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        streamImpl.handler({
            input: {
                query: {
                    replay: true,
                    replayLimit: 25,
                },
            },
            context: {
                auth: {
                    session: {
                        activeOrganizationId: orgId,
                    },
                },
            },
        });

        expect(service.observeRuntimeEvents).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: orgId,
                replay: true,
                replayLimit: 25,
            }),
        );
    });

    it("passes auth session active organization to publishControlEnvelope when missing on input", () => {
        const orgId = "org-active-777";
        service.publishControlEnvelope.mockReturnValue({
            accepted: true,
            envelopeId: "env-1",
            forwardedTo: [],
        });

        const publishImpl = controller.publishControlEnvelope() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        publishImpl.handler({
            input: {
                envelopeId: "00000000-0000-4000-8000-000000000001",
                organizationId: null,
                type: "heartbeat",
                sourceNodeId: "00000000-0000-4000-8000-000000000002",
                targetNodeId: null,
                hop: 0,
                maxHops: 16,
                emittedAt: new Date().toISOString(),
                payload: {},
            },
            context: {
                auth: {
                    session: {
                        activeOrganizationId: orgId,
                    },
                },
            },
        });

        expect(service.publishControlEnvelope).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
    });

    it("passes auth session active organization to reconcileMembership when missing on input", () => {
        const orgId = "org-active-222";
        service.reconcileMembership.mockReturnValue({
            mergedNodes: 0,
            mergedConnections: 0,
            mergedSessions: 0,
            skippedStale: 0,
            version: 1,
        });

        const reconcileImpl = controller.reconcileMembership() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        reconcileImpl.handler({
            input: {
                organizationId: null,
                sourceNodeId: "00000000-0000-4000-8000-000000000010",
                dryRun: true,
                snapshot: {
                    version: 1,
                    generatedAt: new Date().toISOString(),
                    localNode: {
                        nodeId: "00000000-0000-4000-8000-000000000011",
                        region: "test",
                        roles: ["edge"],
                        lifecycleState: "healthy",
                        routingMode: "balanced",
                        consistencyMode: "hybrid",
                        version: "test",
                        startedAt: new Date().toISOString(),
                        lastSeenAt: new Date().toISOString(),
                        metadata: null,
                    },
                    nodes: [],
                    connections: [],
                    sessions: [],
                },
            },
            context: {
                auth: {
                    session: {
                        activeOrganizationId: orgId,
                    },
                },
            },
        });

        expect(service.reconcileMembership).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
    });

    it("passes auth session active organization to membershipSnapshot", () => {
        const orgId = "org-active-333";
        service.getMembershipSnapshot.mockReturnValue({
            version: 1,
            generatedAt: new Date().toISOString(),
            localNode: {
                nodeId: "00000000-0000-4000-8000-000000000111",
                region: "test",
                roles: ["edge"],
                lifecycleState: "healthy",
                routingMode: "balanced",
                consistencyMode: "hybrid",
                version: "test",
                startedAt: new Date().toISOString(),
                lastSeenAt: new Date().toISOString(),
                metadata: null,
            },
            nodes: [],
            connections: [],
            sessions: [],
        });

        const snapshotImpl = controller.membershipSnapshot() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        snapshotImpl.handler({
            input: {},
            context: {
                auth: {
                    session: {
                        activeOrganizationId: orgId,
                    },
                },
            },
        });

        expect(service.getMembershipSnapshot).toHaveBeenCalledWith(
            expect.objectContaining({ organizationId: orgId }),
        );
    });

    it("forwards actor and organization scope when issuing join grant", () => {
        const orgId = "11111111-1111-4111-8111-111111111111";
        const userId = "user-super-admin";
        service.issueJoinGrant.mockReturnValue({
            grantId: "22222222-2222-4222-8222-222222222222",
            grantToken: "token",
            expiresAt: new Date().toISOString(),
            status: "issued",
        });

        const impl = controller.issueJoinGrant() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        impl.handler({
            input: {
                organizationId: null,
                targetNodeId: null,
                ttlSeconds: 900,
                metadata: null,
            },
            context: {
                auth: {
                    user: {
                        id: userId,
                        role: "superAdmin",
                    },
                    session: {
                        activeOrganizationId: orgId,
                    },
                },
            },
        });

        expect(service.issueJoinGrant).toHaveBeenCalledWith(
            expect.objectContaining({
                organizationId: orgId,
                issuedByUserId: userId,
                issuedByRole: "superAdmin",
                ttlSeconds: 900,
            }),
        );
    });

    it("forwards actor when revoking join grant", () => {
        const userId = "user-super-admin-revoke";
        service.revokeJoinGrant.mockReturnValue({
            revoked: true,
            grantId: "44444444-4444-4444-8444-444444444444",
            status: "revoked",
            revokedAt: new Date().toISOString(),
        });

        const impl = controller.revokeJoinGrant() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        impl.handler({
            input: {
                grantId: "44444444-4444-4444-8444-444444444444",
                reason: "operator_cancel",
            },
            context: {
                auth: {
                    user: {
                        id: userId,
                        role: "superAdmin",
                    },
                },
            },
        });

        expect(service.revokeJoinGrant).toHaveBeenCalledWith(
            expect.objectContaining({
                grantId: "44444444-4444-4444-8444-444444444444",
                reason: "operator_cancel",
                revokedByUserId: userId,
                revokedByRole: "superAdmin",
            }),
        );
    });

    it("forwards actor role when rotating trust keyring", () => {
        service.rotateTrustKey.mockReturnValue({
            activeKeyId: "mesh-k2",
            rotatedKeyId: "mesh-k2",
            secretMaterial: "secret",
            keys: [{ keyId: "mesh-k2", algorithm: "HS256", status: "active" }],
        });

        const impl = controller.trustKeyringRotate() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        impl.handler({
            input: {
                keyId: "mesh-k2",
            },
            context: {
                auth: {
                    user: {
                        id: "user-super-admin",
                        role: "superAdmin",
                    },
                },
            },
        });

        expect(service.rotateTrustKey).toHaveBeenCalledWith(
            expect.objectContaining({
                keyId: "mesh-k2",
                rotatedByRole: "superAdmin",
            }),
        );
    });

    it("forwards actor role when setting strict trust mode", () => {
        service.setTrustStrictMode.mockReturnValue({
            requested: true,
            ready: true,
            strictConfigured: true,
            strictEnforced: true,
            activeKeyId: "mesh-k2",
            converged: true,
            expectedAcks: 1,
            receivedAcks: 1,
            ackRatio: 1,
            minAckRatio: 1,
            maxAckAgeSeconds: 300,
            lastRotationAgeSeconds: 1,
            reasons: [],
        });

        const impl = controller.trustStrictModeSet() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        impl.handler({
            input: {
                enabled: true,
            },
            context: {
                auth: {
                    user: {
                        id: "user-super-admin",
                        role: "superAdmin",
                    },
                },
            },
        });

        expect(service.setTrustStrictMode).toHaveBeenCalledWith(
            expect.objectContaining({
                enabled: true,
                setByRole: "superAdmin",
            }),
        );
    });

    it("forwards rollout wave size query for strict rollout plan", () => {
        service.getTrustStrictRolloutPlan.mockReturnValue({
            activeKeyId: "mesh-k2",
            strictConfigured: true,
            strictEnforced: false,
            waveSize: 2,
            ackedNodeIds: [],
            pendingNodeIds: [],
            waves: [],
            rollbackRecommended: false,
            rollbackTriggers: [],
        });

        const impl = controller.trustStrictRolloutPlan() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        impl.handler({
            input: {
                query: {
                    waveSize: 2,
                },
            },
            context: {},
        });

        expect(service.getTrustStrictRolloutPlan).toHaveBeenCalledWith(
            expect.objectContaining({
                waveSize: 2,
            }),
        );
    });

    it("forwards actor role for strict trust rollback", () => {
        service.rollbackTrustStrictMode.mockReturnValue({
            requested: false,
            rolledBack: true,
            ready: true,
            strictConfigured: false,
            strictEnforced: false,
            activeKeyId: "mesh-k2",
            converged: true,
            expectedAcks: 1,
            receivedAcks: 1,
            ackRatio: 1,
            minAckRatio: 1,
            maxAckAgeSeconds: 300,
            lastRotationAgeSeconds: 1,
            rollbackRecommended: false,
            rollbackTriggers: [],
            reasons: [],
        });

        const impl = controller.trustStrictRollback() as unknown as {
            handler: (opts: { input: unknown; context: unknown }) => unknown;
        };

        impl.handler({
            input: {
                force: true,
                reason: "operator_rollback",
            },
            context: {
                auth: {
                    user: {
                        id: "user-super-admin",
                        role: "superAdmin",
                    },
                },
            },
        });

        expect(service.rollbackTrustStrictMode).toHaveBeenCalledWith(
            expect.objectContaining({
                force: true,
                reason: "operator_rollback",
                setByRole: "superAdmin",
            }),
        );
    });
});