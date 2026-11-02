import { Context, Effect } from "effect";

import { dockerNetworkSchema, type DockerNetwork } from "@deployer/contracts-entities";
import type { DockerError, DockerEngineShape } from "@deployer/docker";
import { DockerEngine } from "@deployer/docker";

const NETWORK_DRIVERS: readonly DockerNetwork["driver"][] = ["bridge", "overlay", "host", "macvlan", "ipvlan", "custom"];
const NETWORK_SCOPES: readonly DockerNetwork["scope"][] = ["local", "swarm", "global"];

/** The engine's own drivers keep their name; anything else is a `custom` driver. */
export const normalizeNetworkDriver = (driver: string | undefined): DockerNetwork["driver"] => {
	const normalized = (driver ?? "custom").toLowerCase();
	return NETWORK_DRIVERS.includes(normalized as DockerNetwork["driver"]) ? (normalized as DockerNetwork["driver"]) : "custom";
};

export const normalizeNetworkScope = (scope: string | undefined): DockerNetwork["scope"] => {
	const normalized = (scope ?? "global").toLowerCase();
	return NETWORK_SCOPES.includes(normalized as DockerNetwork["scope"]) ? (normalized as DockerNetwork["scope"]) : "global";
};

export type DockerNetworksRepositoryShape = {
	/** Every network the engine reports, as the runtime's network entity. */
	readonly list: Effect.Effect<DockerNetwork[], DockerError, DockerEngine>;
};

/** The networks of the local engine. */
export class DockerNetworksRepository extends Context.Service<DockerNetworksRepository, DockerNetworksRepositoryShape>()(
	"runtime/DockerNetworksRepository",
) {
	/** The engine is yielded when `list` runs, so this is a constant a Nest module provides with `useValue`. */
	static readonly live = class DockerNetworksRepositoryImpl implements DockerNetworksRepositoryShape {
		list = Effect.gen(function* () {
			const engine = yield* DockerEngine;
			return yield* listDockerNetworks(engine);
		})
	};
}

const listDockerNetworks = (engine: DockerEngineShape): Effect.Effect<DockerNetwork[], DockerError> =>
	Effect.suspend(() => engine.networks.list()).pipe(
			Effect.map((networks) =>
				networks.map((network) => {
					const ipam = (network.IPAM?.Config ?? [])[0] ?? {};
					return dockerNetworkSchema.parse({
						id: String(network.Id ?? ""),
						name: String(network.Name ?? "unknown-network"),
						driver: normalizeNetworkDriver(String(network.Driver ?? "custom")),
						scope: normalizeNetworkScope(String(network.Scope ?? "global")),
						internal: Boolean(network.Internal),
						attachable: network.Attachable == null ? true : Boolean(network.Attachable),
						subnet: typeof ipam.Subnet === "string" ? ipam.Subnet : null,
						gateway: typeof ipam.Gateway === "string" ? ipam.Gateway : null,
						containerIds: Object.keys(network.Containers ?? {}),
						labels: network.Labels ?? {},
						createdAt: typeof network.Created === "string" ? new Date(network.Created).toISOString() : new Date().toISOString(),
						updatedAt: new Date().toISOString(),
					});
				}),
			),
		);
