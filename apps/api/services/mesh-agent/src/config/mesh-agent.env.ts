import { hostname } from "node:os";

import z from "zod/v4";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { apiServicePort } from "@deployer/shared/server";

/**
 * What an agent needs to start. Deliberately small: no database, no Redis, no session secret, because an agent runs
 * on every node, before the swarm and its database exist.
 */
export const meshAgentEnvSchema = z.object({
  /** The credential every mesh peer presents. Shared by the agents and the services of one platform. */
  MESH_AGENT_SECRET: z.string().min(32, "MESH_AGENT_SECRET must be at least 32 characters"),
  /** This node's id. Defaults to the hostname, which is unique per swarm node. */
  MESH_NODE_ID: z.string().min(1).optional(),
  /** Where the other agents reach this one: its websocket on the overlay network, e.g. `ws://10.0.0.1:3106/mesh/ws`. */
  MESH_ADVERTISE_URL: z.url().optional(),
  /** Other agents to learn the mesh from, comma separated websocket URLs. One reachable seed is enough: gossip finds the rest. */
  MESH_SEEDS: z.string().optional(),
});

export type MeshAgentEnv = z.infer<typeof meshAgentEnvSchema>;

export function parseMeshAgentEnv(env: Record<string, unknown>): MeshAgentEnv {
  return meshAgentEnvSchema.parse(env);
}

export function resolveSeeds(env: MeshAgentEnv): readonly string[] {
  return (env.MESH_SEEDS ?? "")
    .split(",")
    .map((seed) => seed.trim())
    .filter((seed) => seed.length > 0);
}

export function resolveNodeId(env: MeshAgentEnv): string {
  return env.MESH_NODE_ID ?? hostname();
}

/** Where the other agents reach this one: the advertised URL, or this host's name on the agent port. */
export function resolveAdvertisedAddress(env: MeshAgentEnv): string {
  return env.MESH_ADVERTISE_URL ?? `ws://${hostname()}:${String(apiServicePort("mesh-agent"))}${MESH_WEBSOCKET_PATH}`;
}
