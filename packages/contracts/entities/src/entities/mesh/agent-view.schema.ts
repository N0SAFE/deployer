import z from "zod/v4";

/**
 * What the dashboard knows of the mesh, as the agent of the node knows it: the nodes, where they answer, and the
 * replicas each one runs. Nothing here is measured or configured by the platform; it is what the agents report.
 */

/** One node of the swarm: its id, where its agent answers on the overlay network, and whether it is the node asked. */
export const meshAgentNodeSchema = z.object({
  nodeId: z.string().min(1),
  address: z.string().min(1),
  local: z.boolean(),
});
export type MeshAgentNode = z.infer<typeof meshAgentNodeSchema>;

export const meshAgentNodesResultSchema = z.object({
  items: z.array(meshAgentNodeSchema),
});
export type MeshAgentNodesResult = z.infer<typeof meshAgentNodesResultSchema>;

/** A replica a node runs, as its agent's directory lists it. */
export const meshAgentReplicaSchema = z.object({
  service: z.string(),
  replicaId: z.string(),
  nodeId: z.string(),
  /** 0 (idle) to 1 (saturated). */
  load: z.number().min(0).max(1),
  /** The resources the replica holds in memory (a deployment, a terminal session, a stream). */
  keys: z.array(z.string()),
});
export type MeshAgentReplica = z.infer<typeof meshAgentReplicaSchema>;

/** The swarm at one moment: every node, and every replica the directory holds. */
export const meshAgentSnapshotSchema = z.object({
  generatedAt: z.string(),
  nodes: z.array(meshAgentNodeSchema),
  replicas: z.array(meshAgentReplicaSchema),
});
export type MeshAgentSnapshot = z.infer<typeof meshAgentSnapshotSchema>;

/** Which replica a call about `key` would reach, and why. */
export const meshAgentLookupInputSchema = z.object({
  service: z.string().min(1),
  key: z.string().min(1).optional(),
});
export type MeshAgentLookupInput = z.infer<typeof meshAgentLookupInputSchema>;

export const meshAgentLookupResultSchema = z.object({
  found: z.boolean(),
  replica: meshAgentReplicaSchema.nullable(),
  reason: z.enum(["key-holder", "local-node", "affinity", "least-loaded"]).nullable(),
});
export type MeshAgentLookupResult = z.infer<typeof meshAgentLookupResultSchema>;

/** A token a new node redeems to join the swarm. Shown once: it carries the swarm's credential. */
export const meshAgentJoinTokenInputSchema = z.object({
  ttlMs: z
    .number()
    .int()
    .positive()
    .max(24 * 60 * 60 * 1000)
    .default(60 * 60 * 1000),
});
export type MeshAgentJoinTokenInput = z.infer<typeof meshAgentJoinTokenInputSchema>;

export const meshAgentJoinTokenResultSchema = z.object({
  token: z.string(),
  expiresAt: z.number(),
});
export type MeshAgentJoinTokenResult = z.infer<typeof meshAgentJoinTokenResultSchema>;
