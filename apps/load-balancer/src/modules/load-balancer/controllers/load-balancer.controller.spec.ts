import { describe, expect, it, vi } from "vitest";
import { createHmac } from "node:crypto";
import { LoadBalancerController } from "./load-balancer.controller";
import type { LoadBalancerService } from "../services/load-balancer.service";
import type { ApiSessionAuthService } from "../../../core/modules/auth/services/api-session-auth.service";
import type { EnvService } from "../../../config/env/env.service";

function createResponseMock() {
    const headers = new Map<string, string>();
    const writes: string[] = [];

    const res = {
        setHeader: vi.fn((key: string, value: string) => {
            headers.set(key, value);
        }),
        status: vi.fn(() => res),
        flushHeaders: vi.fn(),
        write: vi.fn((chunk: string | Buffer) => {
            writes.push(typeof chunk === "string" ? chunk : chunk.toString("utf8"));
            return true;
        }),
        send: vi.fn(),
        end: vi.fn(),
    };

    return { res, headers, writes };
}

describe("LoadBalancerController", () => {
    it("emits structured reconnect signal when no upstream candidate can be opened", async () => {
        const loadBalancerService = {
            refreshRouteSecretsFromControlPlane: vi.fn(async () => undefined),
            resolveRoute: vi.fn(() => ({
                selected: {
                    nodeId: "node-a",
                    serverUrl: "http://node-a:3005",
                    score: 0.9,
                    healthy: true,
                    reason: "owner+load",
                },
                candidates: [
                    {
                        nodeId: "node-a",
                        serverUrl: "http://node-a:3005",
                        score: 0.9,
                        healthy: true,
                        reason: "owner+load",
                    },
                ],
                routeHintToken: "hint-token",
                fallbackUsed: false,
            })),
            buildRedirectUrl: vi.fn(() => "http://node-a:3005/deployments/stream-1/stream"),
        } as unknown as LoadBalancerService;

        const apiSessionAuthService = {
            getSessionFromRequestHeaders: vi.fn(async () => ({
                user: { id: "user-1" },
                session: { activeOrganizationId: "org-1" },
            })),
        } as unknown as ApiSessionAuthService;

        const envService = {
            get: vi.fn((key: string) => {
                if (key === "MESH_STREAM_SHARED_SECRET") {
                    return undefined;
                }
                return undefined;
            }),
        } as unknown as EnvService;

        const controller = new LoadBalancerController(loadBalancerService, apiSessionAuthService, envService);
        const { res, writes } = createResponseMock();

        const fetchMock = vi.fn(async () => {
            throw new Error("upstream unavailable");
        });
        vi.stubGlobal("fetch", fetchMock);

        await controller.routeStream(
            "stream-1",
            "org-1",
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            undefined,
            res as never,
        );

        expect(fetchMock).toHaveBeenCalledOnce();
        expect(res.setHeader).toHaveBeenCalledWith("X-LB-Reconnect-Signal", "1");
        expect(writes[0]).toContain("event: lb_reconnect");
        expect(writes[0]).toContain('"reason":"upstream_unavailable"');
        expect(writes[0]).toContain('"retryAfterMs":750');
        expect(res.end).toHaveBeenCalledOnce();

        vi.unstubAllGlobals();
    });

    it("proxies generic HTTP requests through selected load-balanced candidate", async () => {
        const loadBalancerService = {
            refreshRouteSecretsFromControlPlane: vi.fn(async () => undefined),
            resolveRoute: vi.fn(() => ({
                selected: {
                    nodeId: "node-b",
                    serverUrl: "http://node-b:3005",
                    score: 0.95,
                    healthy: true,
                    reason: "owner+load",
                },
                candidates: [
                    {
                        nodeId: "node-b",
                        serverUrl: "http://node-b:3005",
                        score: 0.95,
                        healthy: true,
                        reason: "owner+load",
                    },
                ],
                routeHintToken: "new-hint-token",
                fallbackUsed: false,
            })),
            buildRedirectUrl: vi.fn(() => "http://node-b:3005/api/projects"),
        } as unknown as LoadBalancerService;

        const apiSessionAuthService = {
            getSessionFromRequestHeaders: vi.fn(async () => ({
                user: { id: "user-1" },
                session: { activeOrganizationId: "org-1" },
            })),
        } as unknown as ApiSessionAuthService;

        const envService = {
            get: vi.fn(() => undefined),
        } as unknown as EnvService;

        const controller = new LoadBalancerController(loadBalancerService, apiSessionAuthService, envService);
        const { res } = createResponseMock();

        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    "content-type": "application/json",
                },
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        await controller.routeRequest(
            "deployment:1",
            "api/projects",
            "org-1",
            undefined,
            undefined,
            undefined,
            undefined,
            "session=abc",
            {
                method: "GET",
                url: "/route/deployment:1/api/projects?limit=10",
                headers: { accept: "application/json" },
                body: undefined,
            } as never,
            res as never,
        );

        expect(loadBalancerService.resolveRoute).toHaveBeenCalledWith({
            organizationId: "org-1",
            streamKey: "deployment:1",
            hintToken: null,
        });
        expect(fetchMock).toHaveBeenCalledOnce();
        expect(res.setHeader).toHaveBeenCalledWith("X-LB-Selected-Node", "node-b");
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledOnce();

        vi.unstubAllGlobals();
    });

    it("serves diagnostic payload when path fingerprint + signed diag key + auth are valid", async () => {
        const loadBalancerService = {
            refreshRouteSecretsFromControlPlane: vi.fn(async () => undefined),
            getLoadReportConvergence: vi.fn(() => ({ organizations: [], generatedAt: new Date().toISOString(), reportTtlMs: 30_000 })),
        } as unknown as LoadBalancerService;

        const apiSessionAuthService = {
            getSessionFromRequestHeaders: vi.fn(async () => ({
                user: { id: "user-diag" },
                session: { activeOrganizationId: "org-diag" },
            })),
        } as unknown as ApiSessionAuthService;

        const envService = {
            get: vi.fn((key: string) => {
                if (key === "LB_DIAGNOSTIC_PATH_FINGERPRINT") {
                    return "__lb_diag";
                }
                if (key === "LB_DIAGNOSTIC_SECRET") {
                    return "diag-secret";
                }
                if (key === "MESH_NODE_ID") {
                    return "lb-node-1";
                }
                return undefined;
            }),
        } as unknown as EnvService;

        const nowTs = Math.floor(Date.now() / 1000);
        const unsigned = `v1.${nowTs}`;
        const sig = createHmac("sha256", "diag-secret").update(unsigned).digest("base64url");
        const diagKey = `${unsigned}.${sig}`;

        const controller = new LoadBalancerController(loadBalancerService, apiSessionAuthService, envService);
        const { res } = createResponseMock();

        await controller.routeRequest(
            "stream:diag",
            "__lb_diag/metrics",
            undefined,
            diagKey,
            undefined,
            "Bearer test",
            undefined,
            "session=abc",
            {
                method: "GET",
                url: "/route/stream:diag/__lb_diag/metrics",
                headers: { accept: "application/json" },
                body: undefined,
            } as never,
            res as never,
        );

        expect(loadBalancerService.getLoadReportConvergence).toHaveBeenCalledWith("org-diag");
        expect(res.status).toHaveBeenCalledWith(200);
        expect(res.send).toHaveBeenCalledOnce();
    });

    it("uses LB_LOCAL_UPSTREAM_URL for selected local-node candidate", async () => {
        const loadBalancerService = {
            refreshRouteSecretsFromControlPlane: vi.fn(async () => undefined),
            resolveRoute: vi.fn(() => ({
                selected: {
                    nodeId: "lb-node-1",
                    serverUrl: "http://node-b:3005",
                    score: 0.95,
                    healthy: true,
                    reason: "owner+load",
                },
                candidates: [
                    {
                        nodeId: "lb-node-1",
                        serverUrl: "http://node-b:3005",
                        score: 0.95,
                        healthy: true,
                        reason: "owner+load",
                    },
                ],
                routeHintToken: "new-hint-token",
                fallbackUsed: false,
            })),
            buildRedirectUrl: vi.fn((input: { serverUrl: string; targetPath: string }) =>
                `${input.serverUrl}${input.targetPath}`,
            ),
        } as unknown as LoadBalancerService;

        const apiSessionAuthService = {
            getSessionFromRequestHeaders: vi.fn(async () => ({
                user: { id: "user-1" },
                session: { activeOrganizationId: "org-1" },
            })),
        } as unknown as ApiSessionAuthService;

        const envService = {
            get: vi.fn((key: string) => {
                if (key === "MESH_NODE_ID") {
                    return "lb-node-1";
                }
                if (key === "LB_LOCAL_UPSTREAM_URL") {
                    return "http://api-local:3005";
                }
                return undefined;
            }),
        } as unknown as EnvService;

        const controller = new LoadBalancerController(loadBalancerService, apiSessionAuthService, envService);
        const { res } = createResponseMock();

        const fetchMock = vi.fn(async () => {
            return new Response(JSON.stringify({ ok: true }), {
                status: 200,
                headers: {
                    "content-type": "application/json",
                },
            });
        });
        vi.stubGlobal("fetch", fetchMock);

        await controller.routeRequest(
            "deployment:1",
            "api/projects",
            "org-1",
            undefined,
            undefined,
            undefined,
            undefined,
            "session=abc",
            {
                method: "GET",
                url: "/route/deployment:1/api/projects?limit=10",
                headers: { accept: "application/json" },
                body: undefined,
            } as never,
            res as never,
        );

        const firstCall = loadBalancerService.buildRedirectUrl as unknown as ReturnType<typeof vi.fn>;
        expect(firstCall).toHaveBeenCalled();
        const firstArgs = firstCall.mock.calls[0]?.[0] as { serverUrl: string };
        expect(firstArgs.serverUrl).toBe("http://api-local:3005");

        vi.unstubAllGlobals();
    });
});
