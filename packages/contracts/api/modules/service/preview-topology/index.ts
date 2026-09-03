import { oc } from "@orpc/contract";
import { previewTopologyResolveContract } from "./resolve";

/**
 * Standalone router (NOT nested inside `serviceContract`) — keeps the service
 * router's recursive contracts (subtree, deps) within tsgo's inference depth.
 * URL stays `/services/:serviceId/preview-topology`.
 */
export const servicePreviewTopologyContract = oc
    .tag("Service Preview Topology")
    .prefix("/services")
    .router({
        resolve: previewTopologyResolveContract,
    });

export { previewTopologyResolveContract };
export type { ResolvedPreviewNode, PreviewResolutionKind } from "./resolve";
export { resolvedPreviewNodeSchema, previewResolutionKindSchema } from "./resolve";
