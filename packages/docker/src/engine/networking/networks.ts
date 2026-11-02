import { Effect } from "effect";
import z from "zod/v4";

import {
	dockerodeNetworkSummarySchema,
	type DockerodeNetworkSummary,
	type SwarmOverlayNetworkRequest,
} from "@deployer/contracts-entities";
import { fromAbortable } from "@deployer/effect-core";

import { isNotFound } from "../../errors/classify";
import { DockerConflict, DockerUnavailable, type DockerError } from "../../errors/errors";
import { engineCall } from "../call";

import type { SwarmServicesShape } from "../swarm/swarm-services";
import type Docker from "dockerode";

const VXLAN_ID_OPTION = "com.docker.network.driver.overlay.vxlanid_list";

export type RecreateOverlayOptions = {
	/** Containers to force-disconnect before the network is removed. */
	readonly detachContainerIds?: string[];
	/** VXLAN ids the caller already knows are poisoned. */
	readonly avoidVxlanIds?: number[];
};

export type RecreateOverlayResult = {
	readonly vxlanId: number;
	readonly avoidedVxlanIds: number[];
	readonly removedServices: string[];
};

export type NetworksShape = {
	/** Attaches a container to a network, best effort: a container that is already attached or gone is left alone. */
	readonly connectContainer: (networkName: string, containerIdOrName: string) => Effect.Effect<void>;
	/**
	 * Attaches a container to a network under `aliases`. `DockerConflict` means the endpoint already
	 * exists (the engine answers 403), `DockerNotFound` that the container or network is gone.
	 */
	readonly attachContainer: (
		networkName: string,
		containerIdOrName: string,
		aliases?: readonly string[],
	) => Effect.Effect<void, DockerError>;
	/** Force-detaches a container from a network, best effort: not being attached is not a failure. */
	readonly detachContainer: (networkName: string, containerIdOrName: string) => Effect.Effect<void>;
	/** Networks on this engine, including swarm overlays when it is a manager. */
	readonly list: () => Effect.Effect<DockerodeNetworkSummary[], DockerError>;
	/**
	 * Repairs an overlay whose VXLAN id is poisoned: removes the services attached to it, drops the
	 * network, and creates it again on an unused, different id. Any other endpoint still holding the
	 * network makes the removal fail with the engine's own message rather than being evicted.
	 */
	readonly recreateOverlay: (
		request: SwarmOverlayNetworkRequest,
		options?: RecreateOverlayOptions,
	) => Effect.Effect<RecreateOverlayResult, DockerError>;
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

const vxlanIdsOf = (options: Record<string, string> | undefined): number[] => {
	const raw = options?.[VXLAN_ID_OPTION];
	if (raw === undefined) return [];
	return raw.split(",").map(Number).filter((n) => Number.isInteger(n));
};

export function makeNetworks(client: Docker, swarmServices: SwarmServicesShape): NetworksShape {
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

	const list: NetworksShape["list"] = Effect.fn("DockerNetworks.list")(function* () {
		return yield* engineCall("list engine networks", async () =>
			z.array(dockerodeNetworkSummarySchema).parse(await client.listNetworks()),
		);
	});

	/** Service removal is asynchronous: the engine releases the network once the last task is gone. */
	const removeWhenReleased = (name: string, budgetMs = 60_000) =>
		Effect.gen(function* () {
			const deadline = Date.now() + budgetMs;
			for (;;) {
				const outcome = yield* fromAbortable(async (signal) => {
					await client.getNetwork(name).remove({ abortSignal: signal });
				}, (cause) => cause).pipe(
					Effect.map(() => null),
					Effect.catch((cause) => Effect.succeed({ cause })),
				);
				if (outcome === null || isNotFound(outcome.cause)) return;
				if (Date.now() >= deadline) {
					return yield* Effect.fail(
						new DockerUnavailable({ reason: `Failed to remove network ${name}: still in use after ${String(budgetMs)}ms`, cause: outcome.cause }),
					);
				}
				yield* Effect.sleep(2_000);
			}
		});

	const recreateOverlay: NetworksShape["recreateOverlay"] = Effect.fn("DockerNetworks.recreateOverlay")(function* (
		request,
		options = {},
	) {
		const poisoned = new Set(options.avoidVxlanIds ?? []);
		const network = client.getNetwork(request.name);
		const existing = yield* engineCall(`inspect network ${request.name}`, () => network.inspect(), `network '${request.name}'`).pipe(
			Effect.map((info) => ({ id: info.Id, options: info.Options })),
			Effect.catchTag("DockerNotFound", () => Effect.succeed(null)),
		);

		const removedServices: string[] = [];
		if (existing !== null) {
			for (const id of vxlanIdsOf(existing.options)) poisoned.add(id);
			for (const service of yield* swarmServices.list()) {
				const attached = service.Spec.TaskTemplate?.Networks?.some(
					(n) => n.Target === existing.id || n.Target === request.name,
				);
				if (attached === true) {
					yield* swarmServices.remove(service.Spec.Name);
					removedServices.push(service.Spec.Name);
				}
			}
			for (const containerId of options.detachContainerIds ?? []) {
				yield* fromAbortable(async (signal) => {
					await network.disconnect({ Container: containerId, Force: true, abortSignal: signal });
				}, (cause) => cause).pipe(
					Effect.ignore,
				);
			}
			yield* removeWhenReleased(request.name);
		}

		const used = new Set<number>();
		for (const net of yield* engineCall("list networks", () => client.listNetworks())) {
			for (const id of vxlanIdsOf(net.Options)) used.add(id);
		}
		let vxlanId = Math.max(4096, ...poisoned) + 1;
		while (used.has(vxlanId) || poisoned.has(vxlanId)) vxlanId += 1;

		yield* ensureOverlay({ ...request, vxlanId });
		yield* Effect.logWarning(
			`Recreated overlay ${request.name} on VXLAN id ${String(vxlanId)} ` +
				`(avoiding ${[...poisoned].join(", ") || "none"}); removed services: ${removedServices.join(", ") || "none"}`,
		);
		return { vxlanId, avoidedVxlanIds: [...poisoned], removedServices };
	});

	const connectContainer: NetworksShape["connectContainer"] = (networkName, containerIdOrName) =>
		fromAbortable(
			async (signal) => {
				const options = { Container: containerIdOrName, abortSignal: signal };
				await client.getNetwork(networkName).connect(options);
			},
			(cause) => cause,
		).pipe(Effect.ignore);

	const attachContainer: NetworksShape["attachContainer"] = (networkName, containerIdOrName, aliases) =>
		engineCall(
			`attach container ${containerIdOrName} to network ${networkName}`,
			async (signal) => {
				await client.getNetwork(networkName).connect({
					Container: containerIdOrName,
					...(aliases === undefined ? {} : { EndpointConfig: { Aliases: [...aliases] } }),
					abortSignal: signal,
				} as Parameters<Docker.Network["connect"]>[0]);
			},
			`container '${containerIdOrName}' or network '${networkName}'`,
		).pipe(
			Effect.catchTag("DockerUnavailable", (error): Effect.Effect<never, DockerError> => {
				const status = (error.cause as { statusCode?: unknown } | undefined)?.statusCode;
				return status === 403 || status === 409 || /already (exists|connected|attached)/i.test(error.reason)
					? Effect.fail(new DockerConflict({ reason: error.reason }))
					: Effect.fail(error);
			}),
			Effect.asVoid,
		);

	const detachContainer: NetworksShape["detachContainer"] = (networkName, containerIdOrName) =>
		fromAbortable(
			async (signal) => {
				await client.getNetwork(networkName).disconnect({
					Container: containerIdOrName,
					Force: true,
					abortSignal: signal,
				} as Parameters<Docker.Network["disconnect"]>[0]);
			},
			(cause) => cause,
		).pipe(Effect.ignore);

	return { ensureOverlay, list, recreateOverlay, connectContainer, attachContainer, detachContainer };
}
