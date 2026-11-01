/**
 * The mesh agent's container — one per node, created by whichever process reaches the node first (setup on a fresh
 * install, the API on an upgraded one).
 *
 * It is a PLAIN container, not a swarm service, on purpose: it must exist before Swarm (Swarm advertises the address it
 * creates), and it must keep running when Swarm or the API is broken. The Docker daemon is its supervisor
 * (`unless-stopped`).
 */

import { hostname, networkInterfaces, type NetworkInterfaceInfo } from "node:os";

import { runPromiseUnwrapped } from "@deployer/effect-core";
import type { CreateContainerOptions, DockerEngineShape } from "@deployer/docker";
import { Effect } from "effect";

/** Container name. One agent per host: it owns the host's `deployer-mesh` interface. */
export const NODE_AGENT_CONTAINER_NAME = "deployer-node-agent";
/** Host path of the Docker socket (the agent converges the node's doors). */
export const NODE_AGENT_DOCKER_SOCKET = "/var/run/docker.sock";
/** Named volume holding the control socket — mounted by setup and the API too. */
export const NODE_AGENT_RUN_VOLUME = "deployer-node-agent-run";
/** Where the run volume is mounted, and where the deployment reaches the node door. */
export const NODE_AGENT_RUN_DIR = "/run/deployer-node";
/** The node door inside the run volume. */
export const NODE_AGENT_SOCKET_PATH = `${NODE_AGENT_RUN_DIR}/agent.sock`;
/**
 * Named volume holding the ADMIN socket: credential, rotate, join, token, block and `node.configure`.
 *
 * Its own volume because that is what scopes the door: a deployment mounts it into the processes that perform operator
 * actions (setup, the API, the fleet ingress) and NOT into every service, so a compromised service container cannot
 * rotate the swarm secret or issue itself a token. The socket is mode 0600, so the file agrees with the mount.
 */
export const NODE_AGENT_ADMIN_VOLUME = "deployer-node-agent-admin";
/** Where the admin volume is mounted in the agent and in the processes allowed to use it. */
export const NODE_AGENT_ADMIN_RUN_DIR = "/run/deployer-node-admin";
/** The admin door inside its volume. */
export const NODE_AGENT_ADMIN_SOCKET_PATH = `${NODE_AGENT_ADMIN_RUN_DIR}/admin.sock`;
/** Label marking the container as the agent the platform manages. */
export const NODE_AGENT_ROLE_LABEL = "deployer.platform.role";
export const NODE_AGENT_ROLE = "node-agent";

/** The agent's named volume: identity, roster and its own settings. */
export const NODE_AGENT_DATA_VOLUME = "deployer-node-agent-data";
/** Where the agent keeps its store inside its container. */
export const NODE_AGENT_DATA_DIR = "/var/lib/deployer/node-agent";
/** The agent's in-container port; peers reach its websocket here. */
export const NODE_AGENT_PORT = 3106;
/** The agent's websocket path, mirrored from `@deployer/node-agent-contracts`. */
const NODE_AGENT_WEBSOCKET_PATH = "/mesh/ws";
/** The agent's WireGuard listener. */
export const NODE_AGENT_WIREGUARD_PORT = 51_820;
/**
 * The only image a node door may run. The deployment pins it (`DEPLOYER_DOOR_IMAGE`), the agent refuses a `node.doors`
 * setting that names another one, and this is the default both sides agree on.
 */
export const DEFAULT_DOOR_IMAGE = "nginx:alpine";

/** `NODE_AGENT_SWARM_MODE` (default false): the swarm runs the agent as a GLOBAL service instead of the host container. */
export const NODE_AGENT_SWARM_MODE_ENV = "NODE_AGENT_SWARM_MODE";

/**
 * Who owns the agent's socket: the prod tier's `USER nestjs`.
 *
 * The socket's permissions ARE the node door's trust boundary, and its consumers are the tier apps, which run as
 * `nestjs` (uid 1001). Root-owned socket + a non-root consumer is a door nothing can open, so the owner is pinned here
 * rather than left to whatever user the agent happens to run as.
 */
export const DEFAULT_SOCKET_UID = 1001;
export const DEFAULT_SOCKET_GID = 1001;

/**
 * Whether this deployment runs the agent as a swarm service. Accepts the parsed boolean (`booleanEnv` in the API's
 * schema) and the raw spellings a compose file produces (setup's schema has its own), so whichever process asks gets
 * the same answer.
 *
 * With it on, NOTHING may create the host container as well: both would bind the run volume's socket and create the
 * `deployer-mesh` interface, and the second one loses the race every restart.
 */
export function isNodeAgentSwarmMode(value: unknown): boolean {
	return value === true || value === "true" || value === "1";
}

export type NodeAgentContainerOptions = {
	image: string;
	/** Where the other agents reach this one. Defaults to this host's primary LAN address on the agent port. */
	advertiseUrl?: string;
	/** Host path of the Docker socket (the agent converges the node's doors). */
	dockerSocket?: string;
	/** Where the agent keeps its store. Defaults to `/var/lib/deployer/node-agent`. */
	dataDir?: string;
	/** Where the agent binds its socket. Defaults to the shared run volume's `agent.sock`. */
	socketPath?: string;
	/** Owner of that socket. Defaults to `1001` (the prod tier's `nestjs`); a deployment may name its own user. */
	socketUid?: number;
	socketGid?: number;
	/** Whether the agent also converges the WireGuard overlay. Defaults to on: the deployment opted in. */
	wireguard?: boolean;
	/** The WireGuard listener port. */
	port?: number;
	/** The one image the agent may run a node door with. Defaults to `DEPLOYER_DOOR_IMAGE`, then `nginx:alpine`. */
	doorImage?: string;
};

/**
 * The agent's environment, from the values this node resolved.
 *
 * Setup and the API must not assemble it twice: whichever of them reaches the node first creates the container, and the
 * container is only replaced when the env differs. `NODE_AGENT_SOCKET` points at the run volume both processes already
 * mount, so the door is reachable from the deployment, not only from the agent.
 *
 * `MESH_ADVERTISE_URL` is resolved HERE, on the HOST: a host-network container still has its own UTS namespace, so
 * `hostname()` inside it is the container id — an address no peer can dial. The LAN address is the one peers reach.
 */
export function nodeAgentContainerEnv(options: {
	advertiseUrl?: string;
	dataDir?: string;
	socketPath?: string;
	/** The admin socket: its own volume, mounted only into the operator-facing processes. */
	adminSocketPath?: string;
	socketUid?: number;
	socketGid?: number;
	wireguard?: boolean;
	port?: number;
	doorImage?: string;
}): string[] {
	return [
		`NODE_AGENT_DATA_DIR=${options.dataDir ?? NODE_AGENT_DATA_DIR}`,
		`NODE_AGENT_SOCKET=${options.socketPath ?? NODE_AGENT_SOCKET_PATH}`,
		`NODE_AGENT_ADMIN_SOCKET=${options.adminSocketPath ?? NODE_AGENT_ADMIN_SOCKET_PATH}`,
		// The socket's owner is the tier's user, not the agent's: a socket only root can open is a door the services
		// cannot reach, and one only the agent can open is the same file with the wrong trust boundary.
		`NODE_AGENT_SOCKET_UID=${String(options.socketUid ?? DEFAULT_SOCKET_UID)}`,
		`NODE_AGENT_SOCKET_GID=${String(options.socketGid ?? DEFAULT_SOCKET_GID)}`,
		`MESH_ADVERTISE_URL=${options.advertiseUrl ?? defaultAdvertiseUrl()}`,
		`MESH_WIREGUARD_ENABLED=${options.wireguard === false ? "false" : "true"}`,
		`MESH_WIREGUARD_PORT=${String(options.port ?? NODE_AGENT_WIREGUARD_PORT)}`,
		// The agent refuses a `node.doors` setting that names any other image, so this is what pins the doors.
		`NODE_AGENT_DOOR_IMAGE=${options.doorImage ?? (process.env.DEPLOYER_DOOR_IMAGE || DEFAULT_DOOR_IMAGE)}`,
	];
}

/** The Docker Engine `POST /containers/create` body for the agent. */
export function nodeAgentContainerSpec(options: NodeAgentContainerOptions): Record<string, unknown> {
	const socket = options.dockerSocket ?? NODE_AGENT_DOCKER_SOCKET;
	const dataDir = options.dataDir ?? NODE_AGENT_DATA_DIR;
	return {
		Image: options.image,
		Env: nodeAgentContainerEnv(options),
		Labels: { [NODE_AGENT_ROLE_LABEL]: NODE_AGENT_ROLE },
		HostConfig: {
			// The mesh interface must be a HOST interface: Swarm advertises it and
			// the private door binds it. A container namespace would hide it from both.
			NetworkMode: "host",
			CapAdd: ["NET_ADMIN"],
			RestartPolicy: { Name: "unless-stopped" },
			Binds: [
				`${NODE_AGENT_DATA_VOLUME}:${dataDir}`,
				`${NODE_AGENT_RUN_VOLUME}:${NODE_AGENT_RUN_DIR}`,
				`${NODE_AGENT_ADMIN_VOLUME}:${NODE_AGENT_ADMIN_RUN_DIR}`,
				`${socket}:${NODE_AGENT_DOCKER_SOCKET}`,
			],
		},
	};
}

/** The few engine calls `ensureNodeAgentContainer` needs; dockerode satisfies them via a thin adapter. */
export type NodeAgentEngine = {
	inspect(name: string): Promise<{ id: string; running: boolean; image: string; managed: boolean; env: readonly string[] } | null>;
	create(name: string, spec: Record<string, unknown>): Promise<string>;
	start(id: string): Promise<void>;
	remove(id: string): Promise<void>;
	imageExists(image: string): Promise<boolean>;
	pull(image: string): Promise<void>;
}

export type EnsureAgentOutcome = "created" | "started" | "replaced" | "running";

/**
 * The Promise face of the Effect docker engine. `ensureNodeAgentContainer` speaks Promises, so this maps the engine's
 * inspect result onto what the agent code reads and holds no logic beyond that.
 */
export function makeNodeAgentEngine(engine: DockerEngineShape): NodeAgentEngine {
	const { containers, images } = engine;
	return {
		inspect: (name) =>
			runPromiseUnwrapped(
				containers.inspect(name).pipe(
					Effect.map((info) => ({
						id: info.Id,
						running: info.State.Running,
						image: info.Config.Image,
						managed: info.Config.Labels?.[NODE_AGENT_ROLE_LABEL] === NODE_AGENT_ROLE,
						env: info.Config.Env ?? [],
					})),
					Effect.catchTag("DockerNotFound", () => Effect.succeed(null)),
				),
			),
		create: (name, spec) =>
			runPromiseUnwrapped(containers.create({ name, ...spec } as CreateContainerOptions).pipe(Effect.map(({ id }) => id))),
		start: (id) => runPromiseUnwrapped(containers.start(id)),
		remove: (id) => runPromiseUnwrapped(containers.removeIfExists(id)),
		imageExists: (image) => runPromiseUnwrapped(images.exists(image)),
		pull: (image) => runPromiseUnwrapped(images.pull(image)),
	};
}

/**
 * Make sure the node runs the agent from `options.image`.
 *
 * Idempotent: a running agent on the right image and env is left alone (the WireGuard interface stays up across a
 * replace anyway — the kernel keeps it). A container squatting the name that the platform does not manage is refused,
 * never removed.
 */
export async function ensureNodeAgentContainer(engine: NodeAgentEngine, options: NodeAgentContainerOptions): Promise<EnsureAgentOutcome> {
	const env = nodeAgentContainerEnv(options);
	return await converge(engine, options.image, env, nodeAgentContainerSpec(options));
}

async function converge(engine: NodeAgentEngine, image: string, env: readonly string[], spec: Record<string, unknown>): Promise<EnsureAgentOutcome> {
	const existing = await engine.inspect(NODE_AGENT_CONTAINER_NAME);
	if (existing !== null && !existing.managed) {
		throw new Error(`a container named ${NODE_AGENT_CONTAINER_NAME} exists and is not the platform's mesh agent`);
	}
	if (existing !== null && matches(existing, image, env)) {
		if (existing.running) return "running";
		await engine.start(existing.id);
		return "started";
	}
	if (!(await engine.imageExists(image))) await engine.pull(image);
	if (existing !== null) await engine.remove(existing.id);
	const id = await engine.create(NODE_AGENT_CONTAINER_NAME, spec);
	await engine.start(id);
	return existing === null ? "created" : "replaced";
}

/**
 * Whether a running container already matches what we would create.
 *
 * ENV COUNTS, not just the image: `MESH_WIREGUARD_ENABLED` decides whether the agent creates the kernel interface at
 * all, so an operator who flips it must get a container that actually reflects it. Comparing the image alone would leave
 * the old process running with the old setting — a change that silently does nothing, which is worse than one that fails.
 */
function matches(existing: { image: string; env: readonly string[] }, image: string, env: readonly string[]): boolean {
	if (existing.image !== image) return false;
	if (existing.env.length !== env.length) return false;
	return env.every((entry) => existing.env.includes(entry));
}

/** Interfaces that never carry a peer's traffic: loopback, Docker bridges and veths, and the overlay itself. */
const IGNORED_INTERFACE = /^(lo|docker\d*|docker_gwbridge|br-|veth|virbr|vxlan|flannel|cni|cali|tun|tap|wg|deployer-mesh)/;

/**
 * The LAN address peers dial, sorted so the choice is stable across boots.
 */
export function primaryLanAddress(interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string | null {
	const found: string[] = [];
	for (const [name, infos] of Object.entries(interfaces)) {
		if (IGNORED_INTERFACE.test(name)) continue;
		for (const info of infos ?? []) {
			if (info.family !== "IPv4" || info.internal || info.address.startsWith("169.254.")) continue;
			found.push(info.address);
		}
	}
	return found.sort((left, right) => left.localeCompare(right))[0] ?? null;
}

/** The address peers reach this agent at: its host's LAN IP, or its host name. Never the container id. */
function defaultAdvertiseUrl(): string {
	return `ws://${primaryLanAddress() ?? hostname()}:${String(NODE_AGENT_PORT)}${NODE_AGENT_WEBSOCKET_PATH}`;
}
