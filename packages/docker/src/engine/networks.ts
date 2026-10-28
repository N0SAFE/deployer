import type Docker from "dockerode";
import type { SwarmOverlayNetworkRequest } from "@deployer/contracts-entities";
import { Effect } from "effect";

import { DockerConflict, type DockerError } from "../errors";
import { engineCall } from "./call";

const VXLAN_ID_OPTION = "com.docker.network.driver.overlay.vxlanid_list";

export type NetworksShape = {
	/**
	 * Makes sure an overlay network named `request.name` exists: created once, reused by name, and
	 * tolerant of another node creating it at the same moment.
	 *
	 * Only for networks Deployer owns (per-project overlays). A same-named network that is not an
	 * overlay, such as a Compose-created bridge, is a `DockerConflict`: swarm rejects bridge networks
	 * on services, and reusing one would break scheduling in a confusing way.
	 */
	readonly ensureOverlay: (request: SwarmOverlayNetworkRequest) => Effect.Effect<void, DockerError>;
};

const notOverlay = (name: string, driver: string, concurrently: boolean) =>
	new DockerConflict({
		reason: concurrently
			? `Network "${name}" was concurrently created with driver "${driver}" — refusing to use a non-overlay network for a swarm workload.`
			: `Network "${name}" already exists with driver "${driver}" — refusing to use a non-overlay network for a swarm workload. ` +
				"The network is likely owned by Compose/supervisor, not Deployer workloads.",
	});

export function makeNetworks(client: Docker): NetworksShape {
	const inspectDriver = (name: string) =>
		engineCall(
			`inspect network ${name}`,
			async () => (await client.getNetwork(name).inspect()).Driver.toLowerCase(),
			`network '${name}'`,
		);

	const ensureOverlay: NetworksShape["ensureOverlay"] = Effect.fn("DockerNetworks.ensureOverlay")(function* (request) {
		const existing = yield* inspectDriver(request.name).pipe(
			Effect.map((driver) => ({ found: true as const, driver })),
			Effect.catchTag("DockerNotFound", () => Effect.succeed({ found: false as const })),
		);
		if (existing.found) {
			if (existing.driver && existing.driver !== "overlay") {
				return yield* Effect.fail(notOverlay(request.name, existing.driver, false));
			}
			return;
		}

		yield* engineCall(`create overlay network ${request.name}`, () =>
			client.createNetwork({
				Name: request.name,
				Driver: request.driver,
				Attachable: request.attachable,
				Ingress: request.ingress,
				EnableIPv6: request.enableIpv6,
				Labels: request.labels,
				...(request.vxlanId === undefined ? {} : { Options: { [VXLAN_ID_OPTION]: String(request.vxlanId) } }),
			}),
		).pipe(
			// Another node may have created it first: accept it when it now exists as an overlay.
			Effect.catch((createFailure) =>
				inspectDriver(request.name).pipe(
					Effect.mapError(() => createFailure),
					Effect.flatMap((driver) =>
						driver && driver !== "overlay" ? Effect.fail(notOverlay(request.name, driver, true)) : Effect.void,
					),
				),
			),
		);
		yield* Effect.logInfo(`Ensured overlay network ${request.name}`);
	});

	return { ensureOverlay };
}
