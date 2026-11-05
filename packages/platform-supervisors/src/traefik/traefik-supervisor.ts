/**
 * The platform ingress: one Traefik task on EVERY node, with one entrypoint per lane.
 *
 * Traefik carries no Docker socket and no config volume: it POLLS its routes from the API over the
 * platform overlay (HTTP provider), so every node routes identically and a node that loses the API keeps
 * the last configuration it fetched.
 *
 * LANES
 *   local      :80    always    reached through the loopback door on each node
 *   private    :8001  opt-in    reached through the mesh-address door on each node
 *   public     :8002  opt-in    a tunnel edge's connectors dial it; an inbound edge publishes it
 *   public-tls :8443  ACME      certificates obtained by Traefik (HTTP-01 on `public`)
 *
 * Only an inbound edge (`direct`) publishes anything on the host: the ONE kind that opens inbound ports,
 * and only when the operator acknowledged it. Every other lane is reached through a door the node's mesh
 * agent runs (Swarm cannot bind a single address, a plain container can), from the `node.doors` setting
 * this supervisor publishes into the replicated roster.
 *
 * THE ENTRY PORT IS NOT PUBLISHED, BECAUSE THE DOOR OWNS IT. The per-node door is a plain nginx container
 * owned by the mesh agent; it binds the host entry port and forwards to Traefik on the overlay. Publishing
 * the same host port from the swarm service made TWO owners of one port, and the swarm task could never
 * start ("Bind for 127.0.0.1:80 failed: port is already allocated"), which retried forever while the
 * handover reported "the swarm ingress took the entry port but is not routing the API yet". So only the
 * ACKNOWLEDGED public edge (`direct`) contributes host ports, and in that configuration the doors are not
 * what serves the port.
 */
import { Effect, Ref } from "effect";

import type { SwarmEndpointPort, SwarmServiceSpecInput } from "@deployer/contracts-entities";
import {
	defaultIngressLanes,
	enabledLanes,
	type IngressLanes,
} from "@deployer/contracts-entities/entities/ingress/index";
import { platformNetworkName, platformOverlayForPrefix, resolveSupervisorRuntime, type DockerEngineShape, type DockerError } from "@deployer/docker";
import { withBackoff, type ProbeResult, type SupervisorSpec } from "@deployer/supervision";

import { EntryPortConflict, SupervisedResourceMissing, SupervisedResourceNotRunning, SupervisedResourceUnavailable } from "../errors";
import { attachOverlay, makeSwarmServiceOps, PLATFORM_ROLE_LABEL } from "../swarm-service/swarm-service-ops";

import { entrypointCandidates, probeEntrypoint, runsInsideContainer, type EntrypointObservation } from "./entrypoint-probe";
import {
	PLATFORM_INGRESS_ROLE,
	PLATFORM_INGRESS_SUPERVISOR_ID,
	TRAEFIK_ACME_STORAGE_MOUNT,
	TRAEFIK_ACME_STORAGE_PATH,
	TRAEFIK_ACME_VOLUME,
	traefikProcessInfoSchema,
	traefikSupervisorPayloadSchema,
	type TraefikSupervisorPayload,
} from "./schemas";

/** How often each ingress task re-fetches its routes from the API. */
const PROVIDER_POLL_INTERVAL = "5s";
/** Container name of the API-owned forwarder the agent's local door replaces. */
const LEGACY_FORWARDER_CONTAINER = "deployer-ingress-forwarder";
/**
 * Label SETUP stamps on its BOOTSTRAP ingress (a plain container that serves the wizard before the API
 * exists). Both incarnations share the name `deployer-traefik`, so the name proves nothing; only this does.
 */
const BOOTSTRAP_LABELS: Readonly<Record<string, string>> = { "deployer.bootstrap": "true" };
/** How often to re-check whether setup released its bootstrap ingress. */
export const HANDOVER_POLL_MS = 3_000;

/** What the public edge asks of Traefik: published ports, who serves HTTPS. Seeded to "nothing", the only safe direction to be wrong in. */
export type EdgeIngressPlanInput = {
	readonly publishedPorts: readonly { readonly published: number; readonly entrypoint: string }[];
	readonly tls: "edge" | "acme" | "none";
};
const NO_EDGE: EdgeIngressPlanInput = { publishedPorts: [], tls: "none" };

export type LaneEntrypoint = { readonly name: string; readonly port: number };
export type LaneEntrypoints = {
	readonly local: LaneEntrypoint;
	readonly private: LaneEntrypoint;
	readonly public: LaneEntrypoint;
	readonly publicTls: LaneEntrypoint;
};

export type TraefikConfig = {
	readonly prefix: () => string;
	/** The ingress swarm service name on the platform network (`deployer-traefik[-<prefix>]`). */
	readonly serviceName: () => string;
	readonly image: () => string;
	/** The stable name the ingress dials for its routes (a service alias, not a task name). */
	readonly apiTarget: () => string;
	readonly apiPort: () => string | number;
	/** The API path the ingress polls. */
	readonly configPath: string;
	readonly apiHostname: () => string;
	readonly apiOrigin: () => string;
	readonly webOrigin: () => string;
	/** The header and derived value the ingress presents to the API's provider route. Throws without a configured secret. */
	readonly providerToken: () => { readonly header: string; readonly value: string };
	readonly acmeEmail: () => string | undefined;
	readonly entrypoints: LaneEntrypoints;
	readonly acmeResolver: string;
	/** `MANAGED_TRAEFIK_ENABLED=true`: the deployment owns the ingress. */
	readonly externallyManaged: () => boolean;
	readonly runtimeOverride: () => string | undefined;
	/** This process's container id when it runs in a container (`HOSTNAME`). */
	readonly selfHostname: () => string | undefined;
	/** The lanes in effect. Re-read every pass: the UI changes them at runtime. */
	readonly lanes: Effect.Effect<IngressLanes, unknown>;
	/** How the local entrypoint is dialed; the default tries the overlay name, then the host's addresses. Replaceable for a host that cannot dial. */
	readonly entrypointProbe?: (candidates: readonly string[], port: number) => Effect.Effect<EntrypointObservation>;
	/** What the public edge asks of Traefik for these lanes. */
	readonly edgePlan: (lanes: IngressLanes) => EdgeIngressPlanInput;
	/**
	 * Publishes the doors plan into the replicated roster, so every node's agent converges its own doors
	 * from this one write. Best effort: a failure means only the loopback and mesh listeners are missing,
	 * so it is reported as a warning and never fails the convergence.
	 */
	readonly publishNodeDoors: (context: { readonly lanes: IngressLanes; readonly traefikService: string }) => Effect.Effect<void, unknown>;
};

export type TraefikDeps = {
	readonly engine: DockerEngineShape;
	readonly config: TraefikConfig;
	readonly logger: { readonly log: (message: string) => void; readonly warn: (message: string) => void };
};

export type TraefikSupervisor = {
	readonly spec: SupervisorSpec<typeof traefikSupervisorPayloadSchema, typeof traefikProcessInfoSchema>;
	/** Re-reads the lanes now; the host primes it before registering. */
	readonly reload: Effect.Effect<void, unknown>;
	/** The HTTP provider endpoint every ingress task polls. */
	readonly providerEndpoint: () => string;
	/**
	 * While setup's bootstrap ingress still serves, re-checks every few seconds and calls
	 * `ensureDesiredState` the moment setup lets go. Runs until interrupted.
	 */
	readonly background: (ensureDesiredState: Effect.Effect<unknown>) => Effect.Effect<never>;
};

/** An engine refusal because a host port is already bound on some node. */
const isPortBindError = (error: unknown): boolean => {
	const message = error instanceof Error ? error.message : typeof error === "object" && error !== null && "reason" in error ? String(error.reason) : String(error);
	return (
		message.includes("address already in use") ||
		message.includes("port is already allocated") ||
		message.includes("failed to bind host port") ||
		message.includes("bind: address")
	);
};

export function makeTraefikSupervisor({ engine, config, logger }: TraefikDeps): TraefikSupervisor {
	const ops = makeSwarmServiceOps(engine);
	const { entrypoints } = config;

	/** The lanes and edge plan in effect, cached because the spec is built synchronously. Seeded to local-only: a spec built before the first read publishes NOTHING on the host. */
	const lanesRef = Ref.makeUnsafe<IngressLanes>(defaultIngressLanes());
	const planRef = Ref.makeUnsafe<EdgeIngressPlanInput>(NO_EDGE);
	const lanes = () => Ref.getUnsafe(lanesRef);
	const plan = () => Ref.getUnsafe(planRef);
	const reload: Effect.Effect<void, unknown> = config.lanes.pipe(
		Effect.flatMap((next) => Ref.set(lanesRef, next).pipe(Effect.andThen(Ref.set(planRef, config.edgePlan(next))))),
	);

	/** Whether setup's bootstrap ingress was still serving at the last convergence check, which is what the background watch waits on. */
	const blockedByBootstrap = Ref.makeUnsafe(false);

	const providerEndpoint = () => `http://${config.apiTarget()}:${String(config.apiPort())}/${config.configPath}`;
	const servesAcme = () => plan().tls === "acme";

	/**
	 * The host ports this ingress publishes: only the ACKNOWLEDGED public edge (`direct`). The local lane
	 * contributes none, because the door binds the entry port and forwards on the overlay.
	 */
	const edgePorts = (): SwarmEndpointPort[] =>
		plan().publishedPorts.map((port) => ({
			protocol: "tcp",
			publishedPort: port.published,
			targetPort: port.entrypoint === "public" ? entrypoints.public.port : entrypoints.publicTls.port,
			publishMode: "host",
		}));

	/**
	 * The desired GLOBAL spec (one task per node), no socket, no config volume. The flags are `args`, not
	 * `command`: `command` replaces the image's ENTRYPOINT (`/entrypoint.sh`) and every task would die at
	 * init trying to exec `--providers...` as a binary. A failure here (no auth secret configured) is an
	 * Effect failure, not a throw.
	 */
	const buildSpec: Effect.Effect<SwarmServiceSpecInput, unknown> = Effect.try({
		try: () => {
			const tls = servesAcme();
			const token = config.providerToken();
			const args = [
				`--providers.http.endpoint=${providerEndpoint()}`,
				`--providers.http.pollInterval=${PROVIDER_POLL_INTERVAL}`,
				`--providers.http.pollTimeout=${PROVIDER_POLL_INTERVAL}`,
				`--providers.http.headers.${token.header}=${token.value}`,
				`--entrypoints.${entrypoints.local.name}.address=:${String(entrypoints.local.port)}`,
				`--entrypoints.${entrypoints.private.name}.address=:${String(entrypoints.private.port)}`,
				`--entrypoints.${entrypoints.public.name}.address=:${String(entrypoints.public.port)}`,
				...(tls
					? [
							`--entrypoints.${entrypoints.publicTls.name}.address=:${String(entrypoints.publicTls.port)}`,
							`--entrypoints.${entrypoints.public.name}.http.redirections.entrypoint.to=${entrypoints.publicTls.name}`,
							`--entrypoints.${entrypoints.public.name}.http.redirections.entrypoint.scheme=https`,
							`--entrypoints.${entrypoints.public.name}.http.redirections.entrypoint.permanent=true`,
							// A real certificate, not Traefik's self-signed default. HTTP-01 is answered on `public`,
							// which an ACME edge publishes as :80.
							`--certificatesresolvers.${config.acmeResolver}.acme.email=${String(config.acmeEmail())}`,
							`--certificatesresolvers.${config.acmeResolver}.acme.storage=${TRAEFIK_ACME_STORAGE_PATH}`,
							`--certificatesresolvers.${config.acmeResolver}.acme.httpchallenge.entrypoint=${entrypoints.public.name}`,
						]
					: []),
			];
			const endpointPorts = edgePorts();
			const spec: SwarmServiceSpecInput = {
				name: config.serviceName(),
				image: config.image(),
				mode: "global",
				replicas: 1,
				env: [],
				command: [],
				args,
				labels: {
					[PLATFORM_ROLE_LABEL]: PLATFORM_INGRESS_ROLE,
					"deployer.platform.api-hostname": config.apiHostname(),
					"deployer.ingress.lanes": enabledLanes(lanes()).join(","),
				},
				containerLabels: {},
				mounts: tls ? [{ type: "volume", source: TRAEFIK_ACME_VOLUME, target: TRAEFIK_ACME_STORAGE_MOUNT, readOnly: false }] : [],
				placementPreferences: [],
				// Every node: each one serves its own doors, so each needs a local task.
				placementConstraints: [],
				resourcesLimits: {},
				resourcesReservations: {},
				networks: [],
				healthcheck: null,
				// A host-mode port can be held by ONE task per node, so an inbound-edge ingress must give its
				// ports up before the replacement can take them.
				updateConfig: {
					parallelism: 1,
					delayMs: 0,
					order: endpointPorts.length > 0 ? "stop-first" : "start-first",
					failureAction: "rollback",
				},
				stopGracePeriodSeconds: 10,
				endpointPorts,
				endpointMode: "dnsrr",
			};
			return spec;
		},
		catch: (cause) => cause,
	});

	/** Attaches THIS API container to the platform overlay. No-op outside Docker. */
	const connectSelfToOverlay = (overlay: string): Effect.Effect<void> =>
		Effect.suspend(() => {
			const selfId = config.selfHostname();
			return selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId) ? Effect.void : engine.networks.connectContainer(overlay, selfId);
		});

	/** Converges the ingress service; an inbound-edge port conflict is fatal and explained. */
	const reconcileSwarm: Effect.Effect<SwarmServiceSpecInput, unknown> = Effect.gen(function* () {
		const spec = yield* buildSpec;
		return yield* Effect.gen(function* () {
			if (servesAcme()) yield* engine.volumes.ensure(TRAEFIK_ACME_VOLUME);
			const overlay = yield* ops.ensureOverlay(platformNetworkName(config.prefix()));
			const attached = attachOverlay(spec, overlay, [spec.name]);
			yield* engine.swarmServices.reconcile(attached);
			yield* connectSelfToOverlay(overlay);
			return attached;
		}).pipe(
			Effect.catch((startError) => {
				if (!isPortBindError(startError)) return Effect.fail(startError);
				logger.warn("A node already binds :80/:443 — the inbound public edge cannot start (ingress DEGRADED)");
				return engine.swarmServices.remove(spec.name).pipe(Effect.andThen(Effect.fail(new EntryPortConflict({ port: 80 }))));
			}),
		);
	});

	/** Removes the API-owned loopback forwarder the agent's local door replaced: it holds 127.0.0.1:<entry port> with a restart policy, so a node upgraded in place would keep it forever and the door could never bind. */
	const removeLegacyForwarder: Effect.Effect<void, DockerError> = engine.containers.inspect(LEGACY_FORWARDER_CONTAINER).pipe(
		Effect.as(true),
		Effect.orElseSucceed(() => false),
		Effect.flatMap((present) =>
			present
				? engine.containers.removeIfExists(LEGACY_FORWARDER_CONTAINER).pipe(
						Effect.tap(() =>
							Effect.sync(() => {
								logger.log(`Removed the legacy ${LEGACY_FORWARDER_CONTAINER} — the mesh agent's local door replaces it`);
							}),
						),
					)
				: Effect.void,
		),
	);

	const verifySwarm = (spec: SwarmServiceSpecInput): Effect.Effect<void, unknown> =>
		Effect.gen(function* () {
			const service = yield* engine.swarmServices.inspect(spec.name);
			if (service.ID === "") return yield* Effect.fail(new SupervisedResourceMissing({ resource: `platform ingress swarm service '${spec.name}'` }));
			const tasks = yield* engine.swarmServices.listTasks(spec.name).pipe(Effect.orElseSucceed(() => []));
			if (tasks.length > 0 && tasks.every((task) => task.Status.State !== "running")) {
				return yield* Effect.fail(new SupervisedResourceNotRunning({ resource: `platform ingress swarm service '${spec.name}'` }));
			}
		});

	const publishDoors: Effect.Effect<void> = Effect.suspend(() =>
		config.publishNodeDoors({ lanes: lanes(), traefikService: config.serviceName() }),
	).pipe(
		Effect.catch((error) =>
			Effect.sync(() => {
				// The ingress itself is up; without the doors only the loopback/mesh listeners are missing.
				logger.warn(`Node doors not published (${describeWithCause(error)}) — the local lane has no listener yet`);
			}),
		),
	);

	const overlayName = () => platformOverlayForPrefix(config.prefix());

	const converge: Effect.Effect<void, unknown> = Effect.gen(function* () {
		yield* reload;
		const { runtime } = resolveSupervisorRuntime({
			managed: config.externallyManaged(),
			rawRuntime: config.runtimeOverride(),
			swarmActive: yield* engine.swarmCluster.isActive(),
			scope: "node-local",
		});

		if (runtime === "managed") {
			yield* connectSelfToOverlay(overlayName()).pipe(Effect.ignore);
			return;
		}
		if (runtime === "unavailable") {
			return yield* Effect.fail(
				new SupervisedResourceUnavailable({
					resource: "Platform ingress",
					reason:
						"requires an active swarm engine or managed (compose/operator) ownership — no legacy container fallback. SwarmBootstrapService should have converged the engine.",
				}),
			);
		}

		yield* withBackoff(
			"Platform ingress convergence",
			Effect.gen(function* () {
				logger.log(`Ingress lanes — ${enabledLanes(lanes()).join(" + ")}; routes from ${providerEndpoint()}`);
				const spec = yield* reconcileSwarm;
				yield* verifySwarm(spec);
				yield* publishDoors;
				yield* removeLegacyForwarder;
			}),
			{ maxAttempts: 5, isFatal: (error) => error instanceof EntryPortConflict },
		);
	});

	/** Defers while SETUP's bootstrap ingress still runs: it serves the wizard on loopback until the handover releases it, and the local door needs the same port. */
	const bootstrapIngressRunning: Effect.Effect<boolean> = engine.containers.inspect(config.serviceName()).pipe(
		Effect.map((container) => Object.entries(BOOTSTRAP_LABELS).every(([key, value]) => container.Config.Labels[key] === value)),
		Effect.orElseSucceed(() => false),
	);
	const blocker: Effect.Effect<string | null> = Effect.gen(function* () {
		const inherited = yield* ops.blockerUntilSwarm({ managed: config.externallyManaged() });
		if (inherited !== null) return inherited;
		if (config.externallyManaged()) return null;
		const running = yield* bootstrapIngressRunning;
		yield* Ref.set(blockedByBootstrap, running);
		return running ? "setup's bootstrap ingress is still serving — deferred until the handover releases it" : null;
	});

	const background: TraefikSupervisor["background"] = (ensureDesiredState) =>
		Effect.sleep(HANDOVER_POLL_MS).pipe(
			Effect.andThen(Ref.get(blockedByBootstrap)),
			Effect.flatMap((blocked) => (blocked ? ensureDesiredState : Effect.void)),
			Effect.forever,
		);

	const configView = (): TraefikSupervisorPayload["config"] => ({
		apiHostname: config.apiHostname(),
		providerEndpoint: providerEndpoint(),
		lanes: enabledLanes(lanes()),
	});

	/** This node's task of the ingress service: the swarm runs one per node, and another node being down must not make THIS node unhealthy. */
	const localTask = (serviceName: string) =>
		Effect.gen(function* () {
			const service = yield* engine.swarmServices.inspect(serviceName);
			const tasks = yield* engine.swarmServices.listTasks(serviceName).pipe(Effect.orElseSucceed(() => []));
			const selfNodeId = yield* engine.swarmCluster.info().pipe(
				Effect.map((info) => (info.NodeID === "" ? null : info.NodeID)),
				Effect.orElseSucceed(() => null),
			);
			const local = selfNodeId === null ? tasks[0] : tasks.find((task) => task.NodeID === selfNodeId);
			return local === undefined ? null : { serviceId: service.ID ?? null, state: local.Status.State };
		}).pipe(Effect.orElseSucceed(() => null));

	/** Health: the local task runs and its `local` entrypoint answers. */
	const probe: Effect.Effect<ProbeResult<TraefikSupervisorPayload>, unknown> = Effect.gen(function* () {
		const startedAt = Date.now();
		const serviceName = config.serviceName();
		const task = yield* localTask(serviceName);
		const service =
			task === null
				? null
				: {
						serviceId: task.serviceId,
						exists: true,
						createdAt: null,
						updatedAt: null,
						serviceName,
						runningTasks: task.state === "running" ? 1 : 0,
						totalTasks: 1,
					};

		const entrypoint = yield* (config.entrypointProbe ?? probeEntrypoint)(
			entrypointCandidates(serviceName, runsInsideContainer(config.selfHostname())),
			entrypoints.local.port,
		);

		let healthy: boolean;
		let detail: string;
		if (service === null) {
			healthy = false;
			detail = "ingress swarm service missing on this node";
		} else if (service.runningTasks === 0) {
			healthy = false;
			detail = `ingress task not running on this node (state=${task?.state ?? "unknown"})`;
		} else if (!entrypoint.reachable) {
			healthy = false;
			detail = `ingress running but its local entrypoint is unreachable (${entrypoint.host})`;
		} else {
			healthy = true;
			detail = `serving ${enabledLanes(lanes()).join(" + ")} via ${entrypoint.host} (HTTP ${String(entrypoint.statusCode ?? "?")})`;
		}

		return {
			healthy,
			detail,
			payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, service, entrypoint, config: configView() },
		};
	});

	const spec: TraefikSupervisor["spec"] = {
		id: PLATFORM_INGRESS_SUPERVISOR_ID,
		description: "Platform Traefik ingress (one task per node, one entrypoint per lane)",
		payloadSchema: traefikSupervisorPayloadSchema,
		processInfoSchema: traefikProcessInfoSchema,
		converge,
		probe,
		degradedPayload: () => ({ checkedAt: new Date().toISOString(), latencyMs: 0, service: null, entrypoint: null, config: configView() }),
		processInfo: Effect.gen(function* () {
			const port = lanes().entryPort;
			const origin = config.webOrigin();
			return {
				process: yield* buildSpec.pipe(Effect.flatMap((desired) => ops.describeProcess(desired))),
				entry: { port, isDefault80: port === 80 },
				urls: {
					entryUrl: port === 80 ? origin : `${origin}:${String(port)}`,
					apiUrl: config.apiOrigin(),
					webUrl: origin,
				},
				config: { providerEndpoint: providerEndpoint(), lanes: enabledLanes(lanes()) },
			};
		}),
		blocker,
	};

	return { spec, reload, providerEndpoint, background };
}

/**
 * `Effect.tryPromise` wraps whatever its promise rejected with in an error whose message is only
 * "An error occurred in Effect.tryPromise"; the reason is on `cause`. Show both, so the log says why.
 */
export function describeWithCause(error: unknown): string {
	if (!(error instanceof Error)) return String(error);
	const cause: unknown = error.cause;
	if (cause === undefined) return error.message;
	return `${error.message}: ${cause instanceof Error ? cause.message : String(cause)}`;
}

