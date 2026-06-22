import { describe, it, expect } from "vitest";
import { matchFilter, MAX_FILTER_DEPTH } from "./filter-matcher";
import type { DFilter } from "./types";
import { Variable } from "./types";

const record = {
    id: "project-1",
    name: "My Project",
    status: "active",
    budget: 100,
    ownerId: "user-1",
    "project.name": "Parent Project",
};

describe("matchFilter", () => {
    describe("_eq", () => {
        it("matches when field equals value", () => {
            expect(matchFilter(record, { status: { _eq: "active" } })).toBe(true);
        });

        it("fails when field does not equal value", () => {
            expect(matchFilter(record, { status: { _eq: "inactive" } })).toBe(false);
        });

        it("matches boolean field", () => {
            expect(matchFilter({ active: true }, { active: { _eq: true } })).toBe(true);
        });
    });

    describe("_neq", () => {
        it("matches when field is not equal to value", () => {
            expect(matchFilter(record, { status: { _neq: "archived" } })).toBe(true);
        });

        it("fails when field equals value", () => {
            expect(matchFilter(record, { status: { _neq: "active" } })).toBe(false);
        });
    });

    describe("_in / _nin", () => {
        it("_in matches when field is in list", () => {
            expect(matchFilter(record, { status: { _in: ["active", "inactive"] } })).toBe(true);
        });

        it("_in fails when field is not in list", () => {
            expect(matchFilter(record, { status: { _in: ["archived", "deleted"] } })).toBe(false);
        });

        it("_nin matches when field is not in list", () => {
            expect(matchFilter(record, { status: { _nin: ["archived", "deleted"] } })).toBe(true);
        });

        it("_nin fails when field is in list", () => {
            expect(matchFilter(record, { status: { _nin: ["active"] } })).toBe(false);
        });
    });

    describe("_null / _nnull", () => {
        it("_null true matches null field", () => {
            expect(matchFilter({ x: null }, { x: { _null: true } })).toBe(true);
        });

        it("_null true matches undefined field", () => {
            expect(matchFilter({}, { x: { _null: true } })).toBe(true);
        });

        it("_null true fails for non-null field", () => {
            expect(matchFilter({ x: "hello" }, { x: { _null: true } })).toBe(false);
        });

        it("_null false fails for null field", () => {
            expect(matchFilter({ x: null }, { x: { _null: false } })).toBe(false);
        });

        it("_nnull true matches non-null field", () => {
            expect(matchFilter({ x: "hello" }, { x: { _nnull: true } })).toBe(true);
        });

        it("_nnull true fails for null field", () => {
            expect(matchFilter({ x: null }, { x: { _nnull: true } })).toBe(false);
        });
    });

    describe("string operators", () => {
        it("_contains", () => {
            expect(matchFilter({ name: "hello world" }, { name: { _contains: "world" } })).toBe(
                true,
            );
            expect(matchFilter({ name: "hello world" }, { name: { _contains: "xyz" } })).toBe(
                false,
            );
        });

        it("_icontains is case-insensitive", () => {
            expect(
                matchFilter({ name: "Hello World" }, { name: { _icontains: "hello" } }),
            ).toBe(true);
        });

        it("_starts_with", () => {
            expect(matchFilter({ name: "abc123" }, { name: { _starts_with: "abc" } })).toBe(true);
            expect(matchFilter({ name: "abc123" }, { name: { _starts_with: "123" } })).toBe(false);
        });

        it("_ends_with", () => {
            expect(matchFilter({ name: "abc123" }, { name: { _ends_with: "123" } })).toBe(true);
            expect(matchFilter({ name: "abc123" }, { name: { _ends_with: "abc" } })).toBe(false);
        });

        it("returns false when field is not a string", () => {
            expect(matchFilter({ count: 5 }, { count: { _contains: "5" } })).toBe(false);
        });
    });

    describe("numeric comparisons", () => {
        it("_gt", () => {
            expect(matchFilter({ budget: 100 }, { budget: { _gt: 50 } })).toBe(true);
            expect(matchFilter({ budget: 100 }, { budget: { _gt: 100 } })).toBe(false);
        });

        it("_gte", () => {
            expect(matchFilter({ budget: 100 }, { budget: { _gte: 100 } })).toBe(true);
            expect(matchFilter({ budget: 100 }, { budget: { _gte: 101 } })).toBe(false);
        });

        it("_lt", () => {
            expect(matchFilter({ budget: 100 }, { budget: { _lt: 200 } })).toBe(true);
            expect(matchFilter({ budget: 100 }, { budget: { _lt: 100 } })).toBe(false);
        });

        it("_lte", () => {
            expect(matchFilter({ budget: 100 }, { budget: { _lte: 100 } })).toBe(true);
            expect(matchFilter({ budget: 100 }, { budget: { _lte: 99 } })).toBe(false);
        });

        it("returns false when field is not a number", () => {
            expect(matchFilter({ name: "foo" }, { name: { _gt: 0 } })).toBe(false);
        });
    });

    describe("dynamic variables", () => {
        it("_eq with Variable($currentUser) matches userId", () => {
            expect(
                matchFilter(
                    { ownerId: "user-42" },
                    { ownerId: { _eq: new Variable("$currentUser") } },
                    { $currentUser: "user-42" },
                ),
            ).toBe(true);
        });

        it("_eq with Variable throws when variable not in vars", () => {
            expect(() =>
                matchFilter(
                    { ownerId: "user-42" },
                    { ownerId: { _eq: new Variable("$currentUser") } },
                    {}, // provide TVars context; empty → throws at runtime
                ),
            ).toThrow("$currentUser");
        });

        it("_in with Variable($accessibleProjects) matches", () => {
            expect(
                matchFilter(
                    { id: "project-1" },
                    { id: { _in: new Variable("$accessibleProjects") } },
                    { $accessibleProjects: ["project-1", "project-2"] },
                ),
            ).toBe(true);
        });

        it("_in with Variable fails when value not in list", () => {
            expect(
                matchFilter(
                    { id: "project-3" },
                    { id: { _in: new Variable("$accessibleProjects") } },
                    { $accessibleProjects: ["project-1", "project-2"] },
                ),
            ).toBe(false);
        });
    });

    describe("logical groups", () => {
        it("_and returns true when all conditions match", () => {
            const filter: DFilter = {
                _and: [{ status: { _eq: "active" } }, { budget: { _gt: 50 } }],
            };
            expect(matchFilter(record, filter)).toBe(true);
        });

        it("_and returns false when any condition fails", () => {
            const filter: DFilter = {
                _and: [{ status: { _eq: "active" } }, { budget: { _gt: 200 } }],
            };
            expect(matchFilter(record, filter)).toBe(false);
        });

        it("_or returns true when any condition matches", () => {
            const filter: DFilter = {
                _or: [{ status: { _eq: "inactive" } }, { budget: { _gt: 50 } }],
            };
            expect(matchFilter(record, filter)).toBe(true);
        });

        it("_or returns false when no condition matches", () => {
            const filter: DFilter = {
                _or: [{ status: { _eq: "inactive" } }, { budget: { _gt: 500 } }],
            };
            expect(matchFilter(record, filter)).toBe(false);
        });
    });

    describe("dot-notation field resolution", () => {
        it("resolves pre-flattened dot-notation key", () => {
            expect(
                matchFilter(record, { "project.name": { _eq: "Parent Project" } }),
            ).toBe(true);
        });

        it("falls back to nested object traversal", () => {
            const nested = { project: { name: "Nested Project" } };
            expect(
                matchFilter(nested, { "project.name": { _eq: "Nested Project" } }),
            ).toBe(true);
        });

        it("returns undefined (fails operator) for missing path", () => {
            expect(
                matchFilter(record, { "missing.path": { _eq: "foo" } }),
            ).toBe(false);
        });
    });

    describe("max depth enforcement", () => {
        it("throws when filter recursion exceeds MAX_FILTER_DEPTH", () => {
            // Build a filter nested > MAX_FILTER_DEPTH levels deep
            let deep: DFilter = { status: { _eq: "active" } };
            for (let i = 0; i <= MAX_FILTER_DEPTH; i++) {
                deep = { _and: [deep] };
            }
            expect(() => matchFilter(record, deep)).toThrow("MAX_FILTER_DEPTH");
        });
    });

    describe("unknown operator", () => {
        it("throws on unrecognised operator key", () => {
             
            expect(() => matchFilter(record, { status: { _unknown: "x" } as any })).toThrow(
                "unknown operator",
            );
        });
    });
});
