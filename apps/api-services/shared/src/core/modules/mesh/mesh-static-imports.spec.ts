import { describe, it, expect } from "vitest";
import { MeshConnectionRegistry } from "@/core/modules/mesh/connection/mesh-connection-registry";
import { ServerConnectionConsumerRegistry } from "@/core/modules/mesh/connection/mesh-consumer-registry";
import { eq, and, or, inSet, always } from "@/core/modules/mesh/filter/mesh-filter";
import { reconstructFilter } from "@/core/modules/mesh/filter/mesh-filter-evaluator";
import { isFilterSubset, unionFilters } from "@/core/modules/mesh/filter/mesh-filter-subset";
import type { MeshFilterDescriptor } from "@/core/modules/mesh/filter/mesh-filter.types";
import { compileParamsToFilterDescriptor } from "@/core/modules/mesh/params/mesh-params-compiler";
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
