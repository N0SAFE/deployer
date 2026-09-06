import { describe, it, expect } from "vitest";
import {
  createFilter,
  eq,
  gt,
  inList,
  and,
  or,
  applyObjectWhere,
  type TypedMeshWhereExpression,
} from "@/core/modules/mesh/services/system-mesh-resource-discovery/query/mesh-where";
import { compileParamsToFilterDescriptor } from "@/core/modules/mesh/params/mesh-params-compiler";
import { reconstructFilter } from "@/core/modules/mesh/filter/mesh-filter-evaluator";
import type { MeshFilterDescriptor } from "@/core/modules/mesh/filter/mesh-filter.types";

type UserSchema = {
  projectId: `org-${number}`;
  status: "active" | "inactive";
  ownerId: string;
  age: number;
};

describe("Mesh E2E: Typed Filter + Where System", () => {
  it("supports typed createFilter with leaf operators", () => {
    const userFilter = createFilter<UserSchema>(() => ({
      projectId: eq("org-123"),
      status: eq("active"),
      age: gt(18),
    }));

    expect(userFilter.projectId?._eq).toBe("org-123");
    expect(userFilter.status?._eq).toBe("active");
    expect(userFilter.age?._gt).toBe(18);
  });

  it("supports typed logical _or/_and structures", () => {
    const complex = createFilter<UserSchema>(() =>
      and([
        { status: eq("active") },
        or([
          { projectId: eq("org-123") },
          { ownerId: eq("user-456") },
        ]),
      ]),
    );

    expect(complex._and).toBeDefined();
    expect(complex._and?.length).toBe(2);
  });

  it("evaluates object where with typed expressions + logical groups", () => {
    const clause: TypedMeshWhereExpression<UserSchema> = {
      _and: [
        { status: eq("active") },
        {
          _or: [
            { projectId: eq("org-123") },
            { ownerId: eq("user-456") },
          ],
        },
      ],
      age: gt(18),
    };

    const pass = applyObjectWhere(
      {
        projectId: "org-123",
        status: "active",
        ownerId: "user-999",
        age: 31,
      },
      clause,
    );

    const fail = applyObjectWhere(
      {
        projectId: "org-789",
        status: "active",
        ownerId: "user-999",
        age: 16,
      },
      clause,
    );

    expect(pass).toBe(true);
    expect(fail).toBe(false);
  });

  it("compiles request params to server filter descriptor and reconstructs evaluator", () => {
    const params = {
      environment: "prod",
      statuses: ["running", "pending"],
      limit: 20,
      offset: 0,
    } as const;

    const descriptor = compileParamsToFilterDescriptor(params);
    expect(descriptor).toEqual({
      op: "and",
      operands: [
        { op: "eq", field: "environment", value: "prod" },
        { op: "in", field: "statuses", values: ["running", "pending"] },
      ],
    });

    const evaluator = reconstructFilter(descriptor);
    expect(evaluator({ environment: "prod", statuses: "running" } as any)).toBe(true);
  });

  it("supports $filter escape hatch merging", () => {
    const descriptor = compileParamsToFilterDescriptor({
      environment: "prod",
      $filter: {
        op: "gt",
        field: "replicaCount",
        value: 2,
      } satisfies MeshFilterDescriptor,
    });

    expect(descriptor).toEqual({
      op: "and",
      operands: [
        { op: "eq", field: "environment", value: "prod" },
        { op: "gt", field: "replicaCount", value: 2 },
      ],
    });
  });
});
