import { Effect } from "effect";

import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";
import {
	platformOverlayNetworkName,
	type DockerEngineShape,
	type DockerError,
} from "@deployer/docker";
import type { SwarmProcessInfo } from "@deployer/supervision";


/** Label every platform service carries; cleanup and inspection tooling keys off it. */
export const PLATFORM_ROLE_LABEL = "deployer.platform.role";

/** Reason a supervisor reports while no swarm exists yet: deferred, not failed. */
export const DEFERRED_UNTIL_SWARM =
	"deferred until an active swarm exists — the cluster entry mode (create vs join) is decided during setup";

/**
 * The swarm plumbing every platform supervisor shares: the overlay a service attaches to, the
 * process-info view of a service, and the bridge between a compose-managed container and the overlay.
 */
export type SwarmServiceOps = {
	/**
	 * Ensures the attachable OVERLAY for a platform bridge network and returns its name. Compose
	 * declares the bridge; the overlay is the swarm-scoped counterpart that swarm services and (via
	 * external wiring) compose-managed containers both attach to, giving one DNS namespace.
	 */
	readonly ensureOverlay: (baseNetworkName: string) => Effect.Effect<string, DockerError>;
	/**
	 * For a MANAGED (compose/operator-owned) service: ensures the overlay exists and attaches
	 * `hostContainerName` to it, bridging the compose network and the swarm. Returns the overlay name,
	 * or `null` when there is no swarm to bridge to: an overlay is a swarm construct, so creating one
	 * on a plain compose stack would fail ("not a swarm manager") and report a healthy stack as degraded.
	 */
	readonly wireExternalToSwarm: (
		baseNetworkName: string,
		hostContainerName: string,
	) => Effect.Effect<string | null, DockerError>;
	/** The desired config and LIVE view of the swarm service a spec describes (the live part all-null when it does not exist). */
	readonly describeProcess: (spec: SwarmServiceSpecInput) => Effect.Effect<SwarmProcessInfo, DockerError>;
	/** The service as the engine has it, with how many of its tasks run; `DockerNotFound` when it does not exist. */
	readonly serviceHealth: (name: string) => Effect.Effect<
		{
			readonly id: string | undefined;
			readonly name: string;
			readonly createdAt: string;
			readonly updatedAt: string;
			readonly runningTasks: number;
			readonly totalTasks: number;
		},
		DockerError
	>;
	/**
	 * Why convergence cannot proceed yet, or null. A swarm-only resource is deferred until a swarm
	 * exists; a deployment-managed one (compose/operator) never is, because it exists independently
	 * of the local engine's swarm state.
	 */
	readonly blockerUntilSwarm: (options: { readonly managed: boolean; readonly swarmOnly?: boolean }) => Effect.Effect<string | null>;
};

/**
 * Attaches `spec` to `overlay`, registering `aliases` on it. Consumers address platform services by a
 * stable alias (`global-db`, `redis`, `traefik`), which is how persisted connection URLs point at them,
 * so the alias is declared on the attachment rather than implied by the service name (a prefixed
 * deployment's service name differs from its alias).
 */
export const attachOverlay = (
	spec: SwarmServiceSpecInput,
	overlay: string,
	aliases: readonly string[] = [],
): SwarmServiceSpecInput => ({ ...spec, networks: [{ target: overlay, aliases: [...aliases] }] });

export function makeSwarmServiceOps(engine: DockerEngineShape): SwarmServiceOps {
	const { swarmServices, swarmCluster, networks } = engine;

	const ensureOverlay: SwarmServiceOps["ensureOverlay"] = (baseNetworkName) => {
		const overlay = platformOverlayNetworkName(baseNetworkName);
		return networks
			.ensureOverlay({
				name: overlay,
				driver: "overlay",
				attachable: true,
				ingress: false,
				enableIpv6: false,
				labels: { "deployer.managed": "true", "deployer.platform": "true" },
			})
			.pipe(Effect.as(overlay));
	};

	const countRunning = (name: string) =>
		swarmServices.listTasks(name).pipe(
			Effect.map((tasks) => ({ running: tasks.filter((task) => task.Status.State === "running").length, total: tasks.length })),
			// Task counts are a convenience: an engine that cannot list them reports none.
			Effect.orElseSucceed(() => ({ running: 0, total: 0 })),
		);

	return {
		ensureOverlay,
		wireExternalToSwarm: (baseNetworkName, hostContainerName) =>
			Effect.gen(function* () {
				if (!(yield* swarmCluster.isActive())) return null;
				const overlay = yield* ensureOverlay(baseNetworkName);
				yield* networks.connectContainer(overlay, hostContainerName);
				return overlay;
			}),
		describeProcess: (spec) =>
			Effect.gen(function* () {
				const empty: SwarmProcessInfo["live"] = {
					serviceId: null,
					exists: false,
					createdAt: null,
					updatedAt: null,
					serviceName: null,
					runningTasks: null,
					totalTasks: null,
				};
				const live = yield* swarmServices.inspect(spec.name).pipe(
					Effect.flatMap((service) =>
						countRunning(spec.name).pipe(
							Effect.map(
								({ running, total }): SwarmProcessInfo["live"] => ({
									serviceId: service.ID ?? null,
									exists: true,
									createdAt: service.CreatedAt,
									updatedAt: service.UpdatedAt,
									serviceName: service.Spec.Name,
									runningTasks: running,
									totalTasks: total,
								}),
							),
						),
					),
					Effect.catchTag("DockerNotFound", () => Effect.succeed(empty)),
				);
				return {
					kind: "swarm" as const,
					runtime: spec.mode === "global" ? ("swarm-global" as const) : ("swarm-replicated" as const),
					desired: {
						name: spec.name,
						image: spec.image,
						command: spec.command,
						labels: spec.labels,
						networkName: spec.networks[0]?.target ?? null,
						mode: spec.mode,
						replicas: spec.replicas,
					},
					live,
				};
			}),
		serviceHealth: (name) =>
			Effect.gen(function* () {
				const service = yield* swarmServices.inspect(name);
				const { running, total } = yield* countRunning(name);
				return {
					id: service.ID,
					name: service.Spec.Name,
					createdAt: service.CreatedAt,
					updatedAt: service.UpdatedAt,
					runningTasks: running,
					totalTasks: total,
				};
			}),
		blockerUntilSwarm: ({ managed, swarmOnly = true }) =>
			managed || !swarmOnly
				? Effect.succeed(null)
				: swarmCluster.isActive().pipe(Effect.map((active) => (active ? null : DEFERRED_UNTIL_SWARM))),
	};
}
