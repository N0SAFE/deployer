import { describe, it, expect } from "vitest";
import { sql as rawSql, type SQL } from "drizzle-orm";
import { compileDFilter, type ColumnResolver } from "./filter-compiler";
import { MAX_FILTER_DEPTH } from "./filter-matcher";
import type { DFilter } from "./types";
import { Variable } from "./types";

// ---------------------------------------------------------------------------
// Test schema
// ---------------------------------------------------------------------------

/** Schema used for most resolver tests. */
interface ProjectSchema {
    status: string;
    name: string;
    budget: number;
    deletedAt: string | null;
    ownerId: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Simple resolver — maps field names to raw SQL expressions. */
const resolver: ColumnResolver<ProjectSchema> = (field): SQL | undefined => {
    const map: Record<keyof ProjectSchema, SQL> = {
        status:    rawSql`"projects"."status"`,
        name:      rawSql`"projects"."name"`,
        budget:    rawSql`"projects"."budget"`,
        deletedAt: rawSql`"projects"."deleted_at"`,
        ownerId:   rawSql`"projects"."owner_id"`,
    };
    return map[field];
};

/** Returns true when the SQL object is a real Drizzle SQL instance. */
function isSQL(value: unknown): value is SQL {
    return (
        value !== null &&
        value !== undefined &&
        typeof value === "object" &&
        typeof (value as Record<string, unknown>).getSQL === "function"
    );
}

// ---------------------------------------------------------------------------
// Basic return behavior
// ---------------------------------------------------------------------------

describe("compileDFilter — return behavior", () => {
    it("returns undefined for empty filter (no keys)", () => {
        expect(compileDFilter({}, resolver)).toBeUndefined();
    });

    it("returns SQL for a valid single field filter", () => {
        const result = compileDFilter({ status: { _eq: "active" } }, resolver);
        expect(isSQL(result)).toBe(true);
    });

    it("returns undefined when all fields are unresolvable", () => {
        // Use a loose resolver to test runtime unknown-field behaviour
        const looseResolver: ColumnResolver = () => undefined;
        const result = compileDFilter({ unknownField: { _eq: "value" } }, looseResolver);
        expect(result).toBeUndefined();
    });

    it("skips unresolvable fields and returns SQL for resolvable ones", () => {
        // Use a loose resolver that knows about 'status' but not 'unknownField'
        const mixedResolver: ColumnResolver = (field) => {
            if (field === "status") return rawSql`"projects"."status"`;
            return undefined;
        };
        const result = compileDFilter(
            { status: { _eq: "active" }, unknownField: { _eq: "x" } },
            mixedResolver,
        );
        expect(isSQL(result)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Equality operators
// ---------------------------------------------------------------------------

describe("compileDFilter — _eq / _neq", () => {
    it("_eq produces SQL", () => {
        expect(isSQL(compileDFilter({ status: { _eq: "active" } }, resolver))).toBe(true);
    });

    it("_neq produces SQL", () => {
        expect(isSQL(compileDFilter({ status: { _neq: "archived" } }, resolver))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Inclusion operators
// ---------------------------------------------------------------------------

describe("compileDFilter — _in / _nin", () => {
    it("_in produces SQL for non-empty list", () => {
        expect(
            isSQL(compileDFilter({ status: { _in: ["active", "inactive"] } }, resolver)),
        ).toBe(true);
    });

    it("_in with empty array produces SQL (always-false predicate, not undefined)", () => {
        // We still return a SQL fragment (1 = 0) so the caller gets a consistent WHERE clause.
        expect(
            isSQL(compileDFilter({ status: { _in: [] } }, resolver)),
        ).toBe(true);
    });

    it("_nin produces SQL for non-empty list", () => {
        expect(
            isSQL(compileDFilter({ status: { _nin: ["deleted"] } }, resolver)),
        ).toBe(true);
    });

    it("_nin with empty array returns undefined (no constraint)", () => {
        // Empty NOT IN adds no restriction — the whole filter becomes no-op.
        expect(compileDFilter({ status: { _nin: [] } }, resolver)).toBeUndefined();
    });
});

// ---------------------------------------------------------------------------
// Null checks
// ---------------------------------------------------------------------------

describe("compileDFilter — _null / _nnull", () => {
    it("_null: true produces SQL", () => {
        expect(isSQL(compileDFilter({ deletedAt: { _null: true } }, resolver))).toBe(true);
    });

    it("_null: false produces SQL", () => {
        expect(isSQL(compileDFilter({ deletedAt: { _null: false } }, resolver))).toBe(true);
    });

    it("_nnull: true produces SQL", () => {
        expect(isSQL(compileDFilter({ deletedAt: { _nnull: true } }, resolver))).toBe(true);
    });

    it("_nnull: false produces SQL", () => {
        expect(isSQL(compileDFilter({ deletedAt: { _nnull: false } }, resolver))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// String operators
// ---------------------------------------------------------------------------

describe("compileDFilter — string operators", () => {
    it("_contains produces SQL", () => {
        expect(isSQL(compileDFilter({ name: { _contains: "foo" } }, resolver))).toBe(true);
    });

    it("_icontains produces SQL", () => {
        expect(isSQL(compileDFilter({ name: { _icontains: "FOO" } }, resolver))).toBe(true);
    });

    it("_starts_with produces SQL", () => {
        expect(isSQL(compileDFilter({ name: { _starts_with: "pre" } }, resolver))).toBe(true);
    });

    it("_ends_with produces SQL", () => {
        expect(isSQL(compileDFilter({ name: { _ends_with: "suf" } }, resolver))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Numeric comparisons
// ---------------------------------------------------------------------------

describe("compileDFilter — numeric comparisons", () => {
    it("_gt produces SQL", () => {
        expect(isSQL(compileDFilter({ budget: { _gt: 50 } }, resolver))).toBe(true);
    });

    it("_gte produces SQL", () => {
        expect(isSQL(compileDFilter({ budget: { _gte: 50 } }, resolver))).toBe(true);
    });

    it("_lt produces SQL", () => {
        expect(isSQL(compileDFilter({ budget: { _lt: 200 } }, resolver))).toBe(true);
    });

    it("_lte produces SQL", () => {
        expect(isSQL(compileDFilter({ budget: { _lte: 200 } }, resolver))).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Dynamic variable bindings (Variable class)
// ---------------------------------------------------------------------------

describe("compileDFilter — Variable instances", () => {
    it("_eq with Variable resolves to SQL when var is in context", () => {
        const result = compileDFilter(
            { ownerId: { _eq: new Variable("userId") } },
            resolver,
            { userId: "user-42" },
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_eq with Variable throws when variable is not in context", () => {
        expect(() =>
            compileDFilter(
                { ownerId: { _eq: new Variable("userId") } },
                resolver,
                {}, // provide TVars context; empty → throws at runtime
            ),
        ).toThrow(/userId/);
    });

    it("_in with Variable resolves to SQL when var is a non-empty array", () => {
        const result = compileDFilter(
            { ownerId: { _in: new Variable("teamIds") } },
            resolver,
            { teamIds: ["team-1", "team-2"], t: 1 },
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_in with Variable returns SQL (1 = 0) when var resolves to empty array", () => {
        const result = compileDFilter(
            { ownerId: { _in: new Variable("teamIds") } },
            resolver,
            { teamIds: [] },
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_in with Variable throws when variable is not in context", () => {
        expect(() =>
            compileDFilter({ ownerId: { _in: new Variable("teamIds") } }, resolver, {}),
        ).toThrow(/teamIds/);
    });

    it("_in with Variable throws when resolved value is not an array", () => {
        expect(() =>
            compileDFilter<ProjectSchema, { teamIds: string[] }>(
                { ownerId: { _in: new Variable("teamIds") } },
                resolver,
                { teamIds: "user-42" as unknown as string[] },
            ),
        ).toThrow(/array/i);
    });
});

// ---------------------------------------------------------------------------
// Logical grouping: _and / _or
// ---------------------------------------------------------------------------

describe("compileDFilter — _and / _or", () => {
    it("_and with multiple conditions produces SQL", () => {
        const result = compileDFilter(
            { _and: [{ status: { _eq: "active" } }, { budget: { _gt: 0 } }] },
            resolver,
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_and with a single condition produces SQL", () => {
        const result = compileDFilter(
            { _and: [{ status: { _eq: "active" } }] },
            resolver,
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_and with all unresolvable fields returns undefined", () => {
        // Use a loose resolver to test that _and with only unknown fields returns undefined
        const looseResolver: ColumnResolver = () => undefined;
        const result = compileDFilter(
            { _and: [{ unknownA: { _eq: 1 } }, { unknownB: { _eq: 2 } }] },
            looseResolver,
        );
        expect(result).toBeUndefined();
    });

    it("_and with empty array returns undefined (no condition pushed)", () => {
        const result = compileDFilter({ _and: [] }, resolver);
        expect(result).toBeUndefined();
    });

    it("_or with multiple conditions produces SQL", () => {
        const result = compileDFilter(
            { _or: [{ status: { _eq: "active" } }, { status: { _eq: "inactive" } }] },
            resolver,
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_or with a single condition produces SQL", () => {
        const result = compileDFilter(
            { _or: [{ status: { _eq: "active" } }] },
            resolver,
        );
        expect(isSQL(result)).toBe(true);
    });

    it("_or with empty array returns undefined", () => {
        const result = compileDFilter({ _or: [] }, resolver);
        expect(result).toBeUndefined();
    });

    it("_and with non-array value throws", () => {
        expect(() =>
            compileDFilter(
                { _and: "not-an-array" } as unknown as DFilter,
                resolver,
            ),
        ).toThrow();
    });

    it("_or with non-array value throws", () => {
        expect(() =>
            compileDFilter(
                { _or: "not-an-array" } as unknown as DFilter,
                resolver,
            ),
        ).toThrow();
    });
});

// ---------------------------------------------------------------------------
// Nested logical grouping
// ---------------------------------------------------------------------------

describe("compileDFilter — nested _and / _or", () => {
    it("handles two levels of nesting", () => {
        const filter: DFilter = {
            _and: [
                { status: { _eq: "active" } },
                { _or: [{ budget: { _gt: 0 } }, { budget: { _null: true } }] },
            ],
        };
        expect(isSQL(compileDFilter(filter, resolver))).toBe(true);
    });

    it("multiple top-level conditions are AND-combined", () => {
        const result = compileDFilter(
            { status: { _eq: "active" }, budget: { _gt: 0 } },
            resolver,
        );
        expect(isSQL(result)).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// Depth limit
// ---------------------------------------------------------------------------

describe("compileDFilter — depth limit", () => {
    it("throws when filter nesting exceeds MAX_FILTER_DEPTH", () => {
        let deep: DFilter = { status: { _eq: "active" } };
        for (let i = 0; i <= MAX_FILTER_DEPTH; i++) {
            deep = { _and: [deep] };
        }
        expect(() => compileDFilter(deep, resolver)).toThrow(/MAX_FILTER_DEPTH/);
    });

    it("does not throw at exactly MAX_FILTER_DEPTH levels", () => {
        let deep: DFilter = { status: { _eq: "active" } };
        for (let i = 0; i < MAX_FILTER_DEPTH; i++) {
            deep = { _and: [deep] };
        }
        expect(() => compileDFilter(deep, resolver)).not.toThrow();
    });
});

// ---------------------------------------------------------------------------
// Unknown operator
// ---------------------------------------------------------------------------

describe("compileDFilter — unknown operator", () => {
    it("throws on an unrecognised operator key", () => {
        expect(() =>
            compileDFilter(
                { status: { _unknown_op: "value" } } as unknown as DFilter,
                resolver,
            ),
        ).toThrow(/unknown operator/i);
    });
});
