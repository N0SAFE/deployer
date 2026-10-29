import { hostname } from "node:os";

import z from "zod/v4";

/**
 * What an agent needs to start. Deliberately small: no database, no Redis, no session secret, because an agent runs
 * on every node, before the swarm and its database exist.
 */
export const meshAgentEnvSchema = z.object({
  /** The credential every mesh peer presents. Shared by the agents and the services of one platform. */
  MESH_AGENT_SECRET: z.string().min(32, "MESH_AGENT_SECRET must be at least 32 characters"),
  /** This node's id. Defaults to the hostname, which is unique per swarm node. */
  MESH_NODE_ID: z.string().min(1).optional(),
});

export type MeshAgentEnv = z.infer<typeof meshAgentEnvSchema>;

export function parseMeshAgentEnv(env: Record<string, unknown>): MeshAgentEnv {
  return meshAgentEnvSchema.parse(env);
}

export function resolveNodeId(env: MeshAgentEnv): string {
  return env.MESH_NODE_ID ?? hostname();
}
