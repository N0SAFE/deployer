import { describe, it, expect } from "vitest";
import { eq } from "./filter/mesh-filter";
import { reconstructFilter } from "./filter/mesh-filter-evaluator";

describe("Mesh Minimal", () => {
  it("works", () => {
    const filter = eq("env", "prod" as const);
    expect(filter.evaluate({ env: "prod" } as any)).toBe(true);

    const serverEval = reconstructFilter(filter.descriptor);
    expect(serverEval({ env: "prod" })).toBe(true);
  });
});
