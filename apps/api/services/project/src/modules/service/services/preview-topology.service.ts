import { NotFoundError } from "@deployer/errors";
import { Context, Effect } from "effect";
import { ServiceStore } from "../repositories/service.repository";
import {
    resolvePreviewTopology,
    type TopologyContext,
    type TopologyDependencyEdge,
    type TopologyResolveInput,
    type TopologyServiceRecord,
} from "./preview-topology.resolver";

/** Preview-topology dry-run use cases, composed as Effects over the store. */
export class PreviewTopologyServiceImpl {
    /**
     * Resolve the preview topology for a service.
     * @returns the resolved chain (flat node list) + consulted contracts.
     */
    resolve(
        serviceId: string,
        input: TopologyResolveInput,
    ) {
        return Effect.gen(function* () {
            const store = yield* ServiceStore;

            const root = yield* store.findById(serviceId);
            if (!root) {
                return yield* Effect.fail(new NotFoundError("Service", serviceId));
            }

            // 1) Load project contract registry (DI interfaces).
            const settings = yield* store.getProjectSettings(root.projectId);
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

                const svc = yield* store.findById(id);
                if (!svc) continue;

                services.set(id, {
                    id: svc.id,
                    name: svc.name,
                    implementsContract: svc.implementsContract,
                    preview: svc.preview,
                });

                const edges = yield* store.getDependencies(id);
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
        });
    }
}

/** The service's public surface is exactly the implementation's methods. */
export type PreviewTopologyServiceShape = PreviewTopologyServiceImpl;

/** Effect key = NestJS token. */
export class PreviewTopologyService extends Context.Service<
    PreviewTopologyService,
    PreviewTopologyServiceShape
>()("project/PreviewTopologyService") {}
