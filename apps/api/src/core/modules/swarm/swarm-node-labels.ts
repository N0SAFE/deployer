/**
 * Swarm NODE label keys + the platform-role mapping they carry.
 *
 * SINGLE SOURCE OF TRUTH. These labels are the only DURABLE record of a node's
 * platform role / ingress flag: they live on the Swarm node itself, so they
 * survive restarts and are visible from every node. The local SQLite inventory
 * is only a CACHE — it is rebuilt from `docker node ls` on every sweep, so any
 * value that exists only there is destroyed (that is exactly what used to
 * happen to an operator's role choice: the periodic sweep rewrote it to the
 * default within one cycle).
 *
 * Role vocabulary (`clusterPlatformRoleSchema`): `both` (runs the control plane
 * AND workloads — the shared-node default), `control`, `worker`.
 */

import { clusterPlatformRoleSchema, type ClusterPlatformRole, type SwarmNodePolicy } from "@repo/contracts-entities";

/** Marks a node as an ingress node (`deployer.ingress == "true"`). */
export const SWARM_NODE_LABEL_INGRESS = "deployer.ingress";

/** The node's platform role (`deployer.node.role == both|control|worker`). */
export const SWARM_NODE_LABEL_ROLE = "deployer.node.role";

/** Region label used for `prefer-region` spread preferences. */
export const SWARM_NODE_LABEL_REGION = "deployer.region";

/** Prefix of the per-tenant placement label (`deployer.tenant.<id>`). */
export const SWARM_NODE_LABEL_TENANT_PREFIX = "deployer.tenant.";

/**
 * Participation POLICY → the PLATFORM ROLE stored on the node.
 *
 * The two vocabularies are different on purpose: the policy describes how the
 * node JOINS (`auto`/`manager`/`worker`), while the label describes what the
 * node IS (`both`/`control`/`worker`). Writing the policy value into the role
 * label made the two indistinguishable — the label must always carry the ROLE.
 */
export function platformRoleForPolicy(policy: SwarmNodePolicy): ClusterPlatformRole {
    switch (policy) {
        case "manager":
            return "control";
        case "worker":
            return "worker";
        case "auto":
        default:
            return "both";
    }
}

/** Read the platform role from node labels; unknown/absent → `both`. */
export function platformRoleFromLabels(
    labels: Record<string, string> | undefined,
): ClusterPlatformRole {
    const parsed = clusterPlatformRoleSchema.safeParse(labels?.[SWARM_NODE_LABEL_ROLE]);
    return parsed.success ? parsed.data : "both";
}

/** Read the ingress flag from node labels. */
export function ingressFromLabels(labels: Record<string, string> | undefined): boolean {
    return labels?.[SWARM_NODE_LABEL_INGRESS] === "true";
}

/**
 * Return `labels` with the platform role applied. `both` REMOVES the label
 * (it is the default) so a node never carries a redundant value.
 *
 * @param role `null` → leave the role untouched.
 */
export function withPlatformRole(
    labels: Record<string, string>,
    role: ClusterPlatformRole | null,
): Record<string, string> {
    if (role === null) return labels;
    const next = { ...labels };
    if (role === "both") {
        delete next[SWARM_NODE_LABEL_ROLE];
    } else {
        next[SWARM_NODE_LABEL_ROLE] = role;
    }
    return next;
}

/**
 * Return `labels` with the ingress flag applied. `false` REMOVES the label.
 *
 * @param ingress `null` → leave the flag untouched.
 */
export function withIngress(
    labels: Record<string, string>,
    ingress: boolean | null,
): Record<string, string> {
    if (ingress === null) return labels;
    const next = { ...labels };
    if (ingress) {
        next[SWARM_NODE_LABEL_INGRESS] = "true";
    } else {
        delete next[SWARM_NODE_LABEL_INGRESS];
    }
    return next;
}