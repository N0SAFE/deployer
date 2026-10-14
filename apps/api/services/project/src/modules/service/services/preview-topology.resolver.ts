import type { ResolvedPreviewNode } from "@repo/api-contracts/modules/service/preview-topology/resolve";

/**
 * PURE preview-topology resolver (dry-run).
 *
 * Walks the dependency graph of a service and shows how a preview WOULD
 * resolve each linked service — WITHOUT deploying anything. The lifecycle
 * engine consumes the same config in a later phase; this is the read-model.
 *
 * Resolution rules (per hop):
 *  - ROOT: the requested service.
 *  - LINKED-PREVIEW: the consumer's `preview.backendResolution.mode ===
 *    'linked-preview'` (or no preview config → default recurse). The
 *    dependency's own subtree resolves too.
 *  - FIXED: `mode === 'fixed'` → reuse a shared environment (e.g. staging).
 *    Recursion stops at this hop.
 *  - MOCK: `mode === 'mock'` → replace the dependency with a mock service.
 *    The swap is validated: mock.implements.contractRef must equal the
 *    replaced service's implementsContract.contractRef. If the mock has no
 *    implementsContract but the replaced service does, the swap FAILS.
 *  - DERIVE: `mode === 'derive'` → resolve environment from an input key
 *    (e.g. pullRequestNumber), fallback if absent.
 *
 * Cycle guard: a visited service is not re-expanded (returns a terminal node).
 */

export interface TopologyServiceRecord {
    id: string;
    name: string;
    /** The contract this service implements (DI semantics). */
    implementsContract?: { contractRef: string; compatibility?: string } | null;
    /** Per-service preview template (backendResolution + linkedServices). */
    preview?: {
        backendResolution?:
            | { mode: "linked-preview" }
            | { mode: "fixed"; targetEnvironment: string }
            | { mode: "mock"; mockRef: string }
            | { mode: "derive"; fromInputKey: string; fallbackEnvironment: string };
        linkedServices?: { serviceId: string; mode?: string; mockRef?: string; fixedEnvironment?: string }[];
    } | null;
}

export interface TopologyDependencyEdge {
    serviceId: string;
    dependsOnServiceId: string;
    isRequired: boolean;
}

export interface TopologyResolveInput {
    environment: string;
    pullRequestNumber?: number;
    branch?: string;
}

/** Project contract registry: contractRef → source/version. */
export type ContractRegistry = Record<string, unknown>;

export interface TopologyContext {
    /** serviceId → service record. */
    services: Map<string, TopologyServiceRecord>;
    /** serviceId → dependency edges. */
    deps: Map<string, TopologyDependencyEdge[]>;
    /** Project contracts (contractRef → def). */
    contracts: ContractRegistry;
    input: TopologyResolveInput;
}

export interface ResolveResult {
    nodes: ResolvedPreviewNode[];
    contracts: string[];
}

/**
 * Resolve the preview topology for `rootId` under the given context.
 * Emits a FLAT node list (root first) — each node carries depth + path so the
 * UI can rebuild the tree.
 */
export function resolvePreviewTopology(rootId: string, ctx: TopologyContext): ResolveResult {
    const visited = new Set<string>();
    const contracts = Object.keys(ctx.contracts);
    const nodes: ResolvedPreviewNode[] = [];

    const emit = (node: ResolvedPreviewNode): void => {
        nodes.push(node);
    };

    const resolveNode = (serviceId: string, kind: "root" | "linked-preview", depth: number, path: string): void => {
        const service = ctx.services.get(serviceId);
        const base: ResolvedPreviewNode = {
            serviceId,
            serviceName: service?.name ?? serviceId,
            resolution: kind,
            depth,
            path,
        };
        if (!service) {
            base.reason = "Service not found in context";
            emit(base);
            return;
        }
        base.serviceName = service.name;

        if (visited.has(serviceId)) {
            base.reason = "Cycle guard — already expanded";
            emit(base);
            return;
        }
        visited.add(serviceId);
        emit(base);

        if (kind === "root" || kind === "linked-preview") {
            const edges = ctx.deps.get(serviceId) ?? [];
            const resolution = service.preview?.backendResolution;

            for (const edge of edges) {
                resolveDependency(edge.dependsOnServiceId, resolution, edge, depth, path);
            }

            for (const linked of service.preview?.linkedServices ?? []) {
                if (visited.has(linked.serviceId)) continue;
                visited.add(linked.serviceId);
                const linkedService = ctx.services.get(linked.serviceId);
                const child: ResolvedPreviewNode = {
                    serviceId: linked.serviceId,
                    serviceName: linkedService?.name ?? linked.serviceId,
                    resolution: "linked-preview",
                    depth: depth + 1,
                    path: `${path}/linked:${linked.serviceId}`,
                    reason: `Declared linked service (mode: ${linked.mode ?? "inherit"})`,
                };
                if (linked.mode === "fixed" && linked.fixedEnvironment) {
                    child.resolution = "fixed";
                    child.targetEnvironment = linked.fixedEnvironment;
                    child.reason = `Linked service pinned to ${linked.fixedEnvironment}`;
                } else if (linked.mode === "mock" && linked.mockRef) {
                    child.resolution = "mock";
                    child.mockRef = linked.mockRef;
                    child.reason = "Linked service replaced by mock";
                }
                emit(child);
            }
        }
    };

    const resolveDependency = (
        depId: string,
        resolution: NonNullable<TopologyServiceRecord["preview"]>["backendResolution"],
        edge: TopologyDependencyEdge,
        depth: number,
        path: string,
    ): void => {
        const dep = ctx.services.get(depId);
        const childDepth = depth + 1;
        const childPath = `${path}/${dep?.name ?? depId}`;

        // Default: linked-preview (recurse into the dep's own subtree).
        if (!resolution || resolution.mode === "linked-preview") {
            const before = nodes.length;
            resolveNode(depId, "linked-preview", childDepth, childPath);
            // Annotate the first emitted node for this dep with the edge reason.
            if (nodes.length > before) {
                const emitted = nodes[before];
                if (emitted) {
                    emitted.reason = `Linked preview of "${dep?.name ?? depId}" (${edge.isRequired ? "required" : "optional"} dep)`;
                }
            }
            return;
        }

        // Fixed: reuse a shared environment — recursion stops.
        if (resolution.mode === "fixed") {
            emit({
                serviceId: depId,
                serviceName: dep?.name ?? depId,
                resolution: "fixed",
                targetEnvironment: resolution.targetEnvironment,
                depth: childDepth,
                path: childPath,
                reason: `Reuse ${resolution.targetEnvironment} "${dep?.name ?? depId}" — no new instance`,
            });
            return;
        }

        // Derive: environment from input key w/ fallback — recursion stops.
        if (resolution.mode === "derive") {
            const derived = ctx.input[resolution.fromInputKey as keyof TopologyResolveInput] ?? resolution.fallbackEnvironment;
            emit({
                serviceId: depId,
                serviceName: dep?.name ?? depId,
                resolution: "derive",
                targetEnvironment: String(derived),
                depth: childDepth,
                path: childPath,
                reason: `Environment derived from input key "${resolution.fromInputKey}" → ${String(derived)}`,
            });
            return;
        }

        // Mock: replace the dep with a mock implementing the same contract.
        if (resolution.mode === "mock") {
            const mock = ctx.services.get(resolution.mockRef);
            const depContract = dep?.implementsContract?.contractRef;
            const mockContract = mock?.implementsContract?.contractRef;
            const validated = Boolean(depContract && mockContract && depContract === mockContract);

            let reason: string;
            if (!mock) {
                reason = `Mock "${resolution.mockRef}" not found`;
            } else if (!depContract) {
                reason = `Mock swap skipped — "${dep?.name}" declares no contract`;
            } else if (mockContract === depContract) {
                reason = `DI swap valid: "${mock.name}" implements ${mockContract} (same as "${dep?.name}")`;
            } else {
                reason = `CONTRACT MISMATCH: "${mock.name}" implements ${mockContract ?? "none"}, "${dep?.name}" needs ${depContract}`;
            }

            emit({
                serviceId: resolution.mockRef,
                serviceName: mock?.name ?? resolution.mockRef,
                resolution: "mock",
                mockRef: resolution.mockRef,
                mockValidated: validated,
                contractRef: depContract ?? undefined,
                depth: childDepth,
                path: childPath,
                reason,
            });
            return;
        }

        // Unreachable — discriminated union exhaustiveness.
        resolveNode(depId, "linked-preview", childDepth, childPath);
    };

    resolveNode(rootId, "root", 0, "root");

    return { nodes, contracts };
}
