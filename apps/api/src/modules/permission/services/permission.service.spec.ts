import { beforeEach, describe, expect, it, vi } from "vitest";
import { ForbiddenError } from "@repo/auth/permissions";
import { PermissionService } from "./permission.service";

// ---------------------------------------------------------------------------
// Mock PermissionEngine — we own the engine instance, swap it in after
// construction to avoid constructor-mock pitfalls.
// ---------------------------------------------------------------------------
const mockEngine = {
  check: vi.fn(),
  assert: vi.fn(),
  buildWhereClause: vi.fn(),
};

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------
const ctx = {
  userId: "user-1",
  platformRole: "member" as const,
};

const rule = {
  resource: "project" as const,
  actions: ["read"],
  scope: { type: "all" as const },
};

const roleRule = {
  id: "rule-1",
  roleName: "developer",
  resourceRules: [rule],
  createdAt: new Date("2024-01-01"),
  updatedAt: new Date("2024-01-01"),
};

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------
describe("PermissionService", () => {
  let service: PermissionService;
  let mockRepository: {
    getRoleRules: ReturnType<typeof vi.fn>;
    upsertRoleRules: ReturnType<typeof vi.fn>;
    deleteRoleRules: ReturnType<typeof vi.fn>;
    listRoleRules: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    mockRepository = {
      getRoleRules: vi.fn(),
      upsertRoleRules: vi.fn(),
      deleteRoleRules: vi.fn(),
      listRoleRules: vi.fn(),
    };

    // Instantiate directly; swap the private engine field so we control it.
    service = new PermissionService(mockRepository as never);
    (service as never as { engine: typeof mockEngine }).engine = mockEngine;

    vi.clearAllMocks();
  });

  it("should be defined", () => {
    expect(service).toBeDefined();
  });

  // ─────────────────────────────────────────────────────────────────────────
  // check()
  // ─────────────────────────────────────────────────────────────────────────
  describe("check", () => {
    it("should return ALLOW when engine resolves with ALLOW", async () => {
      const result = { decision: "ALLOW" as const, reason: "superAdmin bypass" };
      mockEngine.check.mockResolvedValue(result);

      const out = await service.check(ctx, "project", "read");

      expect(out).toEqual(result);
      expect(mockEngine.check).toHaveBeenCalledWith(ctx, "project", "read", undefined, undefined);
    });

    it("should return DENY when engine resolves with DENY", async () => {
      const result = { decision: "DENY" as const, reason: "No rule found" };
      mockEngine.check.mockResolvedValue(result);

      const out = await service.check(ctx, "project", "delete", "proj-99");

      expect(out).toEqual(result);
      expect(mockEngine.check).toHaveBeenCalledWith(ctx, "project", "delete", "proj-99", undefined);
    });

    it("should forward resourceId and record to engine", async () => {
      const record = { ownerId: "user-1" };
      mockEngine.check.mockResolvedValue({ decision: "ALLOW" as const, reason: "matched" });

      await service.check(ctx, "service", "update", "svc-1", record);

      expect(mockEngine.check).toHaveBeenCalledWith(ctx, "service", "update", "svc-1", record);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // assert()
  // ─────────────────────────────────────────────────────────────────────────
  describe("assert", () => {
    it("should resolve without throwing when engine allows", async () => {
      mockEngine.assert.mockResolvedValue(undefined);

      await expect(service.assert(ctx, "project", "read")).resolves.toBeUndefined();
      expect(mockEngine.assert).toHaveBeenCalledWith(ctx, "project", "read", undefined, undefined);
    });

    it("should propagate ForbiddenError thrown by engine", async () => {
      mockEngine.assert.mockRejectedValue(
        new ForbiddenError('Access denied: resource="project" action="delete"'),
      );

      await expect(service.assert(ctx, "project", "delete", "proj-1")).rejects.toThrow(ForbiddenError);
      expect(mockEngine.assert).toHaveBeenCalledWith(ctx, "project", "delete", "proj-1", undefined);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // buildWhereClause()
  // ─────────────────────────────────────────────────────────────────────────
  describe("buildWhereClause", () => {
    it("should return undefined (unrestricted) when engine returns undefined", async () => {
      mockEngine.buildWhereClause.mockResolvedValue(undefined);
      const idCol = {} as never;
      const resolver = vi.fn() as never;

      const out = await service.buildWhereClause(ctx, "project", "read", idCol, resolver);

      expect(out).toBeUndefined();
      expect(mockEngine.buildWhereClause).toHaveBeenCalledWith(ctx, "project", "read", idCol, resolver);
    });

    it("should return SQL predicate when engine returns one", async () => {
      const fakeSql = { sql: "1 = 0" } as never;
      mockEngine.buildWhereClause.mockResolvedValue(fakeSql);
      const idCol = {} as never;
      const resolver = vi.fn() as never;

      const out = await service.buildWhereClause(ctx, "project", "list", idCol, resolver);

      expect(out).toBe(fakeSql);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // upsertRoleRules()
  // ─────────────────────────────────────────────────────────────────────────
  describe("upsertRoleRules", () => {
    it("should delegate upsert to repository", async () => {
      mockRepository.upsertRoleRules.mockResolvedValue(undefined);

      await service.upsertRoleRules("developer", [rule]);

      expect(mockRepository.upsertRoleRules).toHaveBeenCalledWith("developer", [rule]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // deleteRoleRules()
  // ─────────────────────────────────────────────────────────────────────────
  describe("deleteRoleRules", () => {
    it("should delegate delete to repository", async () => {
      mockRepository.deleteRoleRules.mockResolvedValue(undefined);

      await service.deleteRoleRules("developer");

      expect(mockRepository.deleteRoleRules).toHaveBeenCalledWith("developer");
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // listRoleRules()
  // ─────────────────────────────────────────────────────────────────────────
  describe("listRoleRules", () => {
    it("should return all role rules for mesh", async () => {
      mockRepository.listRoleRules.mockResolvedValue([roleRule]);

      const result = await service.listRoleRules();

      expect(result).toEqual([roleRule]);
      expect(mockRepository.listRoleRules).toHaveBeenCalledWith();
    });

    it("should return empty array when mesh has no rules", async () => {
      mockRepository.listRoleRules.mockResolvedValue([]);

      const result = await service.listRoleRules();

      expect(result).toEqual([]);
    });
  });

  // ─────────────────────────────────────────────────────────────────────────
  // static ForbiddenError
  // ─────────────────────────────────────────────────────────────────────────
  describe("ForbiddenError static re-export", () => {
    it("should expose ForbiddenError from @repo/auth/permissions", () => {
      expect(PermissionService.ForbiddenError).toBe(ForbiddenError);
    });
  });
});
