import type { DockerodeNodeSummary } from "@deployer/contracts-entities";

import { ingressFromLabels, platformRoleFromLabels, resolveSwarmNodeRole } from "../labels/swarm-node-labels";

export type EngineNodeRow = {
	readonly nodeId: string;
	readonly hostname: string;
	readonly swarmRole: "manager" | "worker";
	readonly platformRole: "both" | "control" | "worker";
	readonly isLeader: boolean;
	readonly isIngress: boolean;
	readonly availability: "active" | "pause" | "drain";
	/** The engine's own node status (`Status.State`): ready | down | unknown. */
	readonly state: "ready" | "down" | "unknown";
	readonly nanoCpus: number | null;
	readonly memoryBytes: number | null;
	readonly labels: Record<string, string>;
};

/** Pure mapper: dockerode node summary → repository row input (testable).
 *
 * The platform role / ingress flag are read from the NODE's own labels — they
 * are the durable record. Hardcoding the role here destroyed the operator's
 * choice on every sweep (the inventory is a cache rebuilt from `docker node ls`).
 */
export function toEngineNodeRow(node: DockerodeNodeSummary): EngineNodeRow {
    const labels = node.Spec.Labels;
    return {
        nodeId: node.ID,
        hostname: node.Description.Hostname,
        swarmRole: resolveSwarmNodeRole(node),
        platformRole: platformRoleFromLabels(labels),
        isLeader: node.ManagerStatus?.Leader === true,
        isIngress: ingressFromLabels(labels),
        availability:
            node.Spec.Availability === "pause" || node.Spec.Availability === "drain"
                ? node.Spec.Availability
                : "active",
        state:
            node.Status.State === "ready"
                ? "ready"
                : node.Status.State === "down" || node.Status.State === "disconnected"
                  ? "down"
                  : "unknown",
        nanoCpus: node.Description.Resources?.NanoCPUs ?? null,
        memoryBytes: node.Description.Resources?.MemoryBytes ?? null,
        labels,
    };
}