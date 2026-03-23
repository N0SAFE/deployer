import { describe, it, expect, beforeEach } from "vitest";
import { ServiceDagService } from "./service-dag.service";
import type { ServiceDependencyInput } from "./service-dag.service";

const mkEdge = (serviceId: string, dependsOnServiceId: string, isRequired = true): ServiceDependencyInput => ({
    serviceId,
    dependsOnServiceId,
    isRequired,
});

describe("ServiceDagService", () => {
    let service: ServiceDagService;

    beforeEach(() => {
        service = new ServiceDagService();
    });

    describe("build()", () => {
        it("returns empty dag for no edges", () => {
            const dag = service.build([]);
            expect(dag.nodes.size).toBe(0);
            expect(dag.layers).toEqual([]);
            expect(dag.hasCycles).toBe(false);
        });

        it("generates correct layers for linear chain A→B→C", () => {
            // A depends on B, B depends on C: deploy order C → B → A
            const dag = service.build([mkEdge("A", "B"), mkEdge("B", "C")]);
            expect(dag.hasCycles).toBe(false);
            expect(dag.layers).toEqual([["C"], ["B"], ["A"]]);
        });

        it("generates correct layers for diamond: A depends on B+C, B+C depend on D", () => {
            const edges = [mkEdge("A", "B"), mkEdge("A", "C"), mkEdge("B", "D"), mkEdge("C", "D")];
            const dag = service.build(edges);
            expect(dag.hasCycles).toBe(false);
            expect(dag.layers[0]).toEqual(["D"]);
            expect(dag.layers[1]?.sort()).toEqual(["B", "C"]);
            expect(dag.layers[2]).toEqual(["A"]);
        });

        it("detects a direct cycle A→B→A", () => {
            const dag = service.build([mkEdge("A", "B"), mkEdge("B", "A")]);
            expect(dag.hasCycles).toBe(true);
            expect(dag.cycleMembers.sort()).toEqual(["A", "B"]);
        });

        it("detects a 3-node cycle A→B→C→A", () => {
            const dag = service.build([mkEdge("A", "B"), mkEdge("B", "C"), mkEdge("C", "A")]);
            expect(dag.hasCycles).toBe(true);
            expect(dag.cycleMembers).toHaveLength(3);
        });

        it("handles multiple independent services (no edges between them)", () => {
            // Two isolated services: both land in layer 0
            const dag = service.build([mkEdge("A", "X"), mkEdge("B", "Y")]);
            expect(dag.hasCycles).toBe(false);
            expect(dag.layers[0]?.sort()).toEqual(["X", "Y"]);
            expect(dag.layers[1]?.sort()).toEqual(["A", "B"]);
        });

        it("preserves isRequired on edges", () => {
            const dag = service.build([mkEdge("A", "B", false)]);
            expect(dag.edges[0]?.isRequired).toBe(false);
        });
    });

    describe("getTransitiveDependents()", () => {
        it("returns all downstream services", () => {
            // C→B→A: A depends on B, B depends on C
            const dag = service.build([mkEdge("A", "B"), mkEdge("B", "C")]);
            const result = service.getTransitiveDependents(dag, "C");
            expect(result.sort()).toEqual(["A", "B"]);
        });

        it("returns empty for leaf service (no dependents)", () => {
            const dag = service.build([mkEdge("A", "B")]);
            const result = service.getTransitiveDependents(dag, "A");
            expect(result).toEqual([]);
        });
    });

    describe("getTransitiveDependencies()", () => {
        it("returns all upstream services", () => {
            const dag = service.build([mkEdge("A", "B"), mkEdge("B", "C")]);
            const result = service.getTransitiveDependencies(dag, "A");
            expect(result.sort()).toEqual(["B", "C"]);
        });
    });
});
