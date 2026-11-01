import z from "zod/v4";

/**
 * What the dashboard knows of the mesh, as the agent of the node knows it: the nodes, where they answer, and the
 * replicas each one runs. Nothing here is measured or configured by the platform; it is what the agents report.
 */

/**
 * One node of the swarm: its id, where its agent answers on the overlay network, and whether it is the node asked.
 * `address` is empty for a node without an agent: a swarm of one has no overlay address to report.
 */
export const nodeAgentNodeSchema = z.object({
  nodeId: z.string().min(1),
  address: z.string(),
  local: z.boolean(),
});
export type NodeAgentNode = z.infer<typeof nodeAgentNodeSchema>;

export const nodeAgentNodesResultSchema = z.object({
  items: z.array(nodeAgentNodeSchema),
});
export type NodeAgentNodesResult = z.infer<typeof nodeAgentNodesResultSchema>;

/** A replica a node runs, as its agent's directory lists it. */
export const nodeAgentReplicaSchema = z.object({
  service: z.string(),
  replicaId: z.string(),
  nodeId: z.string(),
  /** 0 (idle) to 1 (saturated). */
  load: z.number().min(0).max(1),
  /** The resources the replica holds in memory (a deployment, a terminal session, a stream). */
  keys: z.array(z.string()),
});
export type NodeAgentReplica = z.infer<typeof nodeAgentReplicaSchema>;

/** The swarm at one moment: every node, and every replica the directory holds. */
export const nodeAgentSnapshotSchema = z.object({
  generatedAt: z.string(),
  nodes: z.array(nodeAgentNodeSchema),
  replicas: z.array(nodeAgentReplicaSchema),
});
export type NodeAgentSnapshot = z.infer<typeof nodeAgentSnapshotSchema>;

/** Which replica a call about `key` would reach, and why. */
export const nodeAgentLookupInputSchema = z.object({
  service: z.string().min(1),
  key: z.string().min(1).optional(),
});
export type NodeAgentLookupInput = z.infer<typeof nodeAgentLookupInputSchema>;

export const nodeAgentLookupResultSchema = z.object({
  found: z.boolean(),
  replica: nodeAgentReplicaSchema.nullable(),
  reason: z.enum(["key-holder", "local-node", "affinity", "least-loaded"]).nullable(),
});
export type NodeAgentLookupResult = z.infer<typeof nodeAgentLookupResultSchema>;

/** A token a new node redeems to join the swarm. Shown once: it carries the swarm's credential. */
export const nodeAgentJoinTokenInputSchema = z.object({
  ttlMs: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
});
export type NodeAgentJoinTokenInput = z.infer<typeof nodeAgentJoinTokenInputSchema>;

export const nodeAgentJoinTokenResultSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
});
export type NodeAgentJoinTokenResult = z.infer<typeof nodeAgentJoinTokenResultSchema>;
