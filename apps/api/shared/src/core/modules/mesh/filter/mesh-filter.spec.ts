import { describe, it, expect } from "vitest";
import {
  eq,
  neq,
  gt,
  gte,
  lt,
  lte,
  inSet,
  notIn,
  exists,
  missing,
  matches,
  and,
  or,
  not,
  always,
  never,
} from "./mesh-filter";
import { reconstructFilter } from "./mesh-filter-evaluator";
import { isFilterSubset, unionFilters, hasFilterOverlap } from "./mesh-filter-subset";
import type { MeshFilterDescriptor } from "./mesh-filter.types";

describe("MeshFilter", () => {
  describe("primitives", () => {
    it("eq matches exact values", () => {
      const filter = eq("env", "prod" as const);
      expect(filter.evaluate({ env: "prod" } as any)).toBe(true);
      expect(filter.evaluate({ env: "staging" } as any)).toBe(false);
      expect(filter.descriptor).toEqual({ op: "eq", field: "env", value: "prod" });
    });

    it("neq excludes exact values", () => {
      const filter = neq("env", "prod" as const);
      expect(filter.evaluate({ env: "staging" } as any)).toBe(true);
      expect(filter.evaluate({ env: "prod" } as any)).toBe(false);
    });

    it("gt compares numbers", () => {
      const filter = gt("count", 5);
      expect(filter.evaluate({ count: 10 } as any)).toBe(true);
      expect(filter.evaluate({ count: 5 } as any)).toBe(false);
      expect(filter.evaluate({ count: 3 } as any)).toBe(false);
    });

    it("gte compares numbers", () => {
      const filter = gte("count", 5);
      expect(filter.evaluate({ count: 10 } as any)).toBe(true);
      expect(filter.evaluate({ count: 5 } as any)).toBe(true);
      expect(filter.evaluate({ count: 3 } as any)).toBe(false);
    });

    it("lt compares numbers", () => {
      const filter = lt("count", 5);
      expect(filter.evaluate({ count: 3 } as any)).toBe(true);
      expect(filter.evaluate({ count: 5 } as any)).toBe(false);
      expect(filter.evaluate({ count: 10 } as any)).toBe(false);
    });

    it("lte compares numbers", () => {
      const filter = lte("count", 5);
      expect(filter.evaluate({ count: 3 } as any)).toBe(true);
      expect(filter.evaluate({ count: 5 } as any)).toBe(true);
      expect(filter.evaluate({ count: 10 } as any)).toBe(false);
    });

    it("inSet matches array membership", () => {
      const filter = inSet("status", ["running", "pending"] as const);
      expect(filter.evaluate({ status: "running" } as any)).toBe(true);
      expect(filter.evaluate({ status: "pending" } as any)).toBe(true);
      expect(filter.evaluate({ status: "stopped" } as any)).toBe(false);
    });

    it("notIn excludes array membership", () => {
      const filter = notIn("status", ["running", "pending"] as const);
      expect(filter.evaluate({ status: "stopped" } as any)).toBe(true);
      expect(filter.evaluate({ status: "running" } as any)).toBe(false);
    });

    it("exists checks field presence", () => {
      const filter = exists("name");
      expect(filter.evaluate({ name: "test" } as any)).toBe(true);
      expect(filter.evaluate({ name: null } as any)).toBe(false);
      expect(filter.evaluate({} as any)).toBe(false);
    });

    it("missing checks field absence", () => {
      const filter = missing("name");
      expect(filter.evaluate({} as any)).toBe(true);
      expect(filter.evaluate({ name: null } as any)).toBe(true);
      expect(filter.evaluate({ name: "test" } as any)).toBe(false);
    });

    it("matches regex patterns", () => {
      const filter = matches("name", /^test-/);
      expect(filter.evaluate({ name: "test-123" } as any)).toBe(true);
      expect(filter.evaluate({ name: "other" } as any)).toBe(false);
    });
  });

  describe("combinators", () => {
    it("and requires all conditions", () => {
      const filter = and(
        eq("env", "prod" as const),
        eq("status", "running" as const),
      );
      expect(filter.evaluate({ env: "prod", status: "running" } as any)).toBe(true);
      expect(filter.evaluate({ env: "prod", status: "stopped" } as any)).toBe(false);
      expect(filter.evaluate({ env: "staging", status: "running" } as any)).toBe(false);
    });

    it("or requires any condition", () => {
      const filter = or(
        eq("env", "prod" as const),
        eq("env", "staging" as const),
      );
      expect(filter.evaluate({ env: "prod" } as any)).toBe(true);
      expect(filter.evaluate({ env: "staging" } as any)).toBe(true);
      expect(filter.evaluate({ env: "canary" } as any)).toBe(false);
    });

    it("not inverts condition", () => {
      const filter = not(eq("env", "prod" as const));
      expect(filter.evaluate({ env: "staging" } as any)).toBe(true);
      expect(filter.evaluate({ env: "prod" } as any)).toBe(false);
    });

    it("always matches everything", () => {
      expect(always.evaluate({} as any)).toBe(true);
      expect(always.evaluate({ anything: true } as any)).toBe(true);
    });

    it("never matches nothing", () => {
      expect(never.evaluate({} as any)).toBe(false);
      expect(never.evaluate({ anything: true } as any)).toBe(false);
    });
  });

  describe("server-side reconstruction", () => {
    it("reconstructs eq filter identically", () => {
      const clientFilter = eq("env", "prod" as const);
      const serverEval = reconstructFilter(clientFilter.descriptor);
      expect(serverEval({ env: "prod" })).toBe(true);
      expect(serverEval({ env: "staging" })).toBe(false);
    });

    it("reconstructs and filter identically", () => {
      const clientFilter = and(
        eq("env", "prod" as const),
        eq("status", "running" as const),
      );
      const serverEval = reconstructFilter(clientFilter.descriptor);
      expect(serverEval({ env: "prod", status: "running" })).toBe(true);
      expect(serverEval({ env: "prod", status: "stopped" })).toBe(false);
    });

    it("reconstructs or filter identically", () => {
      const clientFilter = or(
        eq("env", "prod" as const),
        eq("env", "staging" as const),
      );
      const serverEval = reconstructFilter(clientFilter.descriptor);
      expect(serverEval({ env: "prod" })).toBe(true);
      expect(serverEval({ env: "canary" })).toBe(false);
    });

    it("reconstructs in filter identically", () => {
      const clientFilter = inSet("status", ["running", "pending"] as const);
      const serverEval = reconstructFilter(clientFilter.descriptor);
      expect(serverEval({ status: "running" })).toBe(true);
      expect(serverEval({ status: "stopped" })).toBe(false);
    });

    it("reconstructs gt/gte/lt/lte filters", () => {
      expect(reconstructFilter(gt("count", 5).descriptor)({ count: 10 })).toBe(true);
      expect(reconstructFilter(gte("count", 5).descriptor)({ count: 5 })).toBe(true);
      expect(reconstructFilter(lt("count", 5).descriptor)({ count: 3 })).toBe(true);
      expect(reconstructFilter(lte("count", 5).descriptor)({ count: 5 })).toBe(true);
    });
  });

  describe("filter subset", () => {
    it("detects eq as subset of in", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };
      expect(isFilterSubset(a, b)).toBe(true);
      expect(isFilterSubset(b, a)).toBe(false);
    });

    it("identical filters are subsets of each other", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      expect(isFilterSubset(a, b)).toBe(true);
      expect(isFilterSubset(b, a)).toBe(true);
    });

    it("never is subset of everything", () => {
      const a: MeshFilterDescriptor = { op: "never" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      expect(isFilterSubset(a, b)).toBe(true);
    });

    it("always is superset of everything", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "always" };
      expect(isFilterSubset(a, b)).toBe(true);
    });
  });

  describe("filter union", () => {
    it("unions two eq filters into or", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };
      const union = unionFilters(a, b);
      expect(union).toEqual({ op: "or", operands: [a, b] });
    });

    it("always absorbs union", () => {
      const a: MeshFilterDescriptor = { op: "always" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      expect(unionFilters(a, b)).toEqual({ op: "always" });
    });

    it("never returns other filter", () => {
      const a: MeshFilterDescriptor = { op: "never" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      expect(unionFilters(a, b)).toEqual(b);
    });
  });

  describe("filter overlap", () => {
    it("detects overlapping eq filters with same value", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      expect(hasFilterOverlap(a, b)).toBe(true);
    });

    it("detects non-overlapping eq filters with different values", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "eq", field: "env", value: "staging" };
      expect(hasFilterOverlap(a, b)).toBe(false);
    });

    it("detects overlap between eq and in", () => {
      const a: MeshFilterDescriptor = { op: "eq", field: "env", value: "prod" };
      const b: MeshFilterDescriptor = { op: "in", field: "env", values: ["prod", "staging"] };
      expect(hasFilterOverlap(a, b)).toBe(true);
    });
  });
});
