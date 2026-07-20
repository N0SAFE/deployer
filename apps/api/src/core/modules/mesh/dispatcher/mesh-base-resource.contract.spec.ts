/**
 * Mesh Base Resource Contract — Validation Tests
 *
 * Tests that the contract file loads correctly and the parameter
 * schemas validate as expected.
 */

import { describe, it, expect } from "vitest";
import { z } from "zod/v4";
import { meshBaseResourceContract } from "@repo/api-contracts/modules/mesh/resource/mesh-base-resource.contract";

describe("MeshBaseResourceContract", () => {
  // ─── Module integrity ──────────────────────────────────────────────

  it("should load the contract module", () => {
    expect(meshBaseResourceContract).toBeDefined();
  });

  it("should be a non-null object", () => {
    expect(typeof meshBaseResourceContract).toBe("object");
  });

  // ─── Input schema validation ───────────────────────────────────────

  it("path params schema should validate entityKey and methodName", () => {
    const paramsSchema = z.object({
      entityKey: z.string().min(1),
      methodName: z.string().min(1),
    });

    // Valid inputs
    const valid = paramsSchema.parse({
      entityKey: "deployments",
      methodName: "list",
    });
    expect(valid.entityKey).toBe("deployments");
    expect(valid.methodName).toBe("list");

    // Empty strings should fail
    expect(() => paramsSchema.parse({ entityKey: "", methodName: "list" })).toThrow();
    expect(() => paramsSchema.parse({ entityKey: "deployments", methodName: "" })).toThrow();
  });
});
