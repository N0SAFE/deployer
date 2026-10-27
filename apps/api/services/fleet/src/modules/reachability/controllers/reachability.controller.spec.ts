import "@orpc/effect/extensions/effect";

import { effectContext } from "@deployer/nest-effect/testing";
import { callProcedure } from "@deployer/orpc-utils/testing";
import { Context, Effect } from "effect";
import { describe, expect, it, vi } from "vitest";

import { ReachabilityController } from "./reachability.controller";
import { IngressEdgeService, type IngressEdgeServiceShape } from "../services/ingress-edge.service";
import { NodeReachabilityService, type NodeReachabilityServiceShape } from "../services/node-reachability.service";

// Authentication and role checks are the shared middlewares' concern; here they let the call
// through so the rest of the chain (Effect context, `serve`, failure handling) runs for real.
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", async () => {
    const { os } = await import("@orpc/server");
    const passThrough = () => os.$context().middleware(({ next }) => next());
    return { requireAuth: passThrough, requirePlatformRole: passThrough };
});

const reachability = {
    check: vi.fn((url: string) => Effect.succeed({ url, reachable: true, latencyMs: 3, statusCode: 200 })),
    probePublicUrl: vi.fn(() => Effect.succeed({ publicUrl: null, lastCheckedAt: null, lastStatus: null, reachable: null })),
} as unknown as NodeReachabilityServiceShape;

const ingress = {
    revokeMeshMember: vi.fn(() => Effect.fail(Object.assign(new Error("platform said no"), { name: "Legacy" }))),
} as unknown as IngressEdgeServiceShape;

const context = {
    ...effectContext(Context.make(NodeReachabilityService, reachability).pipe(Context.add(IngressEdgeService, ingress))),
    auth: { user: { id: "u1", role: "admin" } },
    request: { headers: { "x-correlation-id": "c-1" } },
};

const controller = new ReachabilityController();
const call = <T>(implementation: unknown, input: unknown = {}) => callProcedure<T>(implementation, input, context);

describe("ReachabilityController", () => {
    it("runs a probe through the service and returns its answer", async () => {
        const result = await call<{ reachable: boolean }>(controller.check(), { url: "http://10.0.0.5:3005" });
        expect(result.reachable).toBe(true);
        expect(reachability.check).toHaveBeenCalledWith("http://10.0.0.5:3005");
    });

    it("answers the node's public URL probe on both config endpoints", async () => {
        await call(controller.getConfig());
        await call(controller.updateConfig(), { params: { id: "config" }, body: { publicUrl: "https://api.example.com" } });
        expect(reachability.probePublicUrl).toHaveBeenCalledTimes(2);
    });

    it("lets a platform collaborator's own refusal through unchanged, for the host to translate", async () => {
        await expect(call(controller.revokeMeshMember(), { memberId: "m1", reason: "x" })).rejects.toMatchObject({
            message: "platform said no",
            name: "Legacy",
        });
    });
});
