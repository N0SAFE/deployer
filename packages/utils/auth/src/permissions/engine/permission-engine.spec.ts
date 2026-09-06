import { describe, it, expect, vi, beforeEach } from "vitest";
import { PermissionEngine, ForbiddenError } from "./permission-engine";
import type {
    RoleRuleLoader,
    ResourceRecordLoader,
} from "./permission-engine";
import type { EngineContext, ResourceRule } from "./types";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makeCtx(overrides: Partial<EngineContext> = {}): EngineContext {
    return {
        userId: "user-1",
        ...overrides,
    };
}

function makeRule(overrides: Partial<ResourceRule> = {}): ResourceRule {
    return {
        resource: "project",
        actions: ["read"],
        scope: { type: "all" },
        ...overrides,
    };
}

function makeEngine(
    rules: ResourceRule[],
    recordLoader?: ResourceRecordLoader,
) {
    const loadRoleRules: RoleRuleLoader = vi.fn().mockResolvedValue(rules);
    return new PermissionEngine({
        loadRoleRules,
        loadResourceRecord: recordLoader,
    });
}

// ---------------------------------------------------------------------------
// superAdmin bypass
// ---------------------------------------------------------------------------

describe("PermissionEngine — superAdmin bypass", () => {
    it("returns ALLOW immediately for superAdmin regardless of rules", async () => {
        const engine = makeEngine([]); // no rules
        const result = await engine.check(
            makeCtx({ platformRole: "superAdmin" }),
            "project",
            "delete",
        );
        expect(result.decision).toBe("ALLOW");
        expect(result.reason).toContain("superAdmin");
    });
});

// ---------------------------------------------------------------------------
// No rules
// ---------------------------------------------------------------------------

describe("PermissionEngine — no rules", () => {
    it("DENYs when no rules are configured for the platform role", async () => {
        const engine = makeEngine([]);
        const result = await engine.check(makeCtx(), "project", "read");
        expect(result.decision).toBe("DENY");
        expect(result.reason).toContain("No rules");
    });

    it("DENYs when no rules match the resource/action pair", async () => {
        const engine = makeEngine([makeRule({ actions: ["write"] })]);
        const result = await engine.check(makeCtx(), "project", "read");
        expect(result.decision).toBe("DENY");
        expect(result.reason).toContain("No rule found");
    });
});

// ---------------------------------------------------------------------------
// scope: all
// ---------------------------------------------------------------------------

describe("PermissionEngine — scope: all", () => {
    it("ALLOWs read on any project", async () => {
        const engine = makeEngine([makeRule({ scope: { type: "all" } })]);
        const result = await engine.check(makeCtx(), "project", "read", "project-1");
        expect(result.decision).toBe("ALLOW");
    });

    it("ALLOWs even without resourceId when scope is all", async () => {
        const engine = makeEngine([makeRule({ scope: { type: "all" } })]);
        const result = await engine.check(makeCtx(), "project", "read");
        expect(result.decision).toBe("ALLOW");
    });
});

// ---------------------------------------------------------------------------
// scope: ids
// ---------------------------------------------------------------------------

describe("PermissionEngine — scope: ids", () => {
    const rule = makeRule({
        scope: { type: "ids", values: ["550e8400-e29b-41d4-a716-446655440000"] },
    });

    it("ALLOWs when resourceId is in the allowed list", async () => {
        const engine = makeEngine([rule]);
        const result = await engine.check(
            makeCtx(),
            "project",
            "read",
            "550e8400-e29b-41d4-a716-446655440000",
        );
        expect(result.decision).toBe("ALLOW");
    });

    it("DENYs when resourceId is NOT in the list", async () => {
        const engine = makeEngine([rule]);
        const result = await engine.check(makeCtx(), "project", "read", "other-id");
        expect(result.decision).toBe("DENY");
    });

    it("DENYs when no resourceId is provided", async () => {
        const engine = makeEngine([rule]);
        const result = await engine.check(makeCtx(), "project", "read");
        expect(result.decision).toBe("DENY");
    });
});

// ---------------------------------------------------------------------------
// scope: cascade
// ---------------------------------------------------------------------------

describe("PermissionEngine — scope: cascade", () => {
    it("ALLOWs when scope.from is a valid ancestor of the resource", async () => {
        const rule = makeRule({
            resource: "deployment",
            scope: { type: "cascade", from: "project" },
        });
        const engine = makeEngine([rule]);
        const result = await engine.check(
            makeCtx(),
            "deployment",
            "read",
            "deploy-1",
        );
        expect(result.decision).toBe("ALLOW");
    });

    it("DENYs when scope.from is NOT an ancestor of the resource", async () => {
        // "webhook" is not an ancestor of "deployment"
        const rule = makeRule({
            resource: "deployment",
            scope: { type: "cascade", from: "webhook" },
        });
        const engine = makeEngine([rule]);
        const result = await engine.check(
            makeCtx(),
            "deployment",
            "read",
            "deploy-1",
        );
        expect(result.decision).toBe("DENY");
    });

    it("DENYs when no resourceId is provided", async () => {
        const rule = makeRule({
            resource: "service",
            scope: { type: "cascade", from: "project" },
        });
        const engine = makeEngine([rule]);
        const result = await engine.check(makeCtx(), "service", "read");
        expect(result.decision).toBe("DENY");
    });
});

// ---------------------------------------------------------------------------
// scope: filter
// ---------------------------------------------------------------------------

describe("PermissionEngine — scope: filter", () => {
    it("ALLOWs when filter matches the loaded record", async () => {
        const recordLoader: ResourceRecordLoader = vi
            .fn()
            .mockResolvedValue({ status: "active", id: "project-1" });

        const rule = makeRule({
            scope: { type: "filter", condition: { status: { _eq: "active" } } },
        });
        const engine = makeEngine([rule], recordLoader);
        const result = await engine.check(makeCtx(), "project", "read", "project-1");
        expect(result.decision).toBe("ALLOW");
    });

    it("DENYs when filter does not match the loaded record", async () => {
        const recordLoader: ResourceRecordLoader = vi
            .fn()
            .mockResolvedValue({ status: "archived", id: "project-1" });

        const rule = makeRule({
            scope: { type: "filter", condition: { status: { _eq: "active" } } },
        });
        const engine = makeEngine([rule], recordLoader);
        const result = await engine.check(makeCtx(), "project", "read", "project-1");
        expect(result.decision).toBe("DENY");
    });

    it("DENYs (conservatively) when record is not found", async () => {
        const recordLoader: ResourceRecordLoader = vi.fn().mockResolvedValue(undefined);

        const rule = makeRule({
            scope: { type: "filter", condition: { status: { _eq: "active" } } },
        });
        const engine = makeEngine([rule], recordLoader);
        const result = await engine.check(makeCtx(), "project", "read", "missing-id");
        expect(result.decision).toBe("DENY");
    });

    it("uses pre-provided record instead of calling loadResourceRecord", async () => {
        const recordLoader: ResourceRecordLoader = vi.fn();
        const rule = makeRule({
            scope: { type: "filter", condition: { status: { _eq: "active" } } },
        });
        const engine = makeEngine([rule], recordLoader);

        const result = await engine.check(
            makeCtx(),
            "project",
            "read",
            "project-1",
            { status: "active" },
        );
        expect(result.decision).toBe("ALLOW");
        expect(recordLoader).not.toHaveBeenCalled();
    });

    it("throws when filter-scope rule is present but no loadResourceRecord is configured", async () => {
        const rule = makeRule({
            scope: { type: "filter", condition: { status: { _eq: "active" } } },
        });
        const engine = makeEngine([rule]); // no recordLoader
        await expect(
            engine.check(makeCtx(), "project", "read", "project-1"),
        ).rejects.toThrow("loadResourceRecord");
    });

    it("DENYs when no resourceId is provided for filter scope", async () => {
        const rule = makeRule({
            scope: { type: "filter", condition: { status: { _eq: "active" } } },
        });
        const engine = makeEngine([rule]);
        const result = await engine.check(makeCtx(), "project", "read");
        expect(result.decision).toBe("DENY");
    });
});

// ---------------------------------------------------------------------------
// Priority & deny rules
// ---------------------------------------------------------------------------

describe("PermissionEngine — priority-based conflict resolution", () => {
    it("allows when allow priority > deny priority", async () => {
        const rules: ResourceRule[] = [
            makeRule({ deny: false, priority: 10 }),
            makeRule({ deny: true, priority: 5 }),
        ];
        const engine = makeEngine(rules);
        const result = await engine.check(makeCtx(), "project", "read", "p-1");
        expect(result.decision).toBe("ALLOW");
    });

    it("denies when deny priority > allow priority", async () => {
        const rules: ResourceRule[] = [
            makeRule({ deny: false, priority: 5 }),
            makeRule({ deny: true, priority: 10 }),
        ];
        const engine = makeEngine(rules);
        const result = await engine.check(makeCtx(), "project", "read", "p-1");
        expect(result.decision).toBe("DENY");
    });

    it("deny wins on equal priority (tie-break)", async () => {
        const rules: ResourceRule[] = [
            makeRule({ deny: false, priority: 5 }),
            makeRule({ deny: true, priority: 5 }),
        ];
        const engine = makeEngine(rules);
        const result = await engine.check(makeCtx(), "project", "read", "p-1");
        expect(result.decision).toBe("DENY");
    });

    it("allows when no deny rules exist", async () => {
        const rules: ResourceRule[] = [makeRule({ priority: 0 })];
        const engine = makeEngine(rules);
        const result = await engine.check(makeCtx(), "project", "read", "p-1");
        expect(result.decision).toBe("ALLOW");
    });

    it("reports the matched allow rule", async () => {
        const engine = makeEngine([makeRule()]);
        const result = await engine.check(makeCtx(), "project", "read", "p-1");
        expect(result.matchedRule).toBeDefined();
        expect(result.matchedRule?.resource).toBe("project");
    });
});

// ---------------------------------------------------------------------------
// Wildcard resource / action
// ---------------------------------------------------------------------------

describe("PermissionEngine — wildcard matching", () => {
    it("wildcard resource '*' matches any resource", async () => {
        const rule = makeRule({ resource: "*", actions: ["read"] });
        const engine = makeEngine([rule]);
        const result = await engine.check(makeCtx(), "service", "read", "s-1");
        expect(result.decision).toBe("ALLOW");
    });

    it("wildcard actions '*' matches any action", async () => {
        const rule = makeRule({ actions: "*" });
        const engine = makeEngine([rule]);
        const result = await engine.check(makeCtx(), "project", "delete", "p-1");
        expect(result.decision).toBe("ALLOW");
    });
});

// ---------------------------------------------------------------------------
// assert()
// ---------------------------------------------------------------------------

describe("PermissionEngine.assert()", () => {
    it("resolves without error when decision is ALLOW", async () => {
        const engine = makeEngine([makeRule()]);
        await expect(
            engine.assert(makeCtx(), "project", "read", "p-1"),
        ).resolves.toBeUndefined();
    });

    it("throws ForbiddenError when decision is DENY", async () => {
        const engine = makeEngine([]); // no rules
        await expect(
            engine.assert(makeCtx(), "project", "read", "p-1"),
        ).rejects.toThrow(ForbiddenError);
    });

    it("ForbiddenError contains resource and action in message", async () => {
        const engine = makeEngine([]);
        try {
            await engine.assert(makeCtx(), "service", "deploy", "s-1");
        } catch (err) {
            expect(err).toBeInstanceOf(ForbiddenError);
            expect((err as ForbiddenError).message).toContain("service");
            expect((err as ForbiddenError).message).toContain("deploy");
            expect((err as ForbiddenError).code).toBe("PERMISSION_DENIED");
        }
    });
});
