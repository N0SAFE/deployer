/**
 * The platform Redis as a supervisor.
 *
 * Redis is API-owned infrastructure (like traefik, global-db, managed-web). Its RUNTIME:
 *   - managed (composition/operator in dev): link-only. Ensure the overlay exists and wire the Redis
 *     container into it, so compose-managed Redis reaches and is reached from swarm networks. The
 *     supervisor never spawns a redis when the deployment owns it.
 *   - swarm-replicated (prod, mesh-wide): one replicated swarm service on the attachable platform
 *     overlay (one logical Redis store).
 *   - unavailable: no legacy container fallback.
 *
 * Consumers get the connection URL through `connectionUrl()`: resolution is typed and centralized
 * here, never scattered as `redis://...` strings.
 */
import { Effect } from "effect";

import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";
import { platformNetworkName, resolveSupervisorRuntime, type DockerEngineShape, type DockerError } from "@deployer/docker";
import { withBackoff, type ProbeResult, type SupervisorSpec, type SwarmProcessInfo } from "@deployer/supervision";

import { SupervisedResourceMissing } from "../errors";
import { attachOverlay, makeSwarmServiceOps, PLATFORM_ROLE_LABEL } from "../swarm-service/swarm-service-ops";

import {
	PLATFORM_REDIS_SUPERVISOR_ID,
	REDIS_CONTAINER_BASE_NAME,
	REDIS_DATA_MOUNT,
	REDIS_DATA_VOLUME,
	REDIS_INTERNAL_PORT,
	REDIS_SERVICE_IMAGE_DEFAULT,
	redisProcessInfoSchema,
	redisSupervisorPayloadSchema,
	type RedisRuntime,
	type RedisSupervisorPayload,
} from "./schemas";

/** Ownership marker: cleanup and inspection tooling keys off this label. */
const REDIS_ROLE = "platform-redis";

/** What the deployment says about the Redis it may own (`MANAGED_REDIS_*`). */
export type RedisManagedConfig = {
	readonly enabled: boolean;
	readonly url?: string | undefined;
	readonly host?: string | undefined;
	readonly port?: number | undefined;
	readonly password?: string | undefined;
};

export type RedisConfig = {
	/** `DEPLOYER_PREFIX`: isolates one instance's names from another's. */
	readonly prefix: () => string;
	readonly image: () => string | undefined;
	readonly password: () => string | undefined;
	/** An explicit connection URL (e.g. an external Redis). */
	readonly explicitUrl: () => string | undefined;
	readonly managed: () => RedisManagedConfig;
	/** The `SUPERVISOR_RUNTIME` override. */
	readonly runtimeOverride: () => string | undefined;
};

export type RedisSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly config: RedisConfig;
	readonly logger: { readonly log: (message: string) => void };
};

export type RedisSupervisor = {
	readonly spec: SupervisorSpec<typeof redisSupervisorPayloadSchema, typeof redisProcessInfoSchema>;
	/** The typed connection URL consumers use to reach Redis. */
	readonly connectionUrl: () => string;
	/** The runtime now in force and why. */
	readonly resolveRuntime: () => { readonly runtime: RedisRuntime; readonly reason: string };
};

export function makeRedisSupervisor({ engine, config, logger }: RedisSupervisorDeps): RedisSupervisor {
	const ops = makeSwarmServiceOps(engine);

	const serviceName = (): string => {
		const prefix = config.prefix();
		return prefix === "" ? REDIS_CONTAINER_BASE_NAME : `${REDIS_CONTAINER_BASE_NAME}-${prefix}`;
	};
	const image = (): string => config.image() ?? REDIS_SERVICE_IMAGE_DEFAULT;
	const command = (): string[] => {
		const password = config.password();
		return ["redis-server", "--appendonly", "yes", ...(password ? ["--requirepass", password] : [])];
	};

	/** Redis is mesh-wide, so replicated 1 in prod. */
	const resolveRuntime: RedisSupervisor["resolveRuntime"] = () => {
		const resolved = resolveSupervisorRuntime({
			managed: config.managed().enabled,
			rawRuntime: config.runtimeOverride(),
			// `true` is correct only because `managed` short-circuits it: a compose stack never reaches
			// the swarm branch, and a node that owns Redis itself is expected to have a swarm (setup
			// founds one before the API runs). When it does not, convergence reports why, which is more
			// useful than a silent downgrade.
			swarmActive: true,
			scope: "mesh-wide",
		});
		return { runtime: resolved.runtime === "managed" ? "managed" : "swarm-replicated", reason: resolved.reason };
	};

	const swarmSpec = (): SwarmServiceSpecInput => ({
		name: serviceName(),
		image: image(),
		mode: "replicated",
		replicas: 1,
		stopGracePeriodSeconds: 10,
		env: [],
		command: command(),
		args: [],
		labels: { [PLATFORM_ROLE_LABEL]: REDIS_ROLE, "deployer.managed": "true" },
		containerLabels: {},
		mounts: [{ type: "volume", source: REDIS_DATA_VOLUME, target: REDIS_DATA_MOUNT, readOnly: false }],
		placementPreferences: [],
		placementConstraints: [],
		resourcesLimits: {},
		resourcesReservations: {},
		networks: [],
		capabilitiesAdd: [],
		healthcheck: null,
		updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
		endpointPorts: [],
		// One task, addressed by DNS name: a VIP would only ever forward to that same task, so the
		// load-balancer hop is pure risk.
		endpointMode: "dnsrr",
	});

	/**
	 * Resolution order:
	 *   1. `managed.redis.url` (compose-managed explicit URL)
	 *   2. `DEPLOYER_REDIS_URL` (explicit override, e.g. an external Redis)
	 *   3. compose-managed defaults: `redis://[pwd@]<host>:<port>` from `managed.redis.*`
	 *   4. API-supervised default: `redis://[pwd@]deployer-redis:6379`
	 */
	const connectionUrl = (): string => {
		const managed = config.managed();
		const explicit = config.explicitUrl();
		if (managed.enabled) {
			if (managed.url !== undefined && managed.url !== "") return managed.url;
			if (explicit !== undefined && explicit !== "") return explicit;
			const auth = managed.password ? `${encodeURIComponent(managed.password)}@` : "";
			return `redis://${auth}${managed.host ?? "redis"}:${String(managed.port ?? 6379)}`;
		}
		if (explicit !== undefined && explicit !== "") return explicit;
		const password = config.password();
		const auth = password ? `${encodeURIComponent(password)}@` : "";
		return `redis://${auth}${serviceName()}:${String(REDIS_INTERNAL_PORT)}`;
	};

	const payload = (
		startedAt: number,
		runtime: RedisRuntime,
		fields: Partial<Pick<RedisSupervisorPayload, "service" | "reachable">> = {},
	): RedisSupervisorPayload => ({
		checkedAt: new Date().toISOString(),
		latencyMs: Date.now() - startedAt,
		runtime,
		service: fields.service ?? null,
		host: serviceName(),
		port: REDIS_INTERNAL_PORT,
		reachable: fields.reachable ?? false,
		ping: null,
		redisVersion: null,
	});

	const network = () => platformNetworkName(config.prefix());

	const converge: Effect.Effect<void, unknown> = Effect.suspend(() => {
		const { runtime } = resolveRuntime();

		if (runtime === "managed") {
			return ops.wireExternalToSwarm(network(), serviceName()).pipe(
				Effect.tap((overlay) =>
					Effect.sync(() => {
						logger.log(
							overlay === null
								? "Redis managed (compose/operator) — no swarm to bridge, compose network only"
								: `Redis managed (compose/operator) — wired external to swarm overlay ${overlay}`,
						);
					}),
				),
				Effect.asVoid,
			);
		}

		const swarm = Effect.gen(function* () {
			const overlay = yield* ops.ensureOverlay(network());
			// Consumers reach Redis by its stable alias (persisted URLs point at `deployer-redis[-<prefix>]`),
			// declared explicitly so prefixed fleets resolve.
			const spec = attachOverlay(swarmSpec(), overlay, [serviceName()]);
			yield* engine.swarmServices.reconcile(spec);
			const service = yield* engine.swarmServices.inspect(spec.name);
			if (!service.ID) return yield* Effect.fail(new SupervisedResourceMissing({ resource: `Redis swarm service '${spec.name}'` }));
		});
		return withBackoff("Platform Redis (swarm) convergence", swarm, { maxAttempts: 5 });
	});

	/** REAL health observation: service state plus best-effort reachability. */
	const probe: Effect.Effect<ProbeResult<RedisSupervisorPayload>, DockerError> = Effect.gen(function* () {
		const startedAt = Date.now();
		const { runtime } = resolveRuntime();

		if (runtime === "managed") {
			return {
				healthy: true,
				detail: "Redis is compose/operator-managed — link-only wiring active, process health owned by the deployment.",
				payload: payload(startedAt, runtime, { reachable: true }),
			};
		}

		return yield* ops.serviceHealth(serviceName()).pipe(
			Effect.map(
				(service): ProbeResult<RedisSupervisorPayload> => ({
					healthy: service.runningTasks > 0,
					...(service.runningTasks > 0 ? {} : { detail: `Redis swarm service has ${String(service.runningTasks)} running tasks` }),
					payload: payload(startedAt, runtime, {
						service: { id: service.id ?? "", name: service.name, runningTasks: service.runningTasks, exists: true },
						reachable: service.runningTasks > 0,
					}),
				}),
			),
			// An unreachable or missing service is an unhealthy Redis, not a failed probe.
			Effect.catch((error) =>
				Effect.succeed<ProbeResult<RedisSupervisorPayload>>({
					healthy: false,
					detail: `Redis swarm service probe failed: ${error instanceof Error ? error.message : String(error)}`,
					payload: payload(startedAt, runtime),
				}),
			),
		);
	});

	const connection = () => ({ host: serviceName(), port: REDIS_INTERNAL_PORT, url: connectionUrl() });

	const spec: RedisSupervisor["spec"] = {
		id: PLATFORM_REDIS_SUPERVISOR_ID,
		description: "Platform Redis (durable key-value store for idempotency, rate limits and future multi-node coordination)",
		payloadSchema: redisSupervisorPayloadSchema,
		processInfoSchema: redisProcessInfoSchema,
		converge,
		probe,
		degradedPayload: () => payload(Date.now(), resolveRuntime().runtime),
		processInfo: Effect.suspend(() => {
			if (resolveRuntime().runtime === "swarm-replicated") {
				return ops.describeProcess(swarmSpec()).pipe(Effect.map((process) => ({ process, connection: connection() })));
			}
			// Not scheduled by us (the deployment owns it): the desired config, with nothing live to show.
			const notScheduled: SwarmProcessInfo = {
				kind: "swarm",
				runtime: "swarm-replicated",
				desired: { name: serviceName(), image: image(), command: command(), labels: {}, networkName: null, mode: "replicated", replicas: 1 },
				live: { serviceId: null, exists: false, createdAt: null, updatedAt: null, serviceName: null, runningTasks: null, totalTasks: null },
			};
			return Effect.succeed({ process: notScheduled, connection: connection() });
		}),
		blocker: Effect.suspend(() => ops.blockerUntilSwarm({ managed: config.managed().enabled })),
	};

	return { spec, connectionUrl, resolveRuntime };
}

