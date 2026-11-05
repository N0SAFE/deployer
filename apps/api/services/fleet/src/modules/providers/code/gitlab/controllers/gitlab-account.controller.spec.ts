import "@orpc/effect/extensions/effect";

import { Context, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { effectContext } from "@deployer/nest-effect/testing";
import { callProcedure } from "@deployer/orpc-utils/testing";

import { GitlabAppsStore, type GitlabAppsStoreShape } from "../repositories/gitlab-apps.repository";

import { GitlabAppsController } from "./gitlab-account.controller";

// Authentication and role checks are the shared middlewares' concern; here they let the call
// through so the rest of the chain (Effect context, the `.effect()` boundary, failure handling) runs for real.
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", async () => {
    const { os } = await import("@orpc/server");
    const passThrough = () => os.$context().middleware(({ next }) => next());
    return { requireAuth: passThrough, requirePlatformRole: passThrough };
});

const now = new Date("2026-10-29T10:00:00.000Z");
const row = { id: "g1", name: "main", url: "https://gitlab.example.com", isActive: true, createdAt: now, updatedAt: now };

describe("GitlabAppsController", () => {
    const store = {
        list: vi.fn(() => Effect.succeed([row])),
        findByName: vi.fn((_name: string) => Effect.succeed<{ id: string } | null>(null)),
        create: vi.fn((_input: unknown) => Effect.succeed<typeof row | null>(row)),
        deleteById: vi.fn((_id: string) => Effect.succeed<{ id: string } | null>({ id: "g1" })),
    };
    const context = {
        ...effectContext(Context.make(GitlabAppsStore, store as unknown as GitlabAppsStoreShape)),
        auth: { user: { id: "u1", role: "admin" } },
        request: { headers: { "x-correlation-id": "c-1" } },
    };
    const controller = new GitlabAppsController();
    const call = <T>(implementation: unknown, input: unknown = {}) => callProcedure<T>(implementation, input, context);

    beforeEach(() => {
        vi.clearAllMocks();
        store.findByName.mockReturnValue(Effect.succeed(null));
        store.create.mockReturnValue(Effect.succeed(row));
        store.deleteById.mockReturnValue(Effect.succeed({ id: "g1" }));
    });

    it("lists the accounts without the token, dates as ISO strings", async () => {
        const result = await call<{ apps: unknown[]; total: number }>(controller.list());

        expect(result.total).toBe(1);
        expect(result.apps[0]).toEqual({
            id: "g1",
            name: "main",
            url: "https://gitlab.example.com",
            isActive: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
    });

    it("creates an account", async () => {
        const result = await call(controller.create(), { name: "main", url: "https://gitlab.example.com", accessToken: "tok" });

        expect(result).toMatchObject({ id: "g1", name: "main" });
        expect(store.create).toHaveBeenCalledWith({ name: "main", url: "https://gitlab.example.com", accessToken: "tok" });
    });

    it("refuses a name that is already taken with a conflict, creating nothing", async () => {
        store.findByName.mockReturnValue(Effect.succeed({ id: "g0" }));

        await expect(
            call(controller.create(), { name: "main", url: "https://gitlab.example.com", accessToken: "tok" }),
        ).rejects.toMatchObject({ code: "CONFLICT", message: "A GitLab account named 'main' already exists" });
        expect(store.create).not.toHaveBeenCalled();
    });

    it("refuses an instance URL that is not a URL", async () => {
        await expect(
            call(controller.create(), { name: "main", url: "not a url", accessToken: "tok" }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Invalid GitLab URL: not a url" });
        expect(store.create).not.toHaveBeenCalled();
    });

    it("refuses when the insert returned no row", async () => {
        store.create.mockReturnValue(Effect.succeed(null));

        await expect(
            call(controller.create(), { name: "main", url: "https://gitlab.example.com", accessToken: "tok" }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Failed to create GitLab account" });
    });

    it("deletes an account", async () => {
        expect(await call(controller.delete(), { params: { id: "g1" } })).toEqual({ success: true });
    });

    it("answers not-found when the account to delete does not exist", async () => {
        store.deleteById.mockReturnValue(Effect.succeed(null));

        await expect(call(controller.delete(), { params: { id: "gone" } })).rejects.toMatchObject({
            code: "NOT_FOUND",
            message: "GitLab account 'gone' not found",
        });
    });
});
