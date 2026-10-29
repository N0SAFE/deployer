import { hostname } from "node:os";

import z from "zod/v4";

import { MESH_WEBSOCKET_PATH } from "@deployer/mesh-agent-contracts";
import { apiServicePort } from "@deployer/shared/server";

/**
 * The agent's environment, and it is DEV-ONLY.
 *
 * A node is plug and play: it starts with nothing configured, generates its own identity and credential on first boot,
 * keeps them in its local store, and joins a swarm later with a token. None of that comes from the environment. What
 * is here only lets a developer or a test pin a value, or a deployment choose where the agent keeps its file.
 */
export const meshAgentEnvSchema = z.object({
  /** Where the agent keeps its local store. A deployment mount point, not node configuration. */
  MESH_DATA_DIR: z.string().min(1).optional(),
  /** DEV: pin this node's id instead of the one generated on first boot. */
  MESH_NODE_ID: z.string().min(1).optional(),
  /** DEV: pin the credential instead of the generated one, so two dev agents can talk without a join. */
  MESH_AGENT_SECRET: z.string().min(32, "MESH_AGENT_SECRET must be at least 32 characters").optional(),
  /** DEV: where the other agents reach this one. Defaults to this host's name on the agent port. */
  MESH_ADVERTISE_URL: z.url().optional(),
  /** DEV: agents to join at boot, comma separated websocket URLs, so a dev stack forms without a token. */
  MESH_SEEDS: z.string().optional(),
});

export type MeshAgentEnv = z.infer<typeof meshAgentEnvSchema>;

export const DEFAULT_DATA_DIR = "/var/lib/deployer/mesh-agent";

export function parseMeshAgentEnv(env: Record<string, unknown>): MeshAgentEnv {
  return meshAgentEnvSchema.parse(env);
}

export function resolveDataDir(env: MeshAgentEnv): string {
  return env.MESH_DATA_DIR ?? DEFAULT_DATA_DIR;
}

export function resolveSeeds(env: Pick<MeshAgentEnv, "MESH_SEEDS">): readonly string[] {
  return (env.MESH_SEEDS ?? "")
    .split(",")
    .map((seed) => seed.trim())
    .filter((seed) => seed.length > 0);
}

/** Where the other agents reach this one: the advertised URL, or this host's name on the agent port. */
export function resolveAdvertisedAddress(env: Pick<MeshAgentEnv, "MESH_ADVERTISE_URL">): string {
  return env.MESH_ADVERTISE_URL ?? `ws://${hostname()}:${String(apiServicePort("mesh-agent"))}${MESH_WEBSOCKET_PATH}`;
}
