import "@orpc/effect/extensions/effect";

import { Context, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { effectContext } from "@deployer/nest-effect/testing";
import { callProcedure } from "@deployer/orpc-utils/testing";

import { ClusterService, type ClusterServiceShape } from "../services/cluster.service";

import { ClusterController } from "./cluster.controller";

/**
 * `requireAuth` is stubbed — a real session lookup needs the whole auth stack — while
 * `requirePlatformRole` is the REAL middleware, so the refusal this spec asserts is the one
 * production runs. The stub stays a spy so a test can prove the authenticated gate is still there.
 */
const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));

vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@deployer/shared/core/modules/auth/orpc/middlewares")>();
    const { os } = await import("@orpc/server");
    auth.requireAuth.mockImplementation(() => os.$context().middleware(({ next }) => next()));
    return { ...actual, requireAuth: auth.requireAuth };
});

const node = {
    nodeId: "node-1",
    hostname: "node-1",
    swarmRole: "worker",
    platformRole: "worker",
    isMaster: false,
    isIngress: false,
    availability: "active",
    capacity: { nanoCpus: null, memoryBytes: null },
    labels: {},
    lastHeartbeatAt: null,
} as const;

const cluster = {
    updateNodeLabels: vi.fn(() => Effect.succeed(node)),
    listNodes: vi.fn(() => Effect.succeed([])),
} as unknown as ClusterServiceShape;

const context = (role: string) => ({
    ...effectContext(Context.make(ClusterService, cluster)),
    auth: { isLoggedIn: true, session: { id: "s1" }, user: { id: "u1", role } },
    request: { headers: { "x-correlation-id": "c-1" } },
});

const call = <T>(implementation: unknown, input: unknown, role: string) =>
    callProcedure<T>(implementation, input, context(role));

const RELABEL = { params: { nodeId: "node-1" }, body: { platformRole: "worker", ingress: false } };

describe("ClusterController authorization", () => {
    const controller = new ClusterController();

    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses a viewer's node relabel with FORBIDDEN", async () => {
        await expect(call(controller.updateNode(), RELABEL, "viewer")).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: expect.stringContaining("superAdmin, admin, operator") as string,
        });
        expect(cluster.updateNodeLabels).not.toHaveBeenCalled();
    });

    it("refuses a viewer's swarm config change", async () => {
        await expect(
            call(controller.setSwarmConfig(), { mode: "join", policy: "worker" }, "viewer"),
        ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    it("lets an operator relabel a node", async () => {
        const result = await call<{ nodeId: string }>(controller.updateNode(), RELABEL, "operator");

        expect(result.nodeId).toBe("node-1");
        expect(cluster.updateNodeLabels).toHaveBeenCalledWith("node-1", { platformRole: "worker", ingress: false });
    });

    it("leaves the cluster reads open to a viewer", async () => {
        const result = await call<unknown[]>(controller.listNodes(), { includeDown: false }, "viewer");

        expect(result).toEqual([]);
        expect(cluster.listNodes).toHaveBeenCalledWith(false);
    });

    it("keeps every node mutation behind requireAuth", () => {
        controller.updateNode();
        controller.setSwarmConfig();

        expect(auth.requireAuth).toHaveBeenCalledTimes(2);
    });
});
