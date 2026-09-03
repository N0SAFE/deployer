import { Injectable, NotFoundException } from "@nestjs/common";
import { ServiceRepository } from "../repositories/service.repository";
import {
    resolvePreviewTopology,
    type TopologyContext,
    type TopologyDependencyEdge,
    type TopologyResolveInput,
    type TopologyServiceRecord,
} from "./preview-topology.resolver";
import type { ResolvedPreviewNode } from "@repo/api-contracts/modules/service/preview-topology/resolve";

/**
 * Preview-topology dry-run service.
 *
 * Loads the real services + dependency graph + project contract registry for a
 * service, then runs the PURE resolver to show how a preview WOULD resolve its
 * linked services (new instances, reused staging, mocks). Does NOT deploy.
 */
@Injectable()
export class PreviewTopologyService {
    constructor(private readonly serviceRepository: ServiceRepository) {}

    /**
     * Resolve the preview topology for a service.
     * @returns the resolved chain (flat node list) + consulted contracts.
     */
    async resolve(
        serviceId: string,
        input: TopologyResolveInput,
    ): Promise<{ nodes: ResolvedPreviewNode[]; environment: string; input: TopologyResolveInput; contracts: string[] }> {
        const root = await this.serviceRepository.findById(serviceId);
        if (!root) {
            throw new NotFoundException(`Service ${serviceId} not found`);
        }

        // 1) Load project contract registry (DI interfaces).
        const settings = await this.serviceRepository.getProjectSettings(root.projectId);
        const contracts = ((settings as { contracts?: Record<string, unknown> } | null)?.contracts ?? {});

        // 2) Build service + deps maps by BFS over the whole project (top-level
        //    query is cheap; keeps the pure resolver free of IO).
        const services = new Map<string, TopologyServiceRecord>();
        const deps = new Map<string, TopologyDependencyEdge[]>();

        // Seed with the root, then expand via getDependencies recursively.
        const queue = [serviceId];
        const seen = new Set<string>();
        while (queue.length > 0) {
            const id = queue.shift();
            if (!id || seen.has(id)) continue;
            seen.add(id);

            const svc = await this.serviceRepository.findById(id);
            if (!svc) continue;

            services.set(id, {
                id: svc.id,
                name: svc.name,
                implementsContract: svc.implementsContract,
                preview: svc.preview,
            });

            const edges = await this.serviceRepository.getDependencies(id);
            const edgeList: TopologyDependencyEdge[] = edges.map((e) => ({
                serviceId: e.serviceId,
                dependsOnServiceId: e.dependsOnServiceId,
                isRequired: e.isRequired,
            }));
            deps.set(id, edgeList);
            for (const e of edgeList) {
                queue.push(e.dependsOnServiceId);
            }

            // Also index any mockRef referenced by this service's preview config.
            const resolution = svc.preview?.backendResolution;
            if (resolution?.mode === "mock" && resolution.mockRef && !seen.has(resolution.mockRef)) {
                queue.push(resolution.mockRef);
            }
            for (const linked of svc.preview?.linkedServices ?? []) {
                if (!seen.has(linked.serviceId)) queue.push(linked.serviceId);
            }
        }

        // 3) Run the pure resolver.
        const ctx: TopologyContext = { services, deps, contracts, input };
        const result = resolvePreviewTopology(serviceId, ctx);

        return {
            nodes: result.nodes,
            environment: input.environment,
            input,
            contracts: result.contracts,
        };
    }
}
