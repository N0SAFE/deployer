import { beforeEach, describe, expect, it, vi } from "vitest";

import { EgressRequestError } from "@deployer/shared/core/modules/egress/egress.service";

import { ReachabilityController } from "./reachability.controller";

const implementChainable = {
    use: vi.fn().mockReturnThis(),
    handler: vi.fn((fn: unknown) => ({ handler: fn })),
};

vi.mock("@orpc/nest", () => ({ Implement: vi.fn(() => () => undefined) }));
vi.mock("@orpc/server", async (importOriginal) => ({
    ...(await importOriginal<typeof import("@orpc/server")>()),
    implement: vi.fn(() => implementChainable),
}));
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", () => ({
    requireAuth: vi.fn(() => ({})),
    requirePlatformRole: vi.fn(() => ({})),
}));

type Handler = (args: { input: { url: string } }) => Promise<Record<string, unknown>>;

describe("ReachabilityController outbound probes", () => {
    let egress: { operator: ReturnType<typeof vi.fn> };
    let reachability: { getNodePublicUrl: ReturnType<typeof vi.fn> };
    let controller: ReachabilityController;

    const lastHandler = (): Handler => implementChainable.handler.mock.calls.at(-1)?.[0] as Handler;
    const res = (status: number) => ({ status, headers: {}, body: new Uint8Array(), url: "" });

    beforeEach(() => {
        egress = { operator: vi.fn() };
        reachability = { getNodePublicUrl: vi.fn() };
        controller = new ReachabilityController(reachability as never, {} as never, {} as never, {} as never, egress as never);
    });

    describe("check", () => {
        it("probes {url}/mesh/ping through the operator policy and reports the status", async () => {
            egress.operator.mockResolvedValue(res(200));
            controller.check();
            const result = await lastHandler()({ input: { url: "http://10.0.0.5:3005/" } });
            expect(egress.operator).toHaveBeenCalledWith({ url: "http://10.0.0.5:3005/mesh/ping" });
            expect(result).toMatchObject({ reachable: true, statusCode: 200 });
        });

        it("reports a non-2xx as unreachable", async () => {
            egress.operator.mockResolvedValue(res(502));
            controller.check();
            const result = await lastHandler()({ input: { url: "http://10.0.0.5:3005" } });
            expect(result).toMatchObject({ reachable: false, statusCode: 502, error: "HTTP 502" });
        });

        it("a refused target returns the generic reason: an authenticated user cannot use this as a port scanner", async () => {
            egress.operator.mockRejectedValue(new EgressRequestError("Target not allowed by the network policy", "operator"));
            controller.check();
            const result = await lastHandler()({ input: { url: "http://169.254.169.254" } });
            expect(result).toMatchObject({ reachable: false, error: "Target not allowed by the network policy" });
        });

        it("a transport failure is a category, not the raw error", async () => {
            egress.operator.mockRejectedValue(new EgressRequestError("Connection failed", "operator", { cause: new Error("ECONNREFUSED 10.1.2.3:3005") }));
            controller.check();
            const result = await lastHandler()({ input: { url: "http://10.1.2.3:3005" } });
            expect(result.error).toBe("Connection failed");
        });
    });

    describe("getConfig (the node's own public URL)", () => {
        it("probes /health through the operator policy", async () => {
            reachability.getNodePublicUrl.mockResolvedValue("https://api.example.com");
            egress.operator.mockResolvedValue(res(200));
            controller.getConfig();
            const result = await lastHandler()({ input: { url: "" } });
            expect(egress.operator).toHaveBeenCalledWith({ url: "https://api.example.com/health" });
            expect(result).toMatchObject({ reachable: true, lastStatus: "reachable" });
        });

        it("makes no request when there is no public URL", async () => {
            reachability.getNodePublicUrl.mockResolvedValue(null);
            controller.getConfig();
            const result = await lastHandler()({ input: { url: "" } });
            expect(egress.operator).not.toHaveBeenCalled();
            expect(result).toMatchObject({ publicUrl: null, reachable: null });
        });
    });
});
