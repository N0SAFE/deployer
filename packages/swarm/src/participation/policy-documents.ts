import { swarmPolicyDocumentSchema } from "@deployer/contracts-entities";

/** The policies the UI offers and what each does to the local node. */
export const POLICY_DOCUMENTS = [
    swarmPolicyDocumentSchema.parse({
        policy: "auto",
        name: "Mixed — master & worker",
        description:
            "This node is a swarm manager AND keeps running workloads. Every server pulls its weight: small clusters (2–3 nodes) get quorum + capacity without a dedicated control plane.",
        bestFor: "Small fleets (2–3 nodes), dev, single-node",
        role: "manager",
        schedulesWorkloads: true,
        recommended: true,
    }),
    swarmPolicyDocumentSchema.parse({
        policy: "manager",
        name: "Dedicated master",
        description:
            "This node is a swarm manager that does NOT run workload tasks (drained). It is reserved for the control plane — the right choice in larger fleets with a dedicated controller.",
        bestFor: "Large fleets, dedicated control node",
        role: "manager",
        schedulesWorkloads: false,
        recommended: false,
    }),
    swarmPolicyDocumentSchema.parse({
        policy: "worker",
        name: "Worker only",
        description:
            "This node only runs workloads. Control-plane duties live on other managers. Only meaningful when joining an existing cluster (the founding node is always a manager).",
        bestFor: "Adding capacity to an existing cluster",
        role: "worker",
        schedulesWorkloads: true,
        recommended: false,
    }),
] as const;
