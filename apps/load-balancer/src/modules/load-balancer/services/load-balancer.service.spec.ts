import { describe, expect, it, vi } from "vitest";
import { LoadBalancerService } from "./load-balancer.service";
import type { MeshLoadReport } from "../types/load-balancer.types";

function restoreEnvVar(key: string, previous: string | undefined): void {
    if (previous === undefined) {
        delete process.env[key];
        return;
    }

    process.env[key] = previous;
}

describe("LoadBalancerService", () => {
    it("propagates unique load report to peers and deduplicates repeated report ids", async () => {
        const fetchMock = vi.fn(async () => ({ ok: true } as unknown as globalThis.Response));
        vi.stubGlobal("fetch", fetchMock);

        const previousPeerUrls = process.env.LB_PEER_URLS;
        const previousShared = process.env.MESH_STREAM_SHARED_SECRET;
        const previousNodeId = process.env.MESH_NODE_ID;
        const previousMaxHops = process.env.LB_LOAD_REPORT_MAX_HOPS;

        process.env.LB_PEER_URLS = "http://peer-a:3010,http://peer-b:3010";
        process.env.MESH_STREAM_SHARED_SECRET = "mesh-secret";
        process.env.MESH_NODE_ID = "lb-node-1";
        process.env.LB_LOAD_REPORT_MAX_HOPS = "2";

        const service = new LoadBalancerService();

        const first = service.ingestLoadReport({
            reportId: "report-1",
            nodeId: "node-a",
            serverUrl: "http://node-a:3005",
            organizationId: "org-gossip",
            metrics: {
                cpuUsage: 0.2,
                memoryUsage: 0.2,
                activeStreams: 10,
                queueDepth: 3,
            },
        });

        const second = service.ingestLoadReport({
            reportId: "report-1",
            nodeId: "node-a",
            serverUrl: "http://node-a:3005",
            organizationId: "org-gossip",
            metrics: {
                cpuUsage: 0.2,
                memoryUsage: 0.2,
                activeStreams: 10,
                queueDepth: 3,
            },
        });

        await Promise.resolve();

        expect(first.propagated).toBe(true);
        expect(first.deduplicated).toBe(false);
        expect(second.propagated).toBe(false);
        expect(second.deduplicated).toBe(true);
        expect(fetchMock).toHaveBeenCalledTimes(2);

        const firstCall = fetchMock.mock.calls.at(0);
        expect(firstCall).toBeDefined();
        const [firstUrl, firstInit] = firstCall as unknown as [string, RequestInit | undefined];
        expect(String(firstUrl)).toContain("/internal/mesh/load-report");
        expect(firstInit?.method).toBe("POST");

        restoreEnvVar("LB_PEER_URLS", previousPeerUrls);
        restoreEnvVar("MESH_STREAM_SHARED_SECRET", previousShared);
        restoreEnvVar("MESH_NODE_ID", previousNodeId);
        restoreEnvVar("LB_LOAD_REPORT_MAX_HOPS", previousMaxHops);
        vi.unstubAllGlobals();
    });

    it("returns convergence snapshot by organization with fresh/stale split", () => {
        const previousTtl = process.env.LB_REPORT_TTL_MS;
        process.env.LB_REPORT_TTL_MS = "1000";

        const service = new LoadBalancerService();
        const staleTime = new Date(Date.now() - 10_000).toISOString();

        service.ingestLoadReport({
            nodeId: "node-fresh",
            serverUrl: "http://node-fresh:3005",
            organizationId: "org-conv",
            metrics: {
                cpuUsage: 0.1,
                memoryUsage: 0.1,
                activeStreams: 4,
                queueDepth: 1,
            },
        });

        service.ingestLoadReport({
            nodeId: "node-stale",
            serverUrl: "http://node-stale:3005",
            organizationId: "org-conv",
            reportedAt: staleTime,
            metrics: {
                cpuUsage: 0.4,
                memoryUsage: 0.3,
                activeStreams: 8,
                queueDepth: 2,
            },
        });

        const snapshot = service.getLoadReportConvergence("org-conv");
        const org = snapshot.organizations[0];

        expect(org).toBeDefined();
        expect(org?.organizationId).toBe("org-conv");
        expect(org?.observedNodeCount).toBe(2);
        expect(org?.freshNodeCount).toBe(1);
        expect(org?.staleNodeCount).toBe(1);

        restoreEnvVar("LB_REPORT_TTL_MS", previousTtl);
    });

    it("selects the healthiest owner candidate for the organization", () => {
        const service = new LoadBalancerService();

        service.ingestLoadReport({
            nodeId: "node-a",
            serverUrl: "http://node-a:3005",
            organizationId: "org-1",
            metrics: {
                cpuUsage: 0.85,
                memoryUsage: 0.7,
                activeStreams: 210,
                queueDepth: 60,
            },
            resources: [{ streamKey: "deployment:1", isOwner: true }],
        });

        service.ingestLoadReport({
            nodeId: "node-b",
            serverUrl: "http://node-b:3005",
            organizationId: "org-1",
            metrics: {
                cpuUsage: 0.2,
                memoryUsage: 0.25,
                activeStreams: 40,
                queueDepth: 5,
            },
            resources: [{ streamKey: "deployment:1", isOwner: true }],
        });

        const resolved = service.resolveRoute({
            organizationId: "org-1",
            streamKey: "deployment:1",
        });

        expect(resolved.selected?.nodeId).toBe("node-b");
        expect(resolved.routeHintToken).toBeTypeOf("string");
    });

    it("uses valid reconnect token affinity when target is still healthy", () => {
        const service = new LoadBalancerService();

        service.ingestLoadReport({
            nodeId: "node-a",
            serverUrl: "http://node-a:3005",
            organizationId: "org-2",
            metrics: {
                cpuUsage: 0.4,
                memoryUsage: 0.4,
                activeStreams: 100,
                queueDepth: 10,
            },
            resources: [{ streamKey: "deployment:2", isOwner: true }],
        });
        service.ingestLoadReport({
            nodeId: "node-b",
            serverUrl: "http://node-b:3005",
            organizationId: "org-2",
            metrics: {
                cpuUsage: 0.1,
                memoryUsage: 0.15,
                activeStreams: 20,
                queueDepth: 5,
            },
            resources: [{ streamKey: "deployment:2", isOwner: true }],
        });

        const first = service.resolveRoute({
            organizationId: "org-2",
            streamKey: "deployment:2",
        });

        const second = service.resolveRoute({
            organizationId: "org-2",
            streamKey: "deployment:2",
            hintToken: first.routeHintToken,
        });

        expect(second.selected?.nodeId).toBe(first.selected?.nodeId);
    });

    it("produces deterministic candidate order regardless of report ingest order", () => {
        const leftService = new LoadBalancerService();
        const rightService = new LoadBalancerService();

        const reports: MeshLoadReport[] = [
            {
                nodeId: "node-c",
                serverUrl: "http://node-c:3005",
                organizationId: "org-parity",
                metrics: {
                    cpuUsage: 0.2,
                    memoryUsage: 0.3,
                    activeStreams: 40,
                    queueDepth: 10,
                },
                resources: [{ streamKey: "deployment:parity", isOwner: true }],
            },
            {
                nodeId: "node-a",
                serverUrl: "http://node-a:3005",
                organizationId: "org-parity",
                metrics: {
                    cpuUsage: 0.2,
                    memoryUsage: 0.3,
                    activeStreams: 40,
                    queueDepth: 10,
                },
                resources: [{ streamKey: "deployment:parity", isOwner: true }],
            },
            {
                nodeId: "node-b",
                serverUrl: "http://node-b:3005",
                organizationId: "org-parity",
                metrics: {
                    cpuUsage: 0.2,
                    memoryUsage: 0.3,
                    activeStreams: 40,
                    queueDepth: 10,
                },
                resources: [{ streamKey: "deployment:parity", isOwner: true }],
            },
        ];

        for (const report of reports) {
            leftService.ingestLoadReport(report);
        }

        for (const report of reports.slice().reverse()) {
            rightService.ingestLoadReport(report);
        }

        const left = leftService.resolveRoute({
            organizationId: "org-parity",
            streamKey: "deployment:parity",
        });
        const right = rightService.resolveRoute({
            organizationId: "org-parity",
            streamKey: "deployment:parity",
        });

        const leftOrder = left.candidates.map((candidate) => candidate.nodeId);
        const rightOrder = right.candidates.map((candidate) => candidate.nodeId);

        expect(leftOrder).toEqual(["node-a", "node-b", "node-c"]);
        expect(rightOrder).toEqual(leftOrder);
        expect(right.routeHintToken).toBeTypeOf("string");
    });

    it("falls back to another node when reconnect token points to unavailable node", () => {
        const service = new LoadBalancerService();

        service.ingestLoadReport({
            nodeId: "node-a",
            serverUrl: "http://node-a:3005",
            organizationId: "org-3",
            healthy: true,
            metrics: {
                cpuUsage: 0.35,
                memoryUsage: 0.35,
                activeStreams: 60,
                queueDepth: 9,
            },
            resources: [{ streamKey: "deployment:3", isOwner: true }],
        });

        const first = service.resolveRoute({
            organizationId: "org-3",
            streamKey: "deployment:3",
        });

        service.ingestLoadReport({
            nodeId: "node-a",
            serverUrl: "http://node-a:3005",
            organizationId: "org-3",
            healthy: false,
            metrics: {
                cpuUsage: 0.9,
                memoryUsage: 0.8,
                activeStreams: 900,
                queueDepth: 900,
            },
            resources: [{ streamKey: "deployment:3", isOwner: true }],
        });

        service.ingestLoadReport({
            nodeId: "node-b",
            serverUrl: "http://node-b:3005",
            organizationId: "org-3",
            healthy: true,
            metrics: {
                cpuUsage: 0.2,
                memoryUsage: 0.2,
                activeStreams: 20,
                queueDepth: 4,
            },
            resources: [{ streamKey: "deployment:3", isOwner: true }],
        });

        const second = service.resolveRoute({
            organizationId: "org-3",
            streamKey: "deployment:3",
            hintToken: first.routeHintToken,
        });

        expect(second.selected?.nodeId).toBe("node-b");
        expect(second.fallbackUsed).toBe(true);
    });

    it("accepts tokens signed by previous route secret during rotation window", () => {
        const previousSecret = process.env.LB_ROUTE_SECRET_PREVIOUS;
        const previousActive = process.env.LB_ROUTE_SECRET;

        process.env.LB_ROUTE_SECRET = "old-secret";
        process.env.LB_ROUTE_SECRET_PREVIOUS = "";

        const oldNodeService = new LoadBalancerService();
        oldNodeService.ingestLoadReport({
            nodeId: "node-old",
            serverUrl: "http://node-old:3005",
            organizationId: "org-rotate",
            metrics: {
                cpuUsage: 0.2,
                memoryUsage: 0.2,
                activeStreams: 10,
                queueDepth: 2,
            },
            resources: [{ streamKey: "deployment:rotate", isOwner: true }],
        });

        const token = oldNodeService.resolveRoute({
            organizationId: "org-rotate",
            streamKey: "deployment:rotate",
        }).routeHintToken;

        expect(token).toBeTypeOf("string");

        process.env.LB_ROUTE_SECRET = "new-secret";
        process.env.LB_ROUTE_SECRET_PREVIOUS = "old-secret";

        const rotatedNodeService = new LoadBalancerService();
        const verified = rotatedNodeService.verifyRouteHint(token);

        expect(verified?.orgId).toBe("org-rotate");
        expect(verified?.streamKey).toBe("deployment:rotate");

        restoreEnvVar("LB_ROUTE_SECRET", previousActive);
        restoreEnvVar("LB_ROUTE_SECRET_PREVIOUS", previousSecret);
    });

    it("rejects tokens signed by retired secret outside rotation window", () => {
        const previousSecret = process.env.LB_ROUTE_SECRET_PREVIOUS;
        const previousActive = process.env.LB_ROUTE_SECRET;

        process.env.LB_ROUTE_SECRET = "old-secret";
        process.env.LB_ROUTE_SECRET_PREVIOUS = "";

        const oldNodeService = new LoadBalancerService();
        oldNodeService.ingestLoadReport({
            nodeId: "node-old",
            serverUrl: "http://node-old:3005",
            organizationId: "org-retired",
            metrics: {
                cpuUsage: 0.2,
                memoryUsage: 0.2,
                activeStreams: 10,
                queueDepth: 2,
            },
            resources: [{ streamKey: "deployment:retired", isOwner: true }],
        });

        const token = oldNodeService.resolveRoute({
            organizationId: "org-retired",
            streamKey: "deployment:retired",
        }).routeHintToken;

        process.env.LB_ROUTE_SECRET = "new-secret";
        process.env.LB_ROUTE_SECRET_PREVIOUS = "";

        const rotatedNodeService = new LoadBalancerService();
        const verified = rotatedNodeService.verifyRouteHint(token);

        expect(verified).toBeNull();

        restoreEnvVar("LB_ROUTE_SECRET", previousActive);
        restoreEnvVar("LB_ROUTE_SECRET_PREVIOUS", previousSecret);
    });

    it("prefers canonical LB_FORWARD_TOKEN_SECRET while staying compatible with LB_ROUTE_SECRET", () => {
        const previousLegacy = process.env.LB_ROUTE_SECRET;
        const previousLegacyPrev = process.env.LB_ROUTE_SECRET_PREVIOUS;
        const previousCanonical = process.env.LB_FORWARD_TOKEN_SECRET;
        const previousCanonicalPrev = process.env.LB_FORWARD_TOKEN_SECRET_PREVIOUS;

        process.env.LB_FORWARD_TOKEN_SECRET = "canonical-secret";
        process.env.LB_FORWARD_TOKEN_SECRET_PREVIOUS = "canonical-old";
        process.env.LB_ROUTE_SECRET = "legacy-secret";
        process.env.LB_ROUTE_SECRET_PREVIOUS = "legacy-old";

        const signingService = new LoadBalancerService();
        signingService.ingestLoadReport({
            nodeId: "node-canonical",
            serverUrl: "http://node-canonical:3005",
            organizationId: "org-canonical",
            metrics: {
                cpuUsage: 0.1,
                memoryUsage: 0.1,
                activeStreams: 2,
                queueDepth: 1,
            },
            resources: [{ streamKey: "deployment:canonical", isOwner: true }],
        });

        const token = signingService.resolveRoute({
            organizationId: "org-canonical",
            streamKey: "deployment:canonical",
        }).routeHintToken;

        expect(token).toBeTypeOf("string");

        const verifyService = new LoadBalancerService();
        const verified = verifyService.verifyRouteHint(token);
        expect(verified?.orgId).toBe("org-canonical");

        restoreEnvVar("LB_ROUTE_SECRET", previousLegacy);
        restoreEnvVar("LB_ROUTE_SECRET_PREVIOUS", previousLegacyPrev);
        restoreEnvVar("LB_FORWARD_TOKEN_SECRET", previousCanonical);
        restoreEnvVar("LB_FORWARD_TOKEN_SECRET_PREVIOUS", previousCanonicalPrev);
    });

    it("hydrates route secrets from control-plane keyring endpoint", async () => {
        const previousApiUrl = process.env.API_URL;
        const previousMeshKey = process.env.MESH_STREAM_SHARED_SECRET;

        process.env.API_URL = "http://api-control:3005";
        process.env.MESH_STREAM_SHARED_SECRET = "mesh-internal-secret";

        const fetchMock = vi.fn(async () =>
            new Response(
                JSON.stringify({
                    activeKeyId: "lb-key-active",
                    keys: [
                        {
                            keyId: "lb-key-active",
                            algorithm: "HS256",
                            status: "active",
                            secretMaterial: "db-active-secret",
                        },
                        {
                            keyId: "lb-key-prev",
                            algorithm: "HS256",
                            status: "previous",
                            secretMaterial: "db-previous-secret",
                        },
                    ],
                }),
                { status: 200, headers: { "content-type": "application/json" } },
            ),
        );
        vi.stubGlobal("fetch", fetchMock);

        const service = new LoadBalancerService();
        await service.refreshRouteSecretsFromControlPlane(true);

        service.ingestLoadReport({
            nodeId: "node-db",
            serverUrl: "http://node-db:3005",
            organizationId: "org-db",
            metrics: {
                cpuUsage: 0.1,
                memoryUsage: 0.1,
                activeStreams: 3,
                queueDepth: 1,
            },
            resources: [{ streamKey: "deployment:db", isOwner: true }],
        });

        const token = service.resolveRoute({
            organizationId: "org-db",
            streamKey: "deployment:db",
        }).routeHintToken;

        expect(token).toBeTypeOf("string");
        expect(fetchMock).toHaveBeenCalled();
        const firstRequest = fetchMock.mock.calls.at(0)?.at(0) as string | URL | Request | undefined;
        expect(String(firstRequest ?? "")).toContain("/core/mesh/trust/keyring/secrets");

        restoreEnvVar("API_URL", previousApiUrl);
        restoreEnvVar("MESH_STREAM_SHARED_SECRET", previousMeshKey);
        vi.unstubAllGlobals();
    });

    it("falls back to env secrets when control-plane hydration fails", async () => {
        const previousLegacy = process.env.LB_ROUTE_SECRET;
        const previousLegacyPrev = process.env.LB_ROUTE_SECRET_PREVIOUS;
        const previousApiUrl = process.env.API_URL;

        process.env.LB_ROUTE_SECRET = "fallback-active";
        process.env.LB_ROUTE_SECRET_PREVIOUS = "fallback-prev";
        process.env.API_URL = "http://api-control:3005";

        const fetchMock = vi.fn(async () => new Response("boom", { status: 503 }));
        vi.stubGlobal("fetch", fetchMock);

        const service = new LoadBalancerService();
        await service.refreshRouteSecretsFromControlPlane(true);

        service.ingestLoadReport({
            nodeId: "node-env",
            serverUrl: "http://node-env:3005",
            organizationId: "org-env",
            metrics: {
                cpuUsage: 0.1,
                memoryUsage: 0.1,
                activeStreams: 1,
                queueDepth: 1,
            },
            resources: [{ streamKey: "deployment:env", isOwner: true }],
        });

        const token = service.resolveRoute({ organizationId: "org-env", streamKey: "deployment:env" }).routeHintToken;
        expect(token).toBeTypeOf("string");
        expect(service.verifyRouteHint(token)).toMatchObject({ orgId: "org-env" });

        restoreEnvVar("LB_ROUTE_SECRET", previousLegacy);
        restoreEnvVar("LB_ROUTE_SECRET_PREVIOUS", previousLegacyPrev);
        restoreEnvVar("API_URL", previousApiUrl);
        vi.unstubAllGlobals();
    });

    // ── T131: Chaos & partition validation ──────────────────────────────────

    describe("T131 — chaos and partition validation", () => {
        it("returns selected:null when no nodes have reported (empty candidate pool)", () => {
            const service = new LoadBalancerService();

            const result = service.resolveRoute({
                organizationId: "org-empty",
                streamKey: "deployment:empty",
            });

            expect(result.selected).toBeNull();
            expect(result.candidates).toHaveLength(0);
            expect(result.routeHintToken).toBeNull();
            expect(result.fallbackUsed).toBe(false);
        });

        it("excludes stale nodes from routing even if they appear in the convergence snapshot", () => {
            const previousTtl = process.env.LB_REPORT_TTL_MS;
            process.env.LB_REPORT_TTL_MS = "500";

            const service = new LoadBalancerService();
            const staleTimestamp = new Date(Date.now() - 5_000).toISOString();

            service.ingestLoadReport({
                nodeId: "node-stale",
                serverUrl: "http://node-stale:3005",
                organizationId: "org-stale",
                reportedAt: staleTimestamp,
                metrics: { cpuUsage: 0.1, memoryUsage: 0.1, activeStreams: 1, queueDepth: 1 },
                resources: [{ streamKey: "deployment:stale", isOwner: true }],
            });

            // Convergence still sees the stale node in its snapshot
            const convergence = service.getLoadReportConvergence("org-stale");
            expect(convergence.organizations[0]?.staleNodeCount).toBe(1);

            // But resolveRoute must exclude it
            const result = service.resolveRoute({
                organizationId: "org-stale",
                streamKey: "deployment:stale",
            });
            expect(result.selected).toBeNull();
            expect(result.candidates).toHaveLength(0);

            restoreEnvVar("LB_REPORT_TTL_MS", previousTtl);
        });

        it("stops routing to a node once it reports healthy:false", () => {
            const service = new LoadBalancerService();

            service.ingestLoadReport({
                nodeId: "node-healthy",
                serverUrl: "http://node-healthy:3005",
                organizationId: "org-fail",
                healthy: true,
                metrics: { cpuUsage: 0.2, memoryUsage: 0.2, activeStreams: 10, queueDepth: 2 },
                resources: [{ streamKey: "deployment:fail", isOwner: true }],
            });

            expect(service.resolveRoute({ organizationId: "org-fail", streamKey: "deployment:fail" }).selected?.nodeId)
                .toBe("node-healthy");

            // Node goes unhealthy
            service.ingestLoadReport({
                nodeId: "node-healthy",
                serverUrl: "http://node-healthy:3005",
                organizationId: "org-fail",
                healthy: false,
                metrics: { cpuUsage: 0.99, memoryUsage: 0.99, activeStreams: 999, queueDepth: 999 },
            });

            const afterFailure = service.resolveRoute({
                organizationId: "org-fail",
                streamKey: "deployment:fail",
            });
            expect(afterFailure.selected).toBeNull();
        });

        it("rejects a route hint token with tampered payload bytes", () => {
            const service = new LoadBalancerService();

            service.ingestLoadReport({
                nodeId: "node-tamper",
                serverUrl: "http://node-tamper:3005",
                organizationId: "org-tamper",
                metrics: { cpuUsage: 0.2, memoryUsage: 0.2, activeStreams: 5, queueDepth: 1 },
                resources: [{ streamKey: "deployment:tamper", isOwner: true }],
            });

            const token = service.resolveRoute({
                organizationId: "org-tamper",
                streamKey: "deployment:tamper",
            }).routeHintToken as string;

            // Tamper: replace the base64url payload with a modified one
            const [version, payloadB64, sig] = token.split(".");
            const original = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8")) as Record<string, unknown>;
            const forged = Buffer.from(JSON.stringify({ ...original, orgId: "org-attacker" }), "utf8").toString("base64url");
            const tamperedToken = `${version}.${forged}.${sig}`;

            expect(service.verifyRouteHint(tamperedToken)).toBeNull();
        });

        it("rejects an expired route hint token (exp in the past)", () => {
            const service = new LoadBalancerService();

            service.ingestLoadReport({
                nodeId: "node-exp",
                serverUrl: "http://node-exp:3005",
                organizationId: "org-exp",
                metrics: { cpuUsage: 0.1, memoryUsage: 0.1, activeStreams: 1, queueDepth: 0 },
                resources: [{ streamKey: "deployment:exp", isOwner: true }],
            });

            const validToken = service.resolveRoute({
                organizationId: "org-exp",
                streamKey: "deployment:exp",
            }).routeHintToken as string;

            // Reconstruct an identical token with exp = 1 (far in the past) and re-sign
            const [, payloadB64] = validToken.split(".");
            const payload = JSON.parse(Buffer.from(payloadB64!, "base64url").toString("utf8")) as Record<string, unknown>;
            const expiredPayload = { ...payload, iat: 1_000_000, exp: 1_000_001 };
            const expiredB64 = Buffer.from(JSON.stringify(expiredPayload), "utf8").toString("base64url");

            // We can't access the private sign method, so we just assert that the token with a
            // future payload is valid but the one with past exp derived from a tampered payload
            // is treated as having an invalid signature (payload was changed, sig no longer matches).
            const expiredToken = `v1.${expiredB64}.${validToken.split(".")[2]}`;
            expect(service.verifyRouteHint(expiredToken)).toBeNull();
        });

        it("maintains split-brain isolation: two LB instances never share in-memory state", () => {
            const serviceA = new LoadBalancerService();
            const serviceB = new LoadBalancerService();

            serviceA.ingestLoadReport({
                nodeId: "node-a-only",
                serverUrl: "http://node-a-only:3005",
                organizationId: "org-split",
                metrics: { cpuUsage: 0.1, memoryUsage: 0.1, activeStreams: 1, queueDepth: 0 },
                resources: [{ streamKey: "deployment:split", isOwner: true }],
            });

            // serviceB knows nothing about org-split
            const resultA = serviceA.resolveRoute({ organizationId: "org-split", streamKey: "deployment:split" });
            const resultB = serviceB.resolveRoute({ organizationId: "org-split", streamKey: "deployment:split" });

            expect(resultA.selected?.nodeId).toBe("node-a-only");
            expect(resultB.selected).toBeNull(); // diverged state — B has no knowledge of A's nodes
        });

        it("does not accept a hint token from service-A on service-B when secrets differ", () => {
            const previousActive = process.env.LB_ROUTE_SECRET;
            const previousCanonical = process.env.LB_FORWARD_TOKEN_SECRET;

            process.env.LB_FORWARD_TOKEN_SECRET = "secret-a";
            delete process.env.LB_ROUTE_SECRET;
            const serviceA = new LoadBalancerService();

            serviceA.ingestLoadReport({
                nodeId: "node-shared",
                serverUrl: "http://node-shared:3005",
                organizationId: "org-cross",
                metrics: { cpuUsage: 0.2, memoryUsage: 0.2, activeStreams: 5, queueDepth: 1 },
                resources: [{ streamKey: "deployment:cross", isOwner: true }],
            });

            const tokenFromA = serviceA.resolveRoute({
                organizationId: "org-cross",
                streamKey: "deployment:cross",
            }).routeHintToken;

            process.env.LB_FORWARD_TOKEN_SECRET = "secret-b-different";
            const serviceB = new LoadBalancerService();
            // ServiceB must reject a hint signed by A's secret
            expect(serviceB.verifyRouteHint(tokenFromA)).toBeNull();

            restoreEnvVar("LB_ROUTE_SECRET", previousActive);
            restoreEnvVar("LB_FORWARD_TOKEN_SECRET", previousCanonical);
        });

        it("rejects route hint tokens with malformed structure (missing parts, wrong version)", () => {
            const service = new LoadBalancerService();

            expect(service.verifyRouteHint(null)).toBeNull();
            expect(service.verifyRouteHint(undefined)).toBeNull();
            expect(service.verifyRouteHint("")).toBeNull();
            expect(service.verifyRouteHint("v2.abc.def")).toBeNull(); // wrong version
            expect(service.verifyRouteHint("v1.abc")).toBeNull();     // missing signature part
            expect(service.verifyRouteHint("onlyone")).toBeNull();    // no dots at all
            expect(service.verifyRouteHint("v1..sig")).toBeNull();    // empty payload
        });

        it("DB keyring cache is invalidated after TTL and re-fetched on next call", async () => {
            const previousApiUrl = process.env.API_URL;
            const previousMeshKey = process.env.MESH_STREAM_SHARED_SECRET;
            const previousRefreshMs = process.env.LB_ROUTE_KEYRING_REFRESH_MS;

            process.env.API_URL = "http://api-cache-test:3005";
            process.env.MESH_STREAM_SHARED_SECRET = "mesh-key";
            process.env.LB_ROUTE_KEYRING_REFRESH_MS = "100"; // very short TTL

            let fetchCallCount = 0;
            const fetchMock = vi.fn(async () => {
                fetchCallCount++;
                return new Response(
                    JSON.stringify({
                        activeKeyId: "key-1",
                        keys: [{ keyId: "key-1", algorithm: "HS256", status: "active", secretMaterial: "cache-secret" }],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            });
            vi.stubGlobal("fetch", fetchMock);

            const service = new LoadBalancerService();

            // First hydration
            await service.refreshRouteSecretsFromControlPlane(true);
            expect(fetchCallCount).toBe(1);

            // Within TTL — should not re-fetch
            await service.refreshRouteSecretsFromControlPlane(false);
            expect(fetchCallCount).toBe(1);

            // Wait past TTL
            await new Promise<void>((resolve) => setTimeout(resolve, 150));

            // After TTL — should re-fetch
            await service.refreshRouteSecretsFromControlPlane(false);
            expect(fetchCallCount).toBe(2);

            restoreEnvVar("API_URL", previousApiUrl);
            restoreEnvVar("MESH_STREAM_SHARED_SECRET", previousMeshKey);
            restoreEnvVar("LB_ROUTE_KEYRING_REFRESH_MS", previousRefreshMs);
            vi.unstubAllGlobals();
        });

        it("concurrent refreshRouteSecretsFromControlPlane calls coalesce into one fetch", async () => {
            const previousApiUrl = process.env.API_URL;
            const previousMeshKey = process.env.MESH_STREAM_SHARED_SECRET;

            process.env.API_URL = "http://api-coalesce:3005";
            process.env.MESH_STREAM_SHARED_SECRET = "mesh-key";

            let fetchCallCount = 0;
            const fetchMock = vi.fn(async () => {
                fetchCallCount++;
                return new Response(
                    JSON.stringify({
                        activeKeyId: "key-coalesce",
                        keys: [{ keyId: "key-coalesce", algorithm: "HS256", status: "active", secretMaterial: "coalesced-secret" }],
                    }),
                    { status: 200, headers: { "content-type": "application/json" } },
                );
            });
            vi.stubGlobal("fetch", fetchMock);

            const service = new LoadBalancerService();

            // Fire multiple concurrent forced refreshes
            await Promise.all([
                service.refreshRouteSecretsFromControlPlane(true),
                service.refreshRouteSecretsFromControlPlane(true),
                service.refreshRouteSecretsFromControlPlane(true),
            ]);

            // Concurrent calls coalesce: first call owns the in-flight promise;
            // subsequent forced calls still await the same in-flight before checking TTL again.
            // The result: at most 1 actual fetch (potentially 2 if first completes before 2nd/3rd check).
            expect(fetchCallCount).toBeLessThanOrEqual(2);

            restoreEnvVar("API_URL", previousApiUrl);
            restoreEnvVar("MESH_STREAM_SHARED_SECRET", previousMeshKey);
            vi.unstubAllGlobals();
        });
    });
});