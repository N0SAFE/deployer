import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "./connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "./connection/mesh-consumer-registry";
import { eq, and, or, inSet, always } from "./filter/mesh-filter";
import { reconstructFilter } from "./filter/mesh-filter-evaluator";
import { isFilterSubset, unionFilters } from "./filter/mesh-filter-subset";
import type { MeshFilterDescriptor } from "./filter/mesh-filter.types";
import { compileParamsToFilterDescriptor } from "./params/mesh-params-compiler";
import { Subject } from "rxjs";

describe("Mesh Static Imports", () => {
  it("all imports resolve", () => {
    expect(MeshConnectionRegistry).toBeDefined();
    expect(ServerConnectionConsumerRegistry).toBeDefined();
    expect(eq).toBeDefined();
    expect(and).toBeDefined();
    expect(or).toBeDefined();
    expect(inSet).toBeDefined();
    expect(always).toBeDefined();
    expect(reconstructFilter).toBeDefined();
    expect(isFilterSubset).toBeDefined();
    expect(unionFilters).toBeDefined();
    expect(compileParamsToFilterDescriptor).toBeDefined();
    expect(Subject).toBeDefined();
  });
});
