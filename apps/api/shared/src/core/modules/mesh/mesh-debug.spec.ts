import { describe, it, expect } from "vitest";

describe("Mesh Debug", () => {
  it("imports mesh-filter", async () => {
    const { eq } = await import("./filter/mesh-filter");
    expect(eq).toBeDefined();
  });

  it("imports mesh-filter-evaluator", async () => {
    const { reconstructFilter } = await import("./filter/mesh-filter-evaluator");
    expect(reconstructFilter).toBeDefined();
  });

  it("imports mesh-filter-subset", async () => {
    const { isFilterSubset } = await import("./filter/mesh-filter-subset");
    expect(isFilterSubset).toBeDefined();
  });

  it("imports mesh-filter.types", async () => {
    const { generateConnectionId } = await import("./filter/mesh-filter.types");
    expect(generateConnectionId).toBeDefined();
  });

  it("imports mesh-params-compiler", async () => {
    const { compileParamsToFilterDescriptor } = await import("./params/mesh-params-compiler");
    expect(compileParamsToFilterDescriptor).toBeDefined();
  });

  it("imports mesh-consumer-registry", async () => {
    const { ServerConnectionConsumerRegistry } = await import("./connection/mesh-consumer-registry");
    expect(ServerConnectionConsumerRegistry).toBeDefined();
  });

  it("imports mesh-connection-registry", async () => {
    const { MeshConnectionRegistry } = await import("./connection/mesh-connection-registry");
    expect(MeshConnectionRegistry).toBeDefined();
  });
});
