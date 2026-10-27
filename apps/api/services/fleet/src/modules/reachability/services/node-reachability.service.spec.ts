import { EgressRequestError } from "@deployer/shared/core/modules/egress/egress.service";
import { Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { makeNodeReachabilityService } from "./node-reachability.service";

describe("NodeReachabilityService outbound probes", () => {
    let egress: { operator: ReturnType<typeof vi.fn> };
    let reachability: { getNodePublicUrl: ReturnType<typeof vi.fn>; updateNodeNetworkConfig: ReturnType<typeof vi.fn> };
    let refresher: { refresh: ReturnType<typeof vi.fn> };
    let service: ReturnType<typeof makeNodeReachabilityService>;

    const res = (status: number) => ({ status, headers: {}, body: new Uint8Array(), url: "" });

    beforeEach(() => {
        egress = { operator: vi.fn() };
        reachability = { getNodePublicUrl: vi.fn(), updateNodeNetworkConfig: vi.fn() };
        refresher = { refresh: vi.fn() };
        service = makeNodeReachabilityService({
            reachability: reachability as never,
            accessPoint: {} as never,
            egress: egress as never,
            refresher: refresher as never,
        });
    });

    describe("check", () => {
        it("probes {url}/mesh/ping through the operator policy and reports the status", async () => {
            egress.operator.mockResolvedValue(res(200));
            const result = await Effect.runPromise(service.check("http://10.0.0.5:3005/"));
            expect(egress.operator).toHaveBeenCalledWith({ url: "http://10.0.0.5:3005/mesh/ping" });
            expect(result).toMatchObject({ reachable: true, statusCode: 200 });
        });

        it("reports a non-2xx as unreachable", async () => {
            egress.operator.mockResolvedValue(res(502));
            const result = await Effect.runPromise(service.check("http://10.0.0.5:3005"));
            expect(result).toMatchObject({ reachable: false, statusCode: 502, error: "HTTP 502" });
        });

        it("a refused target returns the generic reason: an authenticated user cannot use this as a port scanner", async () => {
            egress.operator.mockRejectedValue(new EgressRequestError("Target not allowed by the network policy", "operator"));
            const result = await Effect.runPromise(service.check("http://169.254.169.254"));
            expect(result).toMatchObject({ reachable: false, error: "Target not allowed by the network policy" });
        });

        it("a transport failure is a category, not the raw error", async () => {
            egress.operator.mockRejectedValue(
                new EgressRequestError("Connection failed", "operator", { cause: new Error("ECONNREFUSED 10.1.2.3:3005") }),
            );
            const result = await Effect.runPromise(service.check("http://10.1.2.3:3005"));
            expect(result.error).toBe("Connection failed");
        });
    });

    describe("probePublicUrl (the node's own public URL)", () => {
        it("probes /health through the operator policy", async () => {
            reachability.getNodePublicUrl.mockResolvedValue("https://api.example.com");
            egress.operator.mockResolvedValue(res(200));
            const result = await Effect.runPromise(service.probePublicUrl());
            expect(egress.operator).toHaveBeenCalledWith({ url: "https://api.example.com/health" });
            expect(result).toMatchObject({ reachable: true, lastStatus: "reachable" });
        });

        it("makes no request when there is no public URL", async () => {
            reachability.getNodePublicUrl.mockResolvedValue(null);
            const result = await Effect.runPromise(service.probePublicUrl());
            expect(egress.operator).not.toHaveBeenCalled();
            expect(result).toMatchObject({ publicUrl: null, reachable: null });
        });

        it("reports an unreachable URL as the answer, not as a failure", async () => {
            reachability.getNodePublicUrl.mockResolvedValue("https://api.example.com");
            egress.operator.mockRejectedValue(new Error("timeout"));
            const result = await Effect.runPromise(service.probePublicUrl());
            expect(result).toMatchObject({ reachable: false, lastStatus: "timeout" });
        });
    });

    describe("updateNodeNetworkConfig", () => {
        it("re-converges Traefik after the address changed, and returns only the node's own view", async () => {
            reachability.updateNodeNetworkConfig.mockResolvedValue({
                nodeId: "n1",
                publicAddress: "1.2.3.4",
                addressKind: "ipv4",
                updatedAt: "2026-10-27T00:00:00.000Z",
                tunnel: "must-not-leak",
            });
            const view = await Effect.runPromise(service.updateNodeNetworkConfig({ nodeId: "n1", publicAddress: "1.2.3.4" }));
            expect(refresher.refresh).toHaveBeenCalledOnce();
            expect(view).toEqual({
                nodeId: "n1",
                publicAddress: "1.2.3.4",
                addressKind: "ipv4",
                updatedAt: "2026-10-27T00:00:00.000Z",
            });
        });
    });
});
