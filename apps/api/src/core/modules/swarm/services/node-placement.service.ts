/**
 * NodePlacementService — builds Swarm placement constraints/preferences from
 * the platform's placement policy (docs/swarm-orchestration/04 §5).
 *
 * Shared-node rule: the DEFAULT is no constraints — user services schedule
 * anywhere, including managers (swarm managers are workers by default, so
 * `node.role == worker` admits every node). Only project opt-ins and the
 * ingress label produce hard constraints, per doc-04 rule 4.
 */

export interface SwarmPlacementPlan {
    constraints: string[];
    preferences: { spreadDescriptor: string }[];
}

export type PlacementPolicy =
    | "default"
    | "dedicated"
    | "exclude-ingress"
    | "prefer-region";

export interface PlacementPolicyInput {
    policy: PlacementPolicy;
    /** Tenant id embedded in the dedicated constraint (`deployer.tenant.<id>`). */
    tenantId?: string;
    /** Region label value for `prefer-region` (spread descriptor). */
    regionLabel?: string;
}

/**
 * Map a platform placement policy to Swarm placement.
 *
 * - `default`: no constraints (shared nodes — managers schedule too).
 * - `dedicated`: only nodes labelled `deployer.tenant.<tenantId> == true`.
 * - `exclude-ingress`: never on ingress nodes (`deployer.ingress != true`).
 * - `prefer-region`: spread preference over `node.labels.deployer.region`
 *   (soft — the spread value may be an empty string).
 */
export function toSwarmPlacement(input: PlacementPolicyInput): SwarmPlacementPlan {
    switch (input.policy) {
        case "dedicated": {
            if (!input.tenantId) {
                return { constraints: [], preferences: [] };
            }
            return {
                constraints: [`node.labels.deployer.tenant.${input.tenantId} == true`],
                preferences: [],
            };
        }
        case "exclude-ingress":
            return { constraints: ["node.labels.deployer.ingress != true"], preferences: [] };
        case "prefer-region":
            return {
                constraints: [],
                preferences: [{ spreadDescriptor: "node.labels.deployer.region" }],
            };
        case "default":
        default:
            return { constraints: [], preferences: [] };
    }
}

/**
 * Parse an executor label convention (`deployer.placement=<policy>`) into a
 * typed policy. Unknown/missing → `default`.
 */
export function parsePlacementPolicyLabel(value: string | undefined): PlacementPolicy {
    switch (value) {
        case "dedicated":
        case "exclude-ingress":
        case "prefer-region":
            return value;
        default:
            return "default";
    }
}