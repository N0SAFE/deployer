import "@orpc/effect/extensions/effect";

import { Context, Effect } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { effectContext } from "@deployer/nest-effect/testing";
import { callProcedure } from "@deployer/orpc-utils/testing";

import { GitHub, type GitHubShape } from "@/core/ports/github.port";
import { PublicAccessPoint, type PublicAccessPointShape } from "@/core/ports/public-access-point.port";

import { GithubAppsStore, type GithubAppsStoreShape } from "../repositories/github-apps.repository";

import { GitHubAppsController } from "./github-account.controller";

// Authentication and role checks are the shared middlewares' concern; here they let the call
// through so the rest of the chain (Effect context, `serve`, failure handling) runs for real.
vi.mock("@deployer/shared/core/modules/auth/orpc/middlewares", async () => {
    const { os } = await import("@orpc/server");
    const passThrough = () => os.$context().middleware(({ next }) => next());
    return { requireAuth: passThrough, requirePlatformRole: passThrough };
});

const now = new Date("2026-10-29T10:00:00.000Z");
const row = {
    id: "a1",
    name: "main",
    appId: "100",
    clientId: "cid",
    clientSecret: "secret",
    privateKey: "pem",
    webhookSecret: "whsec",
    installationId: null as string | null,
    isActive: true,
    createdAt: now,
    updatedAt: now,
};

describe("GitHubAppsController", () => {
    const store = {
        list: vi.fn(() => Effect.succeed([row])),
        create: vi.fn((_input: unknown) => Effect.succeed<typeof row | null>(row)),
        updateById: vi.fn((_id: string, _values: unknown) => Effect.succeed<typeof row | null>(row)),
        deleteById: vi.fn((_id: string) => Effect.void),
        setInstallationByName: vi.fn((_name: string, _installationId: string) => Effect.succeed<{ id: string; appId: string } | null>({ id: "a1", appId: "100" })),
        findClientIdById: vi.fn((_id: string) => Effect.succeed<{ id: string; clientId: string } | null>({ id: "a1", clientId: "cid" })),
        findProviderApps: vi.fn((_providerAppId?: string) => Effect.succeed([row] as (typeof row)[])),
    };
    const gitHub = {
        registerInstallation: vi.fn(),
        listInstallations: vi.fn(),
        listInstallationRepositories: vi.fn(),
        listRepositoryBranches: vi.fn(),
    };
    const accessPoint = { getAccessPoint: vi.fn() };
    const context = {
        ...effectContext(
            Context.make(GithubAppsStore, store as unknown as GithubAppsStoreShape).pipe(
                Context.add(GitHub, gitHub as unknown as GitHubShape),
                Context.add(PublicAccessPoint, accessPoint as unknown as PublicAccessPointShape),
            ),
        ),
        auth: { user: { id: "u1", role: "admin" } },
        request: { headers: { "x-correlation-id": "c-1" } },
    };
    const controller = new GitHubAppsController();
    const call = <T>(implementation: unknown, input: unknown = {}) => callProcedure<T>(implementation, input, context);

    beforeEach(() => {
        vi.clearAllMocks();
        store.create.mockReturnValue(Effect.succeed(row));
        store.updateById.mockReturnValue(Effect.succeed(row));
        store.setInstallationByName.mockReturnValue(Effect.succeed({ id: "a1", appId: "100" }));
        store.findClientIdById.mockReturnValue(Effect.succeed({ id: "a1", clientId: "cid" }));
        store.findProviderApps.mockReturnValue(Effect.succeed([row]));
        row.installationId = null;
    });

    it("lists the apps without their secrets", async () => {
        const result = await call<{ apps: Record<string, unknown>[]; total: number }>(controller.list());

        expect(result.total).toBe(1);
        expect(result.apps[0]).toEqual({
            id: "a1",
            name: "main",
            appId: "100",
            clientId: "cid",
            isActive: true,
            createdAt: now.toISOString(),
            updatedAt: now.toISOString(),
        });
    });

    it("refuses when the insert returned no row", async () => {
        store.create.mockReturnValue(Effect.succeed(null));

        await expect(
            call(controller.create(), { name: "main", appId: "100", clientId: "c", clientSecret: "s", privateKey: "k", webhookSecret: "w" }),
        ).rejects.toMatchObject({ code: "BAD_REQUEST", message: "Failed to create GitHub App" });
    });

    it("answers not-found when the app to update does not exist", async () => {
        store.updateById.mockReturnValue(Effect.succeed(null));

        await expect(call(controller.update(), { params: { id: "gone" }, body: { name: "x" } })).rejects.toMatchObject({
            code: "NOT_FOUND",
            message: "GitHub App not found",
        });
    });

    it("updates only the fields it is given", async () => {
        await call(controller.update(), { params: { id: "a1" }, body: { name: "renamed" } });

        expect(store.updateById).toHaveBeenCalledWith("a1", { name: "renamed" });
    });

    it("records the installation on the app named in the setup URL", async () => {
        const result = await call(controller.installCallback(), { appName: "deployer-abc", installationId: "42" });

        expect(store.setInstallationByName).toHaveBeenCalledWith("deployer-abc", "42");
        expect(result).toEqual({ success: true, appName: "deployer-abc", installationId: "42" });
    });

    it("refuses an installation id that is not a positive number", async () => {
        await expect(call(controller.installCallback(), { appName: "deployer-abc", installationId: "nope" })).rejects.toMatchObject({
            code: "BAD_REQUEST",
            message: "Invalid installation id: nope",
        });
        expect(store.setInstallationByName).not.toHaveBeenCalled();
    });

    it("answers not-found when no app carries the name in the setup URL", async () => {
        store.setInstallationByName.mockReturnValue(Effect.succeed(null));

        await expect(call(controller.installCallback(), { appName: "deployer-abc", installationId: "42" })).rejects.toMatchObject({
            code: "NOT_FOUND",
            message: "GitHub App not found by name: deployer-abc",
        });
    });

    it("refuses an OAuth start when the node has no public access point", async () => {
        accessPoint.getAccessPoint.mockResolvedValue({ configured: false, error: "No access point" });

        await expect(call(controller.oauthInit(), { params: { appId: "a1" }, body: { url: "x", state: "y" } })).rejects.toMatchObject({
            code: "BAD_REQUEST",
            message: "No access point",
        });
    });

    it("starts an OAuth flow towards the node's public URL", async () => {
        accessPoint.getAccessPoint.mockResolvedValue({ configured: true, reachable: true, publicUrl: "https://deploy.example.com" });

        const result = await call<{ url: string; state: string }>(controller.oauthInit(), { params: { appId: "a1" }, body: { url: "x", state: "y" } });

        expect(result.url).toContain("client_id=cid");
        expect(result.url).toContain(encodeURIComponent("https://deploy.example.com/github/oauth/callback"));
        expect(result.state.startsWith("a1:")).toBe(true);
    });

    it("answers not-found for an OAuth start on an unknown app", async () => {
        store.findClientIdById.mockReturnValue(Effect.succeed(null));

        await expect(call(controller.oauthInit(), { params: { appId: "gone" }, body: { url: "x", state: "y" } })).rejects.toMatchObject({ code: "NOT_FOUND" });
    });

    describe("listRepos", () => {
        it("lists nothing when there is no app", async () => {
            store.findProviderApps.mockReturnValue(Effect.succeed([]));

            expect(await call(controller.listRepos())).toEqual({ repos: [] });
        });

        it("discovers the installation from GitHub when the database has none, and stores it", async () => {
            gitHub.listInstallations.mockResolvedValue([{ id: 42 }]);
            gitHub.listInstallationRepositories.mockResolvedValue([
                { id: 1, name: "repo", full_name: "org/repo", description: null, html_url: "u", default_branch: "main", language: "TypeScript", private: false },
            ]);

            const result = await call<{ repos: { full_name: string }[]; _meta: { installed: boolean } }>(controller.listRepos());

            expect(gitHub.registerInstallation).toHaveBeenCalledWith("a1", expect.objectContaining({ appId: "100", privateKey: "pem" }));
            expect(store.updateById).toHaveBeenCalledWith("a1", { installationId: "42" });
            expect(gitHub.listInstallationRepositories).toHaveBeenCalledWith("a1", 42);
            expect(result.repos[0]?.full_name).toBe("org/repo");
            expect(result._meta.installed).toBe(true);
        });

        it("says the app is not installed when GitHub knows no installation, and when discovery fails", async () => {
            gitHub.listInstallations.mockResolvedValueOnce([]);
            expect(await call(controller.listRepos())).toMatchObject({ repos: [], _meta: { installed: false } });

            gitHub.listInstallations.mockRejectedValueOnce(new Error("github down"));
            expect(await call(controller.listRepos())).toMatchObject({ repos: [], _meta: { installed: false } });
            expect(gitHub.listInstallationRepositories).not.toHaveBeenCalled();
        });

        it("does not register a personal-access-token app, which has no app credentials", async () => {
            store.findProviderApps.mockReturnValue(Effect.succeed([{ ...row, appId: "pat", installationId: "7" }]));
            gitHub.listInstallationRepositories.mockResolvedValue([]);

            await call(controller.listRepos());

            expect(gitHub.registerInstallation).not.toHaveBeenCalled();
        });
    });

    describe("listBranches", () => {
        it("lists no branches when the app is not installed anywhere", async () => {
            gitHub.listInstallations.mockResolvedValue([]);

            expect(await call(controller.listBranches(), { params: { owner: "org", repo: "repo" } })).toEqual({
                owner: "org",
                repo: "repo",
                branches: [],
            });
        });

        it("lists the branches through the app's installation", async () => {
            row.installationId = "42";
            gitHub.listRepositoryBranches.mockResolvedValue([{ name: "main", sha: "abc", protected: false }]);

            const result = await call<{ branches: unknown[] }>(controller.listBranches(), { params: { owner: "org", repo: "repo" } });

            expect(gitHub.listRepositoryBranches).toHaveBeenCalledWith("a1", 42, "org", "repo");
            expect(result.branches).toEqual([{ name: "main", sha: "abc", protected: false }]);
        });
    });

    describe("detectRunner", () => {
        it("detects nothing without an app, or without an installation", async () => {
            store.findProviderApps.mockReturnValue(Effect.succeed([]));
            expect(await call(controller.detectRunner(), { params: { owner: "org", repo: "repo" } })).toEqual({ detected: [], defaultBuilder: null });

            store.findProviderApps.mockReturnValue(Effect.succeed([row]));
            gitHub.listInstallations.mockResolvedValue([]);
            expect(await call(controller.detectRunner(), { params: { owner: "org", repo: "repo" } })).toEqual({ detected: [], defaultBuilder: null });
        });
    });
});
