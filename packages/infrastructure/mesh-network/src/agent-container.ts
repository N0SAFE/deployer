/**
 * The mesh agent's container — one per node, created by whichever process reaches
 * the node first (setup on a fresh install, the API on an upgraded one).
 *
 * It is a PLAIN container, not a swarm service, on purpose: it must exist before
 * Swarm does (Swarm advertises the address it creates), and it must keep running
 * when Swarm or the API is broken (it is what the operator's rescue path rides
 * on). The Docker daemon is its supervisor (`unless-stopped`).
 */

/** Container name. One agent per host: it owns the host's `deployer-mesh` interface. */
export const AGENT_CONTAINER_NAME = "deployer-mesh-agent";
/** Named volume holding the identity (private keys) and the roster. */
export const AGENT_STATE_VOLUME = "deployer-mesh-state";
/** Named volume holding the control socket — mounted by setup and the API too. */
export const AGENT_RUN_VOLUME = "deployer-mesh-run";
/** Label marking the container as the agent the platform manages. */
export const AGENT_ROLE_LABEL = "deployer.platform.role";
export const AGENT_ROLE = "mesh-agent";

export type MeshAgentContainerOptions = {
	image: string;
	/** Host path of the Docker socket (the agent converges the node's doors). */
	dockerSocket?: string;
	/** Extra `KEY=value` environment (e.g. declared addresses for a `direct` node). */
	env?: readonly string[];
}

/**
 * The agent's environment, from the values this node resolved.
 *
 * One builder so setup and the API cannot pass different env to the same
 * container: whichever of them reaches the node first creates it, and the container
 * is only replaced when `matches` sees a difference. Two callers assembling the
 * list by hand would make the agent's configuration depend on which process won
 * the race.
 *
 * `MESH_AGENT_DATAPLANE` is always sent, even when it equals the agent's own
 * default, so an operator can read the effective value off the container instead of
 * inferring it from the absence of a variable.
 */
export function meshAgentContainerEnv(options: {
	dataplane: "kernel" | "observe";
	declaredAddresses?: readonly string[];
	stunServers?: readonly string[];
}): string[] {
	const env = [`MESH_AGENT_DATAPLANE=${options.dataplane}`];
	if (options.declaredAddresses !== undefined && options.declaredAddresses.length > 0) {
		env.push(`MESH_AGENT_DECLARED_ADDRESSES=${options.declaredAddresses.join(",")}`);
	}
	if (options.stunServers !== undefined && options.stunServers.length > 0) {
		env.push(`MESH_AGENT_STUN_SERVERS=${options.stunServers.join(",")}`);
	}
	return env;
}

/** The Docker Engine `POST /containers/create` body for the agent. */
export function meshAgentContainerSpec(options: MeshAgentContainerOptions): Record<string, unknown> {
	const socket = options.dockerSocket ?? "/var/run/docker.sock";
	return {
		Image: options.image,
		Env: [...(options.env ?? [])],
		Labels: { [AGENT_ROLE_LABEL]: AGENT_ROLE },
		HostConfig: {
			// The mesh interface must be a HOST interface: Swarm advertises it and
			// the private door binds it. A container namespace would hide it from both.
			NetworkMode: "host",
			CapAdd: ["NET_ADMIN"],
			RestartPolicy: { Name: "unless-stopped" },
			Binds: [`${AGENT_STATE_VOLUME}:/var/lib/deployer-mesh`, `${AGENT_RUN_VOLUME}:/run/deployer-mesh`, `${socket}:/var/run/docker.sock`],
		},
	};
}

/** The few engine calls `ensureMeshAgentContainer` needs; dockerode satisfies them via a thin adapter. */
export type MeshAgentEngine = {
	inspect(name: string): Promise<{ id: string; running: boolean; image: string; managed: boolean; env: readonly string[] } | null>;
	create(name: string, spec: Record<string, unknown>): Promise<string>;
	start(id: string): Promise<void>;
	remove(id: string): Promise<void>;
	imageExists(image: string): Promise<boolean>;
	pull(image: string): Promise<void>;
}

export type EnsureAgentOutcome = "created" | "started" | "replaced" | "running";

/**
 * Whether a running container already matches what we would create.
 *
 * ENV COUNTS, not just the image: `MESH_AGENT_DATAPLANE` decides whether the agent
 * creates the kernel interface at all, so an operator who flips it between `kernel`
 * and `observe` must get a container that actually reflects it. Comparing the image
 * alone would leave the old process running with the old setting — a change that
 * silently does nothing, which is worse than one that fails.
 */
function matches(existing: { image: string; env: readonly string[] }, options: MeshAgentContainerOptions): boolean {
	if (existing.image !== options.image) return false;
	const wanted = [...(options.env ?? [])];
	if (existing.env.length !== wanted.length) return false;
	return wanted.every((entry) => existing.env.includes(entry));
}

/**
 * Make sure the node runs the agent from `options.image`.
 *
 * Idempotent: a running agent on the right image is left alone (the WireGuard
 * interface stays up across a replace anyway — the kernel keeps it). A container
 * squatting the name that the platform does not manage is refused, never removed.
 */
export async function ensureMeshAgentContainer(engine: MeshAgentEngine, options: MeshAgentContainerOptions): Promise<EnsureAgentOutcome> {
	const existing = await engine.inspect(AGENT_CONTAINER_NAME);
	if (existing !== null && !existing.managed) {
		throw new Error(`a container named ${AGENT_CONTAINER_NAME} exists and is not the platform's mesh agent`);
	}
	if (existing !== null && matches(existing, options)) {
		if (existing.running) return "running";
		await engine.start(existing.id);
		return "started";
	}
	if (!(await engine.imageExists(options.image))) await engine.pull(options.image);
	if (existing !== null) await engine.remove(existing.id);
	const id = await engine.create(AGENT_CONTAINER_NAME, meshAgentContainerSpec(options));
	await engine.start(id);
	return existing === null ? "created" : "replaced";
}

/** The slice of dockerode the adapter uses — structural, so this package needs no dockerode dependency. */
export type DockerodeLike = {
	getContainer(name: string): {
		inspect(): Promise<{
			Id: string;
			State: { Running: boolean };
			Config: { Image: string; Labels: Record<string, string> | null; Env: string[] | null };
		}>;
		start(): Promise<unknown>;
		remove(options: { force: boolean }): Promise<unknown>;
	};
	createContainer(options: Record<string, unknown>): Promise<{ id: string }>;
	getImage(name: string): { inspect(): Promise<unknown> };
	pull(image: string): Promise<NodeJS.ReadableStream>;
	modem: { followProgress(stream: NodeJS.ReadableStream, onFinished: (error: Error | null) => void): void };
};

function isNotFound(error: unknown): boolean {
	return typeof error === "object" && error !== null && (error as { statusCode?: number }).statusCode === 404;
}

/** Adapt a dockerode client to `MeshAgentEngine`. */
export function dockerodeAgentEngine(docker: DockerodeLike): MeshAgentEngine {
	return {
		async inspect(name) {
			try {
				const info = await docker.getContainer(name).inspect();
				return {
					id: info.Id,
					running: info.State.Running,
					image: info.Config.Image,
					managed: info.Config.Labels?.[AGENT_ROLE_LABEL] === AGENT_ROLE,
					env: info.Config.Env ?? [],
				};
			} catch (error) {
				if (isNotFound(error)) return null;
				throw error;
			}
		},
		async create(name, spec) {
			return (await docker.createContainer({ name, ...spec })).id;
		},
		async start(id) {
			await docker.getContainer(id).start();
		},
		async remove(id) {
			await docker.getContainer(id).remove({ force: true });
		},
		async imageExists(image) {
			try {
				await docker.getImage(image).inspect();
				return true;
			} catch (error) {
				if (isNotFound(error)) return false;
				throw error;
			}
		},
		async pull(image) {
			const stream = await docker.pull(image);
			await new Promise<void>((resolve, reject) => {
				docker.modem.followProgress(stream, (error) => {
					if (error === null) resolve();
					else reject(error);
				});
			});
		},
	};
}
