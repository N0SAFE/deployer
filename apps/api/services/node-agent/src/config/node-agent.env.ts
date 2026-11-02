import { hostname } from "node:os";

import z from "zod/v4";

import { apiServicePort } from "@deployer/env";
import { primaryLanAddress } from "@deployer/node-agent-container";
import { MESH_ADMIN_SOCKET_NAME, MESH_LOCAL_SOCKET_NAME, MESH_WEBSOCKET_PATH } from "@deployer/node-agent-contracts";

import { declaredAddresses } from "../network/endpoint-discovery";
import { DEFAULT_WIREGUARD_PORT } from "../network/overlay";

/**
 * The agent's environment, and it is DEV-ONLY.
 *
 * A node is plug and play: it starts with nothing configured, generates its own identity and credential on first boot,
 * keeps them in its local store, and joins a swarm later with a token. None of that comes from the environment. What
 * is here only lets a developer or a test pin a value, or a deployment choose where the agent keeps its file.
 */
export const nodeAgentEnvSchema = z.object({
  /** Where the agent keeps its local store. A deployment mount point, not node configuration. */
  NODE_AGENT_DATA_DIR: z.string().min(1).optional(),
  /**
   * Where this agent binds its local socket. A deployment mount point, not node configuration: the run volume is shared
   * with setup and the API, which reach the node door here.
   */
  NODE_AGENT_SOCKET: z.string().min(1).optional(),
  /**
   * Where this agent binds its ADMIN socket (mode 0600): credential, rotate, join, token, block and `node.configure`. A
   * deployment mounts it only into the processes that perform operator actions, so a compromised service container
   * cannot join a swarm, rotate the secret or reconfigure the node.
   */
  NODE_AGENT_ADMIN_SOCKET: z.string().min(1).optional(),
  /** DEV: pin this node's id instead of the one generated on first boot. */
  MESH_NODE_ID: z.string().min(1).optional(),
  /** DEV: pin the credential instead of the generated one, so two dev agents can talk without a join. */
  NODE_AGENT_SECRET: z.string().min(32, "NODE_AGENT_SECRET must be at least 32 characters").optional(),
  /** DEV: where the other agents reach this one. Defaults to this host's name on the agent port. */
  MESH_ADVERTISE_URL: z.url().optional(),
  /** DEV: agents to join at boot, comma separated websocket URLs, so a dev stack forms without a token. */
  MESH_SEEDS: z.string().optional(),
  /** DEPLOYMENT: addresses peers may reach this node's WireGuard listener on, comma separated IPv4. */
  MESH_DECLARED_ADDRESSES: z.string().optional(),
  /**
   * DEV: STUN servers to learn this node's reflexive address from, comma separated `host:port`. Empty by default, so a
   * LAN-only node never waits on the internet.
   */
  MESH_STUN_SERVERS: z.string().optional(),
  /**
   * DEPLOYMENT: whether this agent also converges the WireGuard overlay. Off by default so an agent started by hand never
   * touches the host; the deployment's container spec sets it (`MESH_WIREGUARD_ENABLED=true`).
   */
  MESH_WIREGUARD_ENABLED: z.string().optional(),
  /** DEPLOYMENT: the port this node's WireGuard listener answers on. */
  MESH_WIREGUARD_PORT: z.coerce.number().int().min(1).max(65_535).optional(),
  /**
   * DEPLOYMENT: how many known agents one gossip round exchanges with. Rotation reaches the rest over the next rounds;
   * `0` exchanges with every known agent, which is what a small mesh wants and what the agent used to do.
   */
  MESH_GOSSIP_FANOUT: z.coerce.number().int().min(0).optional(),
  /**
   * DEV: how often the agent gossips, converges its doors, converges the overlay and evicts idle links. Unset uses the
   * transport's defaults (5 s / 5 s / 5 s / 30 s); a test sets them fast instead of passing options to a function.
   */
  MESH_GOSSIP_INTERVAL_MS: z.coerce.number().int().min(1).optional(),
  MESH_DOORS_INTERVAL_MS: z.coerce.number().int().min(1).optional(),
  MESH_WIREGUARD_INTERVAL_MS: z.coerce.number().int().min(1).optional(),
  MESH_EVICTION_INTERVAL_MS: z.coerce.number().int().min(1).optional(),
  /**
   * DEPLOYMENT: agent hops a forwarded call may take. `0` disables forwarding entirely, so the old two-hop behaviour
   * returns without a redeploy of the mesh.
   */
  MESH_RELAY_MAX_HOPS: z.coerce.number().int().min(0).optional(),
  /** DEPLOYMENT: next hops tried per forwarding decision. The first that answers wins. */
  MESH_RELAY_NEXT_HOP_ATTEMPTS: z.coerce.number().int().min(1).optional(),
  /** DEPLOYMENT: how long a direct link that failed at the transport is remembered as unreachable. */
  MESH_RELAY_UNREACHABLE_MS: z.coerce.number().int().min(0).optional(),
  /** DEV: log every forwarding decision. */
  MESH_DEBUG_RELAY: z.string().optional(),
  /**
   * DEPLOYMENT: how long one agent-to-agent call may take before it is treated as a transport failure. It bounds the
   * relay's direct hop, gossip's exchange and the credential fetch during a rotation.
   */
  NODE_AGENT_CALL_TIMEOUT_MS: z.coerce.number().int().min(1).optional(),
  /**
   * DEPLOYMENT: the only image the agent runs a node door with. A `node.doors` setting that names another one is refused,
   * so a written setting cannot make the node run an arbitrary image.
   */
  NODE_AGENT_DOOR_IMAGE: z.string().min(1).max(256).optional(),
  /** DEPLOYMENT: the owner of the local socket (default root). Only that user's services reach the agent. */
  NODE_AGENT_SOCKET_UID: z.coerce.number().int().min(0).optional(),
  NODE_AGENT_SOCKET_GID: z.coerce.number().int().min(0).optional(),
  /**
   * DEPLOYMENT: the interface this agent binds its peer door on. Unset binds every interface (`0.0.0.0`); set it to the
   * node's LAN/overlay address so the door answers only where peers actually reach this node.
   */
  NODE_AGENT_BIND_ADDRESS: z.string().min(1).optional(),
  /** DEPLOYMENT: the Docker socket the agent converges its doors through. */
  NODE_AGENT_DOCKER_SOCKET: z.string().min(1).default("/var/run/docker.sock"),
  /** DEPLOYMENT: the directory holding the agent's WireGuard config. Defaults to the agent's data dir. */
  NODE_AGENT_STATE_DIR: z.string().min(1).optional(),
  /**
   * DEV: log the agent's own debug detail (`true` or `1`). Off by default so a production node logs only decisions,
   * and a typo leaves it off rather than on.
   */
  NODE_AGENT_DEBUG_RELAY: z.string().optional(),
});

export type NodeAgentEnv = z.infer<typeof nodeAgentEnvSchema>;

export const DEFAULT_DATA_DIR = "/var/lib/deployer/node-agent";

/** Eight peers per round: a large fleet converges in a few rounds without every agent dialing every other agent. */
export const DEFAULT_GOSSIP_FANOUT = 8;

/** Two hops is one intermediate agent: enough for a partition one segment deep, bounded enough to be a non-event. */
export const DEFAULT_RELAY_MAX_HOPS = 2;
/** The contract's own bound: a forwarded call is cloned per hop, so the count is capped rather than trusted. */
export const MAX_RELAY_MAX_HOPS = 8;
export const DEFAULT_RELAY_NEXT_HOP_ATTEMPTS = 2;
/** A dial timeout is expensive, so a node that refused the connection is not dialed again for this long. */
export const DEFAULT_RELAY_UNREACHABLE_MS = 30_000;

/** Five seconds: a peer that has not answered by then is treated as a transport failure, never as an answer. */
export const DEFAULT_CALL_TIMEOUT_MS = 5_000;

/** The one image a door may run: a `node.doors` setting that names anything else is refused. */
export const DEFAULT_DOOR_IMAGE = "nginx:alpine";

export function parseNodeAgentEnv(env: Record<string, unknown>): NodeAgentEnv {
  return nodeAgentEnvSchema.parse(env);
}

export function resolveDataDir(env: Pick<NodeAgentEnv, "NODE_AGENT_DATA_DIR">): string {
  return env.NODE_AGENT_DATA_DIR ?? DEFAULT_DATA_DIR;
}

/** The socket this agent binds: the deployment's mount point, or the fixed name inside its data dir. */
export function resolveLocalSocketPath(env: Pick<NodeAgentEnv, "NODE_AGENT_DATA_DIR" | "NODE_AGENT_SOCKET">): string {
  return env.NODE_AGENT_SOCKET ?? `${resolveDataDir(env)}/run/${MESH_LOCAL_SOCKET_NAME}`;
}

/** The socket the operator-facing processes reach the agent through: mode 0600, its own directory by default. */
export function resolveAdminSocketPath(env: Pick<NodeAgentEnv, "NODE_AGENT_DATA_DIR" | "NODE_AGENT_ADMIN_SOCKET">): string {
  return env.NODE_AGENT_ADMIN_SOCKET ?? `${resolveDataDir(env)}/run/${MESH_ADMIN_SOCKET_NAME}`;
}

export function resolveSeeds(env: Pick<NodeAgentEnv, "MESH_SEEDS">): readonly string[] {
  return (env.MESH_SEEDS ?? "")
    .split(",")
    .map((seed) => seed.trim())
    .filter((seed) => seed.length > 0);
}

/** Only `true` and `1` enable the overlay: a typo must not switch a kernel writer on. */
export function wireguardEnabled(env: Pick<NodeAgentEnv, "MESH_WIREGUARD_ENABLED">): boolean {
  return env.MESH_WIREGUARD_ENABLED === "true" || env.MESH_WIREGUARD_ENABLED === "1";
}

export function resolveWireguardPort(env: Pick<NodeAgentEnv, "MESH_WIREGUARD_PORT">): number {
  return env.MESH_WIREGUARD_PORT ?? DEFAULT_WIREGUARD_PORT;
}

export function resolveGossipFanout(env: Pick<NodeAgentEnv, "MESH_GOSSIP_FANOUT">): number {
  return env.MESH_GOSSIP_FANOUT ?? DEFAULT_GOSSIP_FANOUT;
}

/** How far a forwarded call may travel: the deployment's relay settings, bounded by the contract to 0..8 hops. */
export function resolveRelaySettings(env: Pick<NodeAgentEnv, "MESH_RELAY_MAX_HOPS" | "MESH_RELAY_NEXT_HOP_ATTEMPTS" | "MESH_RELAY_UNREACHABLE_MS">): {
  readonly maxHops: number;
  readonly nextHopAttempts: number;
  readonly unreachableMs: number;
} {
  return {
    maxHops: Math.min(env.MESH_RELAY_MAX_HOPS ?? DEFAULT_RELAY_MAX_HOPS, MAX_RELAY_MAX_HOPS),
    nextHopAttempts: env.MESH_RELAY_NEXT_HOP_ATTEMPTS ?? DEFAULT_RELAY_NEXT_HOP_ATTEMPTS,
    unreachableMs: env.MESH_RELAY_UNREACHABLE_MS ?? DEFAULT_RELAY_UNREACHABLE_MS,
  };
}

/** Only `true` and `1` log: a typo must not fill a node's log during a partition. */
export function relayDebug(): boolean {
  return process.env.MESH_DEBUG_RELAY === "true" || process.env.MESH_DEBUG_RELAY === "1";
}

/** The addresses the operator declares reachable for this node's WireGuard listener. */
export function resolveDeclaredAddresses(
  env: Pick<NodeAgentEnv, "MESH_DECLARED_ADDRESSES">,
): readonly string[] {
  return declaredAddresses(env.MESH_DECLARED_ADDRESSES ?? "");
}

/** The STUN servers to try for a reflexive address: none unless configured, so the agent stays offline by default. */
export function resolveStunServers(env: Pick<NodeAgentEnv, "MESH_STUN_SERVERS">): readonly string[] {
  return (env.MESH_STUN_SERVERS ?? "")
    .split(",")
    .map((server) => server.trim())
    .filter((server) => server.length > 0);
}

/** Where the other agents reach this one: the advertised URL, or this host's LAN address on the agent port. */
export function resolveAdvertisedAddress(env: Pick<NodeAgentEnv, "MESH_ADVERTISE_URL">): string {
  // A host-network container or a swarm task still has its own UTS namespace, so `hostname()` there is the container id:
  // an address no peer can dial. The LAN address is the one the other nodes reach, so it comes first.
  return env.MESH_ADVERTISE_URL ?? `ws://${primaryLanAddress() ?? hostname()}:${String(apiServicePort("node-agent"))}${MESH_WEBSOCKET_PATH}`;
}

/** How long one agent-to-agent call may take before it is a transport failure. */
export function resolveCallTimeoutMs(env: Pick<NodeAgentEnv, "NODE_AGENT_CALL_TIMEOUT_MS">): number {
  return env.NODE_AGENT_CALL_TIMEOUT_MS ?? DEFAULT_CALL_TIMEOUT_MS;
}

/** The only image a node door may run: the deployment pins it, and a `node.doors` setting cannot choose another. */
export function resolveDoorImage(env: Pick<NodeAgentEnv, "NODE_AGENT_DOOR_IMAGE">): string {
  return env.NODE_AGENT_DOOR_IMAGE ?? DEFAULT_DOOR_IMAGE;
}

/** Who owns the local socket. Its permissions are the trust boundary, so its owner is a deployment decision. */
export function resolveSocketOwnership(env: Pick<NodeAgentEnv, "NODE_AGENT_SOCKET_UID" | "NODE_AGENT_SOCKET_GID">): {
  readonly uid: number;
  readonly gid: number;
} {
  return { uid: env.NODE_AGENT_SOCKET_UID ?? 0, gid: env.NODE_AGENT_SOCKET_GID ?? 0 };
}

/**
 * What to say once at boot about the image, or null when there is nothing to say.
 *
 * A production node on an unset or `:dev` image is a node running a developer's build: it works, and it is not the
 * image the deployment pinned. That is a warning, never a failure — refusing to start would take a working node down
 * over a tag.
 */
export function productionImageWarning(env: {
  readonly NODE_ENV?: string | undefined;
  readonly NODE_AGENT_IMAGE?: string | undefined;
}): string | null {
  if (env.NODE_ENV !== "production") return null;
  const image = env.NODE_AGENT_IMAGE;
  if (image === undefined || image === "") {
    return "NODE_ENV=production with NODE_AGENT_IMAGE unset: this node runs whichever agent image it was started with";
  }
  return image.endsWith(":dev")
    ? `NODE_ENV=production with NODE_AGENT_IMAGE=${image}: a dev tag on a production node, not the image the deployment pinned`
    : null;
}
