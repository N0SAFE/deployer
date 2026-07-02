import { Injectable } from "@nestjs/common";
import { BadRequestError } from "@/core/errors/app-error";
import type { DependencyTemplateConfig } from "@repo/contracts-entities";

export interface ServiceDagEdge {
    from: string;
    to: string;
    isRequired: boolean;
}

export interface ServiceDagNode {
    serviceId: string;
    dependsOn: string[];   // serviceIds this service must wait for
    dependents: string[];  // serviceIds that depend on this service
    isRequired: boolean;   // false = optional dependency
}

export interface ServiceDag {
    nodes: Map<string, ServiceDagNode>;
    edges: ServiceDagEdge[];
    /** Topologically sorted execution layers (innermost = no deps, outermost = final tier) */
    layers: string[][];
    hasCycles: boolean;
    cycleMembers: string[];
}

export interface ServiceDependencyInput {
    serviceId: string;
    dependsOnServiceId: string;
    isRequired: boolean;
}

/**
 * T038 — Service DAG generation from `service_dependencies` + template policy constraints.
 *
 * Builds a directed acyclic graph (DAG) from a flat list of service dependency edges.
 * Detects cycles, computes execution layers via Kahn's algorithm, and applies
 * ordering strategy constraints from a DependencyTemplateConfig.
 */
@Injectable()
export class ServiceDagService {
    build(
        edges: ServiceDependencyInput[],
        config?: Pick<DependencyTemplateConfig, "orderingStrategy">,
    ): ServiceDag {
        const ordering = config?.orderingStrategy ?? "topological";

        // Build node map
        const nodeMap = new Map<string, ServiceDagNode>();
        const ensureNode = (id: string): ServiceDagNode => {
            if (!nodeMap.has(id)) {
                nodeMap.set(id, { serviceId: id, dependsOn: [], dependents: [], isRequired: true });
            }
            const node = nodeMap.get(id);
            if (node === undefined) {
                throw new BadRequestError(`[ServiceDagService] invariant violation: node '${id}' missing after ensureNode`);
            }
            return node;
        };

        for (const e of edges) {
            const node = ensureNode(e.serviceId);
            const dep = ensureNode(e.dependsOnServiceId);

            if (!node.dependsOn.includes(e.dependsOnServiceId)) {
                node.dependsOn.push(e.dependsOnServiceId);
            }
            if (!dep.dependents.includes(e.serviceId)) {
                dep.dependents.push(e.serviceId);
            }
        }

        // Kahn's algorithm for topological sort + cycle detection
        const { layers, hasCycles, cycleMembers } = this.kahnTopoSort(nodeMap);

        // Apply explicit ordering: if strategy is 'explicit', no reordering beyond input order
        const finalLayers =
            ordering === "explicit"
                ? this.reorderByInputOrder(layers, edges.map((e) => e.serviceId))
                : layers;

        return {
            nodes: nodeMap,
            edges: edges.map((e) => ({ from: e.serviceId, to: e.dependsOnServiceId, isRequired: e.isRequired })),
            layers: finalLayers,
            hasCycles,
            cycleMembers,
        };
    }

    /**
     * Returns the set of services that transitively depend on `serviceId`.
     * Used for blast-radius analysis in fleet rollback and failure containment.
     */
    getTransitiveDependents(dag: ServiceDag, serviceId: string): string[] {
        const visited = new Set<string>();
        const queue = [serviceId];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === undefined) break;
            const node = dag.nodes.get(current);
            if (!node) continue;
            for (const dep of node.dependents) {
                if (!visited.has(dep)) {
                    visited.add(dep);
                    queue.push(dep);
                }
            }
        }
        visited.delete(serviceId);
        return [...visited];
    }

    /**
     * Returns a subgraph slice containing only services that are transitive dependencies
     * of `serviceId` (inclusive).
     */
    getTransitiveDependencies(dag: ServiceDag, serviceId: string): string[] {
        const visited = new Set<string>();
        const queue = [serviceId];
        while (queue.length > 0) {
            const current = queue.shift();
            if (current === undefined) break;
            const node = dag.nodes.get(current);
            if (!node) continue;
            for (const dep of node.dependsOn) {
                if (!visited.has(dep)) {
                    visited.add(dep);
                    queue.push(dep);
                }
            }
        }
        visited.delete(serviceId);
        return [...visited];
    }

    private kahnTopoSort(nodes: Map<string, ServiceDagNode>): {
        layers: string[][];
        hasCycles: boolean;
        cycleMembers: string[];
    } {
        // inDegree = number of dependencies not yet satisfied
        const inDegree = new Map<string, number>();
        for (const [id, node] of nodes) {
            inDegree.set(id, node.dependsOn.length);
        }

        const layers: string[][] = [];
        let remaining = nodes.size;

        for (;;) {
            // Collect all nodes with in-degree 0
            const tier: string[] = [];
            for (const [id, degree] of inDegree) {
                if (degree === 0) {
                    tier.push(id);
                }
            }
            if (tier.length === 0) break;

            // Remove from tracking
            for (const id of tier) {
                inDegree.delete(id);
                const node = nodes.get(id);
                if (node === undefined) {
                    throw new BadRequestError(`[ServiceDagService] invariant violation: node '${id}' in inDegree but missing from nodes map`);
                }
                for (const dep of node.dependents) {
                    const cur = inDegree.get(dep);
                    if (cur !== undefined) {
                        inDegree.set(dep, cur - 1);
                    }
                }
                remaining--;
            }
            layers.push(tier.sort()); // sort for determinism
        }

        const hasCycles = remaining > 0;
        const cycleMembers = [...inDegree.keys()];

        return { layers, hasCycles, cycleMembers };
    }

    private reorderByInputOrder(layers: string[][], inputOrder: string[]): string[][] {
        const posMap = new Map<string, number>();
        let pos = 0;
        for (const id of inputOrder) {
            if (!posMap.has(id)) posMap.set(id, pos++);
        }
        return layers.map((layer) =>
            [...layer].sort((a, b) => (posMap.get(a) ?? 999) - (posMap.get(b) ?? 999)),
        );
    }
}
