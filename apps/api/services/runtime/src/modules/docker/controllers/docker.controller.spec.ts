import "@orpc/effect/extensions/effect";

import { of } from "rxjs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { callProcedure } from "@deployer/orpc-utils/testing";

import { DockerController } from "./docker.controller";

/**
 * `requireAuth` is stubbed — a real session lookup needs the whole auth stack (better-auth, the
 * database, a request) — while `requirePlatformRole` is the REAL middleware, so the refusal this
 * spec asserts is the one production runs. The stub stays a spy so a test can prove the
 * authenticated gate is still first on the chain.
 */
const auth = vi.hoisted(() => ({ requireAuth: vi.fn() }));

vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@deployer/shared/core/modules/auth/orpc/middlewares")>();
    const { os } = await import("@orpc/server");
    auth.requireAuth.mockImplementation(() => os.$context().middleware(({ next }) => next()));
    return { ...actual, requireAuth: auth.requireAuth };
});

/** The scan stream is the one mutation that reaches an injected collaborator, so it proves the pass. */
const streamImageSecurityScan = vi.fn(() => of({ id: "scan-1", event: {} }));

const controller = new DockerController(
    { streamContainerLogs: vi.fn(() => of()) } as never,
    { streamImageSecurityScan } as never,
    {} as never,
    {} as never,
);

/** Only the fields the auth middlewares read; the handler's services arrive through the Effect context. */
const call = <T>(implementation: unknown, input: unknown, role: string) =>
    callProcedure<T>(implementation, input, {
        auth: { isLoggedIn: true, session: { id: "s1" }, user: { id: "u1", role } },
        request: { headers: { "x-correlation-id": "c-1" } },
    });

const CONTAINER_ACTION = { containerId: "c1", action: "restart" };

describe("DockerController authorization", () => {
    beforeEach(() => {
        vi.clearAllMocks();
    });

    it("refuses a viewer's container action with FORBIDDEN", async () => {
        await expect(call(controller.runContainerAction(), CONTAINER_ACTION, "viewer")).rejects.toMatchObject({
            code: "FORBIDDEN",
            message: expect.stringContaining("superAdmin, admin, operator") as string,
        });
    });

    it("refuses a viewer's filesystem mutation and terminal session", async () => {
        const writes = [
            call(
                controller.writeContainerFile(),
                { containerId: "c1", path: "/etc/hosts", content: "x" },
                "viewer",
            ),
            call(
                controller.openContainerTerminalSession(),
                { containerId: "c1", shell: "bash", user: "root", workingDir: "/" },
                "viewer",
            ),
        ];

        for (const write of writes) {
            await expect(write).rejects.toMatchObject({ code: "FORBIDDEN" });
        }
    });

    it("lets an operator past the gate to the handler", async () => {
        const result = await call(controller.streamImageSecurityScan(), { query: { imageId: "sha256:abc" } }, "operator");

        expect(result).toBeDefined();
        expect(streamImageSecurityScan).toHaveBeenCalledWith({ imageId: "sha256:abc" });
    });

    it("keeps every mutating procedure behind requireAuth", () => {
        controller.runContainerAction();
        controller.deleteContainerPath();
        controller.closeContainerTerminalSession();

        expect(auth.requireAuth).toHaveBeenCalledTimes(3);
    });

    it("leaves the reads on requireAuth alone", async () => {
        auth.requireAuth.mockClear();

        const streams = await call(controller.streamContainerLogs(), { query: { containerId: "c1" } }, "viewer");

        expect(streams).toBeDefined();
        expect(auth.requireAuth).toHaveBeenCalledTimes(1);
    });
});
