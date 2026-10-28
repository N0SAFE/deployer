/**
 * Keeps the platform's OWN app containers attached to the Swarm OVERLAY while the engine is
 * swarm-active.
 *
 * WHY this exists
 * ---------------
 * The platform runs a MIXED topology in dev/compose deployments: platform services (ingress, Redis,
 * the managed database) become Swarm SERVICES on the attachable overlay, while the API/web/doc
 * containers stay plain CONTAINERS on the compose BRIDGE for fast iteration. Docker networks are
 * isolated, so without this wiring the swarm ingress has no route to `web-dev` and the API cannot
 * reach the swarm-scheduled database/Redis. Attaching the app containers to the overlay makes them
 * the BRIDGE HEAD between both planes.
 *
 * ADDRESSING
 * ----------
 * The ingress routes to a container by its network ALIAS (`web-dev:3000`), but the ENGINE addresses
 * containers by name/id. So each configured target (`DEPLOYER_WEB_TARGET`, ...) is resolved from the
 * platform network's container list by NAME or ALIAS, and attached to the overlay carrying its
 * aliases, so the ingress keeps resolving `web-dev` on the overlay too.
 *
 * WHY A SUPERVISOR
 * ----------------
 * Container start order is not ours to assume, and a `docker compose restart web-dev` would silently
 * lose the overlay again. So this converges on the normal supervisor cadence, reacts to the daemon's
 * container `start` events (a container that appears or restarts later is wired at once), and
 * re-converges every `RECONCILE_INTERVAL_MS` as a safety net: the event path optimizes, the cadence
 * guarantees.
 *
 * Best-effort by design: with no active swarm (pre-setup, or a node that has not converged yet) it
 * does nothing; the platform runs on plain containers.
 */
import { Effect, Stream } from "effect";
import z from "zod/v4";

import type { DockerEngineShape, DockerError } from "@deployer/docker";
import type { ProbeResult, SupervisorSpec } from "@deployer/supervision";

import {
	SWARM_APP_WIRING_SUPERVISOR_ID,
	swarmAppWiringPayloadSchema,
	swarmAppWiringProcessInfoSchema,
	type SwarmAppWiringPayload,
	type SwarmAppWiringTarget,
} from "./schemas";

/** Re-converge cadence; the Docker event stream is the fast path, this is the guarantee. */
export const RECONCILE_INTERVAL_MS = 30_000;
/** Wait before re-opening a dropped event stream. */
export const EVENT_RECONNECT_MS = 5_000;

export type SwarmAppWiringConfig = {
	/** The attachable overlay every platform process shares. */
	readonly overlay: () => string;
	/** The compose/operator bridge the app containers live on by default. */
	readonly platformNetwork: () => string;
	/** The container identifiers (names or aliases) from the environment. */
	readonly declaredTargets: () => readonly string[];
	/** This process's container id when it runs in a container (`HOSTNAME`). */
	readonly selfHostname: () => string | undefined;
};

export type SwarmAppWiringLogger = {
	readonly log: (message: string) => void;
	readonly debug: (message: string) => void;
	readonly warn: (message: string) => void;
};

export type SwarmAppWiringDeps = {
	readonly engine: DockerEngineShape;
	readonly config: SwarmAppWiringConfig;
	readonly logger: SwarmAppWiringLogger;
};

export type SwarmAppWiring = {
	/** The supervisor: how to converge, probe and describe the wiring. */
	readonly spec: SupervisorSpec<typeof swarmAppWiringPayloadSchema, typeof swarmAppWiringProcessInfoSchema>;
	/**
	 * Everything that keeps the wiring converged between explicit passes: the start-event
	 * subscription (reconnecting) and the safety-net cadence. Runs until interrupted, calling
	 * `ensureDesiredState` (the supervisor's own pass, which records the state it ends in).
	 */
	readonly background: (ensureDesiredState: Effect.Effect<unknown>) => Effect.Effect<void>;
};

/** Minimal shape of the Docker daemon events we consume. */
const dockerEventSchema = z.object({
	Actor: z.object({ Attributes: z.record(z.string(), z.string()).optional() }).optional(),
});

/** A resolved container that must be reachable from swarm services. */
type ResolvedTarget = {
	/** Container id: the stable handle for `network.connect`. */
	readonly id: string;
	/** Canonical container name (`/name` stripped). */
	readonly name: string;
	/** Every alias declared on the platform network (name included). */
	readonly aliases: readonly string[];
};

/** The container inspect fields this supervisor consumes. */
type ContainerDetail = {
	readonly name: string;
	readonly networkAliases: Readonly<Record<string, readonly string[]>>;
};

const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));

export function makeSwarmAppWiring({ engine, config, logger }: SwarmAppWiringDeps): SwarmAppWiring {
	const { containers, networks, swarmCluster } = engine;

	/** Name + per-network aliases of a container; null when it does not exist. */
	const inspectContainer = (idOrName: string): Effect.Effect<ContainerDetail | null, DockerError> =>
		containers.inspect(idOrName).pipe(
			Effect.map((info): ContainerDetail | null => {
				const name = info.Name.replace(/^\//, "");
				const networkAliases: Record<string, readonly string[]> = {};
				for (const [network, endpoint] of Object.entries(info.NetworkSettings.Networks)) {
					networkAliases[network] = Array.isArray(endpoint.Aliases) ? endpoint.Aliases : [];
				}
				return { name: name === "" ? idOrName : name, networkAliases };
			}),
			Effect.catchTag("DockerNotFound", () => Effect.succeed(null)),
		);

	/** This API container's canonical name (HOSTNAME is the container id). */
	const resolveSelfContainerName: Effect.Effect<string | null, DockerError> = Effect.suspend(() => {
		const selfId = config.selfHostname();
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return Effect.succeed(null);
		return inspectContainer(selfId).pipe(Effect.map((detail) => detail?.name ?? null));
	});

	/**
	 * The app containers that must be reachable from swarm services: the RUNNING containers on the
	 * platform network whose name or alias is a declared target, plus this API container itself (it
	 * hosts the platform and must reach the swarm-scheduled DB/Redis).
	 */
	const resolveTargets: Effect.Effect<readonly ResolvedTarget[], DockerError> = Effect.gen(function* () {
		const selfName = yield* resolveSelfContainerName;
		const declared = config.declaredTargets();
		const wanted = selfName === null ? declared : [...declared, selfName];
		const network = config.platformNetwork();

		// Filtered server-side: a stopped container cannot serve traffic and re-attaching it would only
		// add noise (its aliases would compete with the live one).
		const listed = yield* containers.list({ all: false, filters: { network: [network] } }).pipe(
			Effect.catch((error) =>
				Effect.sync(() => {
					logger.debug(`Could not list containers on ${network}: ${errorText(error)}`);
					return null;
				}),
			),
		);
		if (listed === null) return [];

		const resolved: ResolvedTarget[] = [];
		for (const container of listed) {
			const id = container.Id;
			if (typeof id !== "string" || id === "") continue;
			const detail = yield* inspectContainer(id);
			if (detail === null) continue;

			const aliases = detail.networkAliases[network] ?? [];
			if (!wanted.some((value) => value === detail.name || aliases.includes(value))) continue;

			// The container's OWN name is always carried over, so swarm services (and the ingress) can
			// address it exactly as compose does.
			resolved.push({ id, name: detail.name, aliases: [...new Set([detail.name, ...aliases])] });
		}
		return resolved;
	});

	/** Wiring status of every resolved target (read-only). */
	const describeTargets = (overlay: string): Effect.Effect<SwarmAppWiringTarget[], DockerError> =>
		Effect.gen(function* () {
			const described: SwarmAppWiringTarget[] = [];
			for (const target of yield* resolveTargets) {
				const detail = yield* inspectContainer(target.id);
				if (detail === null) continue;
				described.push({
					name: target.name,
					aliases: [...target.aliases],
					attached: Object.hasOwn(detail.networkAliases, overlay),
				});
			}
			return described;
		});

	/**
	 * Ensures one container is on the overlay WITH its aliases. Reports whether this call CHANGED the
	 * wiring ("wired"), found it already complete ("attached"), or found the container gone ("absent",
	 * not an error: the start event re-converges when it comes back). The distinction is for
	 * logging: reporting "wired" on every pass made an idempotent cadence look like repeated work.
	 */
	const ensureAttached = (
		overlay: string,
		target: ResolvedTarget,
	): Effect.Effect<"attached" | "wired" | "absent", DockerError> =>
		Effect.gen(function* () {
			const detail = yield* inspectContainer(target.id);
			if (detail === null) return "absent" as const;

			const current = detail.networkAliases[overlay];
			if (current !== undefined && target.aliases.every((alias) => current.includes(alias))) return "attached" as const;

			// An endpoint already on the overlay with STALE aliases must be reconnected: Docker cannot
			// update an endpoint in place.
			if (current !== undefined) yield* networks.detachContainer(overlay, target.id);
			yield* networks.attachContainer(overlay, target.id, target.aliases);
			return "wired" as const;
		}).pipe(
			// A conflict proves the endpoint is attached with the aliases we asked for.
			Effect.catchTag("DockerConflict", () => Effect.succeed("attached" as const)),
			Effect.catchTag("DockerNotFound", () => Effect.succeed("absent" as const)),
		);

	/**
	 * Idempotent convergence: ensure the overlay exists and every app container that EXISTS is attached
	 * to it. A configured target that has not started yet is not an error.
	 */
	const converge: Effect.Effect<void, DockerError> = Effect.gen(function* () {
		// Containers-only phase (pre-setup, or a node that has not converged): there is no overlay to
		// join, and the ingress runs as a container.
		if (!(yield* swarmCluster.isActive())) return;

		const overlay = config.overlay();
		yield* networks.ensureOverlay({
			name: overlay,
			driver: "overlay",
			attachable: true,
			ingress: false,
			enableIpv6: false,
			labels: { "deployer.platform": "true", "deployer.managed": "true" },
		});

		const wired: string[] = [];
		for (const target of yield* resolveTargets) {
			// Only a CHANGE is worth a log line: this runs on a 30s cadence.
			if ((yield* ensureAttached(overlay, target)) === "wired") wired.push(target.name);
		}
		if (wired.length > 0) {
			logger.log(
				`Wired app container(s) onto ${overlay}: ${wired.join(", ")} — the bridge head between the compose network and the swarm overlay`,
			);
		}
	});

	const payload = (startedAt: number, swarmActive: boolean, targets: SwarmAppWiringTarget[]): SwarmAppWiringPayload => ({
		checkedAt: new Date().toISOString(),
		latencyMs: Date.now() - startedAt,
		swarmActive,
		overlay: config.overlay(),
		targets,
	});

	/** Read-only wiring status (never mutates networks). */
	const probe: Effect.Effect<ProbeResult<SwarmAppWiringPayload>, DockerError> = Effect.gen(function* () {
		const startedAt = Date.now();
		const overlay = config.overlay();

		if (!(yield* swarmCluster.isActive())) {
			return {
				healthy: true,
				detail: "swarm is not active — app containers stay on the compose network (container ingress)",
				payload: payload(startedAt, false, []),
			};
		}

		const targets = yield* describeTargets(overlay);
		const missing = targets.filter((target) => !target.attached);
		const detail =
			missing.length > 0
				? `not wired to ${overlay}: ${missing.map((target) => target.name).join(", ")}`
				: targets.length === 0
					? "no app container running yet"
					: `${String(targets.length)} app container(s) wired to ${overlay}`;
		return { healthy: missing.length === 0, detail, payload: payload(startedAt, true, targets) };
	});

	const spec: SwarmAppWiring["spec"] = {
		id: SWARM_APP_WIRING_SUPERVISOR_ID,
		description:
			"Joins the app containers (API/web) to the Swarm overlay so the swarm ingress reaches them and they reach swarm-scheduled services",
		payloadSchema: swarmAppWiringPayloadSchema,
		processInfoSchema: swarmAppWiringProcessInfoSchema,
		converge,
		probe,
		degradedPayload: () => payload(Date.now(), false, []),
		processInfo: Effect.suspend(() => {
			const overlay = config.overlay();
			return describeTargets(overlay).pipe(Effect.map((targets) => ({ overlay, targets })));
		}),
	};

	const background: SwarmAppWiring["background"] = (ensureDesiredState) => {
		/** Re-converge when a container we care about starts, through the normal convergence path. */
		const rewireIfTarget = (containerName: string) =>
			resolveTargets.pipe(
				Effect.catch(() => Effect.succeed([] as readonly ResolvedTarget[])),
				Effect.flatMap((targets) =>
					targets.some((target) => target.name === containerName || target.aliases.includes(containerName))
						? ensureDesiredState
						: Effect.void,
				),
			);

		const handleStart = (event: unknown) => {
			const parsed = dockerEventSchema.safeParse(event);
			const name = parsed.success ? parsed.data.Actor?.Attributes?.name : undefined;
			return name === undefined || name === "" ? Effect.void : Effect.forkDetach(rewireIfTarget(name)).pipe(Effect.asVoid);
		};

		// Container start order is not ours to assume, and a container can restart at any time: the
		// daemon's `start` events wire it the moment it happens. A dropped stream reconnects.
		const watchStarts = engine.events
			.stream({ filters: { type: ["container"], event: ["start"] } })
			.pipe(
				Stream.runForEach(handleStart),
				Effect.catch((error) => Effect.sync(() => { logger.debug(`Docker event stream ended: ${errorText(error)}`); })),
				Effect.andThen(Effect.sleep(EVENT_RECONNECT_MS)),
				Effect.forever,
			);

		// Chained, not periodic: the next pass starts only after the current one settles, so a slow
		// probe can never stack up passes.
		const cadence = Effect.sleep(RECONCILE_INTERVAL_MS).pipe(Effect.andThen(ensureDesiredState), Effect.forever);

		return Effect.all([watchStarts, cadence], { concurrency: "unbounded", discard: true });
	};

	return { spec, background };
}
