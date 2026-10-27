import { describe, expect, it, vi } from "vitest";
import { Effect } from "effect";
import { ForbiddenError, type ResourceRule } from "@deployer/auth/permissions";

import { PermissionRepository } from "../repositories/permission.repository";
import { PermissionService, PermissionServiceImpl } from "./permission.service";
import { DatabasePort } from "@identity/core/database/database.port";
import type { PermissionRepositoryShape } from "../repositories/permission.repository";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ctx = { userId: "user-1", platformRole: "developer" as const };
const record = { ownerId: "user-1" };

const readAllRule: ResourceRule = {
  resource: "project",
  actions: ["read"],
  scope: { type: "all" },
};

const row = {
  id: "rule-1",
  roleName: "developer",
  resourceRules: [readAllRule],
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

const service = new PermissionServiceImpl();

/** Fake repository whose methods are plain Effects — no DB needed. */
function fakeRepository(rules: ResourceRule[] = [readAllRule]) {
  return {
    getRoleRules: vi.fn((roleNames: string[]) =>
      Effect.succeed(roleNames.length === 0 ? [] : rules),
    ),
    upsertRoleRules: vi.fn(() => Effect.succeed(undefined)),
    deleteRoleRules: vi.fn(() => Effect.succeed(undefined)),
    listRoleRules: vi.fn(() => Effect.succeed([row])),
  } satisfies PermissionRepositoryShape;
}

/** Run a service Effect with the fake repository and an unused database. */
function run<A, E>(
  effect: Effect.Effect<A, E, PermissionRepository | DatabasePort>,
  repo: PermissionRepositoryShape,
): Promise<A> {
  return Effect.runPromise(
    effect.pipe(
      Effect.provideService(PermissionRepository, repo),
      Effect.provideService(DatabasePort, { db: {} as never }),
    ),
  );
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("PermissionService (Effect)", () => {
  describe("check", () => {
    it("allows when the role has a matching rule", async () => {
      const repo = fakeRepository();

      const out = await run(service.check(ctx, "project", "read"), repo);

      expect(out.decision).toBe("ALLOW");
      expect(repo.getRoleRules).toHaveBeenCalledWith(["developer"]);
    });

    it("denies when no rule matches the action", async () => {
      const out = await run(service.check(ctx, "project", "delete"), fakeRepository());

      expect(out.decision).toBe("DENY");
    });

    it("denies when the repository has no rules", async () => {
      const out = await run(service.check(ctx, "project", "read"), fakeRepository([]));

      expect(out.decision).toBe("DENY");
    });

    it("forwards the resource id and record to the engine", async () => {
      const out = await run(service.check(ctx, "project", "read", "proj-1", record), fakeRepository());

      expect(out.decision).toBe("ALLOW");
    });
  });

  describe("assert", () => {
    it("resolves when access is allowed", async () => {
      await expect(run(service.assert(ctx, "project", "read"), fakeRepository())).resolves.toBeUndefined();
    });

    it("fails with PermissionServiceFailure wrapping ForbiddenError on deny", async () => {
      const error = await run(service.assert(ctx, "project", "delete"), fakeRepository()).catch((e) => e);

      expect(error).toMatchObject({ _tag: "PermissionServiceFailure" });
      expect(error.cause).toBeInstanceOf(ForbiddenError);
    });
  });

  describe("buildWhereClause", () => {
    it("returns undefined when the role is unrestricted", async () => {
      const out = await run(
        service.buildWhereClause(ctx, "project", "read", {} as never, vi.fn() as never),
        fakeRepository(),
      );

      expect(out).toBeUndefined();
    });

    it("returns a SQL predicate when the role has no matching rule", async () => {
      const out = await run(
        service.buildWhereClause(ctx, "project", "delete", {} as never, vi.fn() as never),
        fakeRepository(),
      );

      expect(out).toBeDefined();
    });
  });

  describe("role rules CRUD", () => {
    it("delegates upsert to the repository", async () => {
      const repo = fakeRepository();

      await run(service.upsertRoleRules("developer", [readAllRule]), repo);

      expect(repo.upsertRoleRules).toHaveBeenCalledWith("developer", [readAllRule]);
    });

    it("delegates delete to the repository", async () => {
      const repo = fakeRepository();

      await run(service.deleteRoleRules("developer"), repo);

      expect(repo.deleteRoleRules).toHaveBeenCalledWith("developer");
    });

    it("lists role rules from the repository", async () => {
      const repo = fakeRepository();

      const out = await run(service.listRoleRules(), repo);

      expect(out).toEqual([row]);
      expect(repo.listRoleRules).toHaveBeenCalledWith();
    });

    it("maps a repository failure into PermissionServiceFailure", async () => {
      const repo = fakeRepository();
      repo.listRoleRules.mockImplementation(() => Effect.fail({ _tag: "PermissionRepositoryFailure", cause: new Error("db down") }) as never);

      const error = await run(service.listRoleRules(), repo).catch((e) => e);

      expect(error).toMatchObject({ _tag: "PermissionServiceFailure" });
      expect(error.cause).toBeInstanceOf(Error);
    });
  });

  describe("ForbiddenError static re-export", () => {
    it("exposes ForbiddenError from @deployer/auth/permissions", () => {
      expect(PermissionService.ForbiddenError).toBe(ForbiddenError);
    });
  });
});
