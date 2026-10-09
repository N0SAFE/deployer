/**
 * Agent configuration — everything the agent reads from its environment, parsed once.
 *
 * There is deliberately NO peer list, NO coordinator URL and NO overlay IP here:
 * peers come from the roster, the address from the key. What remains is where the
 * agent keeps its state, how it talks to the kernel, and which public STUN servers
 * it may ask for its reflexive address.
 */

import { hostname } from "node:os";
import { AGENT_SOCKET_DIR, DEFAULT_MESH_LISTEN_PORT, DEFAULT_STUN_SERVERS, isIpv4, MESH_GOSSIP_PORT, MESH_INTERFACE_NAME } from "@repo/mesh-network";
import z from "zod/v4";

const listSchema = z
	.string()
	.optional()
	.transform((value) =>
		(value ?? "")
			.split(",")
			.map((item) => item.trim())
			.filter((item) => item !== ""),
	);

const envSchema = z.object({
	MESH_AGENT_STATE_DIR: z.string().min(1).default("/var/lib/deployer-mesh"),
	MESH_AGENT_SOCKET_DIR: z.string().min(1).default(AGENT_SOCKET_DIR),
	MESH_AGENT_NODE_NAME: z.string().min(1).max(253).optional(),
	MESH_AGENT_INTERFACE: z.string().min(1).max(15).default(MESH_INTERFACE_NAME),
	MESH_AGENT_LISTEN_PORT: z.coerce.number().int().min(1).max(65_535).default(DEFAULT_MESH_LISTEN_PORT),
	MESH_AGENT_GOSSIP_PORT: z.coerce.number().int().min(1).max(65_535).default(MESH_GOSSIP_PORT),
	/** Comma-separated `host:port`. Empty disables reflexive discovery (LAN-only clusters). */
	MESH_AGENT_STUN_SERVERS: z.string().optional(),
	/** Comma-separated IPv4 addresses the operator states are reachable (a `direct` node). */
	MESH_AGENT_DECLARED_ADDRESSES: listSchema,
	MESH_AGENT_TICK_MS: z.coerce.number().int().min(500).default(5_000),
	MESH_AGENT_DOCKER_SOCKET: z.string().min(1).default("/var/run/docker.sock"),
	/**
	 * `kernel` drives a real WireGuard interface. `observe` plans and gossips but
	 * never touches the kernel — for running the agent on a dev machine without
	 * NET_ADMIN, where a half-configured interface would be worse than none.
	 */
	MESH_AGENT_DATAPLANE: z.enum(["kernel", "observe"]).default("kernel"),
});

export type AgentConfig = {
	stateDir: string;
	socketDir: string;
	nodeName: string;
	interfaceName: string;
	listenPort: number;
	gossipPort: number;
	stunServers: string[];
	declaredAddresses: string[];
	tickMs: number;
	dockerSocket: string;
	dataplane: "kernel" | "observe";
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
	const parsed = envSchema.parse(env);
	const invalid = parsed.MESH_AGENT_DECLARED_ADDRESSES.filter((address) => !isIpv4(address));
	if (invalid.length > 0) throw new Error(`MESH_AGENT_DECLARED_ADDRESSES has non-IPv4 entries: ${invalid.join(", ")}`);
	const stun =
		parsed.MESH_AGENT_STUN_SERVERS === undefined
			? [...DEFAULT_STUN_SERVERS]
			: parsed.MESH_AGENT_STUN_SERVERS.split(",").map((item) => item.trim()).filter((item) => item !== "");
	return {
		stateDir: parsed.MESH_AGENT_STATE_DIR,
		socketDir: parsed.MESH_AGENT_SOCKET_DIR,
		nodeName: parsed.MESH_AGENT_NODE_NAME ?? hostname(),
		interfaceName: parsed.MESH_AGENT_INTERFACE,
		listenPort: parsed.MESH_AGENT_LISTEN_PORT,
		gossipPort: parsed.MESH_AGENT_GOSSIP_PORT,
		stunServers: stun,
		declaredAddresses: parsed.MESH_AGENT_DECLARED_ADDRESSES,
		tickMs: parsed.MESH_AGENT_TICK_MS,
		dockerSocket: parsed.MESH_AGENT_DOCKER_SOCKET,
		dataplane: parsed.MESH_AGENT_DATAPLANE,
	};
}
