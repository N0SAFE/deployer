import { describe, it, expect } from "vitest";
import {
    parseResourceRules,
    safeParseResourceRules,
    resourceRuleSchema,
} from "./rule-validator";
import { MAX_FILTER_DEPTH } from "./filter-matcher";
import type { DFilter, ResourceRule } from "./types";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<ResourceRule> = {}): unknown {
    return {
        resource: "project",
        actions: ["read"],
        scope: { type: "all" },
        ...overrides,
    };
}

// ---------------------------------------------------------------------------
// Valid rule shapes
// ---------------------------------------------------------------------------

describe("resourceRuleSchema — valid cases", () => {
    it("accepts minimal valid rule (scope: all)", () => {
        const result = resourceRuleSchema.safeParse(makeRule());
        expect(result.success).toBe(true);
    });

    it("accepts wildcard resource", () => {
        const result = resourceRuleSchema.safeParse(makeRule({ resource: "*" }));
        expect(result.success).toBe(true);
    });

    it("accepts wildcard actions", () => {
        const result = resourceRuleSchema.safeParse(makeRule({ actions: "*" }));
        expect(result.success).toBe(true);
    });

    it("accepts deny rule with priority", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({ deny: true, priority: 10 }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts scope: ids with UUID values", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({
                scope: {
                    type: "ids",
                    values: ["550e8400-e29b-41d4-a716-446655440000"],
                },
            }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts scope: cascade", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({ scope: { type: "cascade", from: "project" } }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts scope: filter with simple condition", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({
                scope: { type: "filter", condition: { status: { _eq: "active" } } },
            }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts scope: filter with _and / _or", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({
                scope: {
                    type: "filter",
                    condition: {
                        _and: [{ status: { _eq: "active" } }, { budget: { _gt: 0 } }],
                    },
                },
            }),
        );
        expect(result.success).toBe(true);
    });

    it("accepts all known ProjectResource values", () => {
        const resources = [
            "project",
            "service",
            "deployment",
            "logs",
            "webhook",
            "apiKey",
            "environment",
        ];
        for (const r of resources) {
            const result = resourceRuleSchema.safeParse(makeRule({ resource: r as ResourceRule["resource"] }));
            expect(result.success, `resource="${r}" failed`).toBe(true);
        }
    });
});

// ---------------------------------------------------------------------------
// Invalid rule shapes
// ---------------------------------------------------------------------------

describe("resourceRuleSchema — invalid cases", () => {
    it("rejects unknown resource", () => {
        const result = resourceRuleSchema.safeParse(makeRule({ resource: "unknown" as ResourceRule["resource"] }));
        expect(result.success).toBe(false);
    });

    it("rejects empty actions array", () => {
        const result = resourceRuleSchema.safeParse(makeRule({ actions: [] as unknown as ResourceRule["actions"] }));
        expect(result.success).toBe(false);
    });

    it("rejects negative priority", () => {
        const result = resourceRuleSchema.safeParse(makeRule({ priority: -1 }));
        expect(result.success).toBe(false);
    });

    it("rejects scope: ids with non-UUID values", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({ scope: { type: "ids", values: ["not-a-uuid"] } }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects scope: ids with empty values array", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({ scope: { type: "ids", values: [] } }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects scope with unknown type", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({ scope: { type: "unknown" } as unknown as ResourceRule["scope"] }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects DFilterOperator with multiple operator keys", () => {
        const result = resourceRuleSchema.safeParse(
            makeRule({
                scope: {
                    type: "filter",
                    condition: { status: { _eq: "active", _neq: "inactive" } },
                },
            }),
        );
        expect(result.success).toBe(false);
    });

    it("rejects DFilter nested beyond MAX_FILTER_DEPTH", () => {
        let deep: Record<string, unknown> = { status: { _eq: "active" } };
        for (let i = 0; i <= MAX_FILTER_DEPTH; i++) {
            deep = { _and: [deep] };
        }
        const result = resourceRuleSchema.safeParse(
            makeRule({ scope: { type: "filter", condition: deep as DFilter } }),
        );
        expect(result.success).toBe(false);
    });
});

// ---------------------------------------------------------------------------
// parseResourceRules / safeParseResourceRules helpers
// ---------------------------------------------------------------------------

describe("parseResourceRules", () => {
    it("parses a valid rules array", () => {
        const rules = parseResourceRules([makeRule()]);
        expect(rules).toHaveLength(1);
        expect(rules[0]!.resource).toBe("project");
    });

    it("throws ZodError on invalid input", () => {
        expect(() => parseResourceRules([makeRule({ resource: "bad" as ResourceRule["resource"] })])).toThrow();
    });
});

describe("safeParseResourceRules", () => {
    it("returns success for valid rules", () => {
        const result = safeParseResourceRules([makeRule()]);
        expect(result.success).toBe(true);
    });

    it("returns failure without throwing for invalid rules", () => {
        const result = safeParseResourceRules("not-an-array");
        expect(result.success).toBe(false);
    });
});
