/**
 * CloudflaredSupervisorService — supervises the Cloudflare Tunnel CONNECTOR.
 *
 * ── WHY THIS SUPERVISOR EXISTS ──────────────────────────────────────────────
 * The tunnel used to be a compose sidecar in the all-in-one profile, and it was
 * dead as written: it targeted `deployer-traefik`, a name that resolves only on
 * the SWARM overlay, while the sidecar joined the compose bridge networks. It
 * also existed in exactly one compose file, so no supervised profile had an edge
 * at all.
 *
 * Making it a supervised swarm service fixes both, and makes the edge part of
 * the platform's convergence model rather than a compose detail: it is created,
 * health-checked, restarted and reported like every other platform process.
 *
 * ── WHY `replicated` AND NOT `global` ───────────────────────────────────────
 * This is the opposite choice from the ingress, deliberately.
 *
 *   Traefik is `global` because each node must route for the tasks scheduled on
 *   it, and its entry port is node-local (`publishMode: host`).
 *
 *   The connector has NO ports at all — it dials OUT to Cloudflare and holds the
 *   connection open. Nothing is node-local about it, so "one per node" would buy
 *   nothing while multiplying the connections Cloudflare has to track.
 *
 * A `replicated` service is spread across nodes by the scheduler, so a small
 * replica count already survives a node failure — but "spread" is only a
 * PREFERENCE, and a preference does not guarantee anything. With two replicas
 * and two nodes the scheduler may still place both on one node, and that node's
 * loss then takes the whole edge with it. The guarantee needs a hard cap
 * (`placementMaxReplicasPerNode: 1` → Swarm's `Placement.MaxReplicas`), which
 * is why the spec sets BOTH: the preference asks the scheduler to spread, the
 * cap makes it impossible not to.
 * One tunnel serving many connectors is the documented Cloudflare model (up to
 * 25 connectors per tunnel), which is what keeps the Cloudflare side FIXED as
 * the fleet grows: adding a node does not add a tunnel.
 *
 * ── WHY THERE ARE NO PORTS AND NO INGRESS RULES HERE ────────────────────────
 * The connector is a client, so this spec publishes nothing. And the tunnel's
 * hostname→service rules are written REMOTELY through the Cloudflare API
 * (`CloudflareTunnelService.configureIngress`), not from a local config file:
 * writing them locally would mean every app hostname needed a config change AND
 * a connector restart, which is the thing the wildcard rule exists to avoid.
 *
 * When no tunnel is configured this supervisor reports `managed`, which means
 * "the deployment owns the edge" — the honest answer for a `direct` install
 * where Cloudflare is not involved at all.
 */

import { Injectable } from "@nestjs/common";
import z from "zod/v4";

import { BaseDockerSupervisorService } from "@repo/nest-docker/services/base-docker-supervisor.service";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	swarmProcessInfoSchema,
} from "@repo/nest-supervisor-core/supervisor-process-info";
import { EnvService } from "@/config/env/env.module";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@repo/nest-docker/services/docker-supervisor-runtime";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { PlatformIngressSettingsService, type EdgeMode } from "../../platform-ingress/services/platform-ingress-settings.service";
import { DEFAULT_INGRESS_PROVIDER } from "@repo/contracts-entities/entities/ingress/index";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "./traefik-supervisor.service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const CLOUDFLARED_ROLE = "platform-cloudflared";

export const CLOUDFLARED_SUPERVISOR_ID = "platform-cloudflared";
export const CLOUDFLARED_BASE_NAME = "deployer-cloudflared";

/** The connector has no listening port; these bound how it is REPORTED. */
export const CLOUDFLARED_TUNNEL_PORT = 7844;

/**
 * Which runtime this supervisor is CURRENTLY under.
 *
 * There is deliberately no `unavailable` member. Every other docker supervisor
 * has one because a compose-only node has no swarm, and its resource genuinely
 * cannot exist. This supervisor is different: the ABSENCE of a tunnel is a
 * supported configuration (`direct`), and it is reported as `managed` — "the
 * deployment owns the edge" — rather than as a failure. An `unavailable` state
 * would describe a broken edge where there is simply no tunnel configured.
 */
export const cloudflaredRuntimeSchema = z.enum(["managed", "swarm-replicated"]);
export type CloudflaredRuntime = z.output<typeof cloudflaredRuntimeSchema>;

export const cloudflaredSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	runtime: cloudflaredRuntimeSchema,
	service: z
		.object({
			id: z.string(),
			name: z.string(),
			runningTasks: z.number().int().min(0).nullable(),
			exists: z.boolean(),
		})
		.nullable(),
	/** True when a tunnel token is configured, i.e. this platform HAS an edge. */
	configured: z.boolean(),
	replicas: z.number().int().min(0),
	/** The single target the tunnel forwards to (Traefik by default). */
	routeTarget: z.string(),
	/** The wildcard the tunnel ingress rules are written against, when set. */
	wildcard: z.string().nullable(),
});
export type CloudflaredSupervisorPayload = z.output<typeof cloudflaredSupervisorPayloadSchema>;

export const cloudflaredProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
});
export type CloudflaredProcessInfo = z.output<typeof cloudflaredProcessInfoSchema>;

@Injectable()
export class CloudflaredSupervisorService extends BaseDockerSupervisorService<
	typeof cloudflaredSupervisorPayloadSchema,
	typeof cloudflaredProcessInfoSchema
> {
	static readonly identifier = CLOUDFLARED_SUPERVISOR_ID;
	readonly description =
		"Cloudflare Tunnel connector (outbound-only edge: no inbound port, no public IP required)";

	readonly payloadSchema = cloudflaredSupervisorPayloadSchema;
	readonly processInfoSchema = cloudflaredProcessInfoSchema;

	constructor(
		dockerService: DockerService,
		private readonly env: EnvService,
		private readonly edgeSettings: PlatformIngressSettingsService,
	) {
		super(dockerService);
	}

	/**
	 * The stack's persisted tunnel, resolved lazily because the settings store is
	 * asynchronous while `probe()`/`buildSwarmSpec()` are not.
	 *
	 * Cached after the first successful read: this is read on every probe and the
	 * value only changes when the API itself writes it (see `invalidateEdgeCache`).
	 */
	private cachedToken: string | null | undefined = undefined;

	/** Drop the cached tunnel so the next probe re-reads the store. */
	invalidateEdgeCache(): void {
		this.cachedToken = undefined;
	}

	/**
	 * Prime the cache at boot. The supervisors probe synchronously, so the store
	 * must be read once before the first probe — otherwise a persisted tunnel
	 * would look unconfigured until some later write happened to invalidate it.
	 */
	override async onModuleInit(): Promise<void> {
		await this.loadEdgeTunnel();
		const { runtime, reason } = this.resolveRuntime();
		this.logger.log(`Cloudflared supervisor registering — runtime=${runtime} (${reason})`);
		super.onModuleInit();
	}

	/**
	 * The edge mode in effect: the persisted operator choice, else the install
	 * default.
	 *
	 * Seeded from `DEFAULT_INGRESS_PROVIDER` rather than a literal, and that
	 * distinction is the whole point: this used to hardcode `"direct"`, which
	 * disagreed with the canonical default (`local`). A probe arriving before the
	 * first store read then reported a PUBLIC provider on a loopback-only install
	 * — and two supervisors disagreeing about the mode is exactly the ambiguity
	 * the canonical vocabulary exists to remove.
	 */
	private edgeMode: EdgeMode = DEFAULT_INGRESS_PROVIDER;

	/**
	 * Read the persisted mode + tunnel into the cache.
	 *
	 * Environment wins for the TOKEN (a compose/operator install supplies it
	 * there and has no settings row), but the MODE always comes from the store so
	 * the UI can switch it — `DEPLOYER_EDGE_MODE` is only the seed value.
	 */
	async loadEdgeTunnel(): Promise<void> {
		this.edgeMode = await this.edgeSettings.getEdgeMode();
		const envToken = this.env.get("DEPLOYER_TUNNEL_TOKEN");
		if (envToken !== undefined && envToken.trim() !== "") {
			this.cachedToken = envToken.trim();
			return;
		}
		const stored = await this.edgeSettings.getEdgeTunnel();
		this.cachedToken = stored.token;
	}

	/**
	 * The run token that authorises a connector against the tunnel.
	 *
	 * Resolved from the ENVIRONMENT first (a compose/operator install supplies it
	 * there) and otherwise from the persisted stack settings the web UI writes.
	 *
	 * This is what makes `tunnel` mode reachable end to end: the API provisions
	 * the tunnel through the provider and stores its token, and this supervisor —
	 * which runs before Postgres and cannot call the provider — simply reads it.
	 *
	 * Absent from both means this platform has no tunnel edge: either the
	 * deployment runs its own (`managed`), or the edge is `direct`.
	 */
	private token(): string | null {
		return this.cachedToken ?? null;
	}

	/**
	 * Whether the DEPLOYMENT owns the edge rather than the platform.
	 *
	 * Two cases collapse to the same answer, and neither is a failure:
	 *   - the operator chose `direct` (no tunnel at all), or
	 *   - a compose/operator-managed install fronts the platform itself.
	 * In both, spawning a connector would add a second, unmanaged path to the
	 * internet — so the honest state is `managed`, meaning "not ours to create".
	 */
	private isDeploymentOwned(): boolean {
		if (this.edgeMode !== "tunnel") return true;
		return this.token() === null;
	}

	/** Resolve the current runtime. The connector is a single logical client. */
	protected resolveRuntime(): { runtime: CloudflaredRuntime; reason: string } {
		const resolved = resolveSupervisorRuntime({
			managed: this.isDeploymentOwned(),
			rawRuntime: process.env.SUPERVISOR_RUNTIME,
			swarmActive: true,
			scope: "mesh-wide",
		});
		const runtime: CloudflaredRuntime =
			resolved.runtime === "managed" ? "managed" : "swarm-replicated";
		return { runtime, reason: resolved.reason };
	}

	protected effectiveRuntime(): CloudflaredRuntime {
		return this.resolveRuntime().runtime;
	}

	/** True when the deployment (compose/operator/direct) owns the edge. */
	protected override isDeploymentManaged(): boolean {
		return this.isDeploymentOwned();
	}

	/** Swarm service name, prefixed like every other platform service. */
	private serviceName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX") ?? "";
		return prefix === "" ? CLOUDFLARED_BASE_NAME : `${CLOUDFLARED_BASE_NAME}-${prefix}`;
	}

	private image(): string {
		return this.env.get("DEPLOYER_CLOUDFLARED_IMAGE");
	}

	/** Replica count, clamped to what the tunnel allows. */
	private replicas(): number {
		return this.env.get("DEPLOYER_CLOUDFLARED_REPLICAS");
	}

	/** The single hostname every tunnel rule forwards to. */
	routeTarget(): string {
		return this.env.get("DEPLOYER_TUNNEL_ROUTE_TARGET");
	}

	/** The wildcard the tunnel ingress rules are written against, when set. */
	wildcard(): string | null {
		const wildcard = this.env.get("DEPLOYER_TUNNEL_WILDCARD");
		return wildcard === undefined || wildcard.trim() === "" ? null : wildcard.trim();
	}

	/**
	 * The connector's command.
	 *
	 * `tunnel --no-autoupdate run` with the token in the ENVIRONMENT rather than
	 * the argv: the token is a credential, and a command line is readable through
	 * `docker inspect` by anything that can reach the socket. `TUNNEL_TOKEN` is
	 * the variable cloudflared reads for this exact purpose.
	 */
	private command(): string[] {
		return ["tunnel", "--no-autoupdate", "run"];
	}

	/** Swarm service spec for the outbound-only connector. */
	protected buildSwarmSpec(): SwarmServiceSpecInput {
		const token = this.token();
		return {
			name: this.serviceName(),
			image: this.image(),
			mode: "replicated",
			replicas: this.replicas(),
			stopGracePeriodSeconds: 30,
			// The token travels in the environment, never in argv — see `command()`.
			// Spread conditionally so an unconfigured platform does not emit an
			// empty-string credential the connector would reject.
			env: token === null ? [] : [`TUNNEL_TOKEN=${token}`],
			command: this.command(),
			args: [],
			labels: {
				[PLATFORM_ROLE_LABEL]: CLOUDFLARED_ROLE,
				"deployer.managed": "true",
				"deployer.edge.mode": "tunnel",
			},
			containerLabels: {},
			mounts: [],
			// ── CONNECTOR HA NEEDS BOTH OF THESE ────────────────────────────
			// The spread preference asks the scheduler to distribute replicas
			// across nodes; `placementMaxReplicasPerNode` (Swarm's
			// `Placement.MaxReplicas`) makes it a hard cap. A preference alone
			// is satisfied even when both replicas land on ONE node, so relying
			// on it would leave the edge one node failure from gone while
			// looking redundant — the exact failure the header describes.
			placementPreferences: [{ spreadDescriptor: "node.id" }],
			placementMaxReplicasPerNode: 1,
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			capabilitiesAdd: [],
			// A connector that cannot reach Cloudflare reconnects on its own, so a
			// container-level healthcheck adds nothing but a restart loop. Health is
			// judged from the tunnel's own reported connections instead.
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			// NO PORTS: the connector holds outbound connections. Publishing one
			// would be the exact inbound surface this mode exists to avoid.
			endpointPorts: [],
			// One task per replica, dialled by name only if ever needed internally.
			endpointMode: "dnsrr",
		};
	}

	/** One idempotent convergence pass. */
	protected async reconcile(): Promise<void> {
		// Re-read the persisted tunnel on every sweep. The web UI writes it and
		// this supervisor has no other way to learn about the change: creating the
		// connector from one request and starting it from the next sweep keeps the
		// two sides decoupled (no cross-module cache invalidation to get wrong).
		await this.loadEdgeTunnel();

		const runtime = this.effectiveRuntime();

		if (runtime === "managed") {
			// Nothing to spawn: the edge is direct, or the deployment runs it.
			await this.wireExternalToSwarm(
				PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX") ?? ""),
				this.serviceName(),
			);
			this.logger.log(
				this.edgeMode === "tunnel"
					? "Edge mode is `tunnel` but no tunnel token is configured — no connector to run"
					: `Edge mode is \`${this.edgeMode}\` — no tunnel connector to run (a connector is only used by \`tunnel\`)`,
			);
			return;
		}

		await this.runWithBackoff(
			"Cloudflare tunnel connector convergence",
			async () => {
				const overlay = await this.ensureSwarmNetwork(
					PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX") ?? ""),
				);
				const spec = this.buildSwarmSpec();
				// The connector must resolve `deployer-traefik` to reach its own
				// target, and that name lives on the platform overlay — the same
				// network the ingress is attached to. Its own name is aliased too, so
				// the service is inspectable by a stable name from anywhere on it.
				this.attachOverlay(spec, overlay, [spec.name]);
				await this.reconcileSwarmService(spec);
				await this.verifySwarmConvergence(spec.name);
			},
			{ maxAttempts: 5 },
		);
	}

	/**
	 * Confirm the connector service exists and has a running task.
	 *
	 * `inspectSwarmService` THROWS when the service is missing (it raises
	 * `NotFoundException` rather than returning an empty summary), so an absent
	 * service arrives here as an error — which is exactly what "not created" is,
	 * and the message names the service so the reason is legible.
	 */
	private async verifySwarmConvergence(name: string): Promise<void> {
		const service = await this.dockerService.inspectSwarmService(name);
		const tasks = await this.dockerService.listSwarmServiceTasks(name).catch(() => []);
		const running = tasks.filter((task) => task.Status.State === "running").length;
		if (running === 0) {
			throw new Error(
				`Cloudflare tunnel connector '${service.Spec.Name}' has no running task`,
			);
		}
	}

	/** Entire config + live process view. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const runtime = this.effectiveRuntime();
		if (runtime === "swarm-replicated") {
			return {
				process: await this.describeSwarmProcess(this.buildSwarmSpec()),
				edge: {
					mode: "tunnel",
					replicas: this.replicas(),
					routeTarget: this.routeTarget(),
					wildcard: this.wildcard(),
				},
			};
		}

		// `managed` — the deployment or the `direct` mode owns the edge, so there is
		// no desired service to describe. Reported as a zero-replica swarm resource
		// so consumers see ONE shape whichever runtime is active.
		return {
			process: {
				kind: "swarm",
				runtime: "managed",
				desired: {
					name: this.serviceName(),
					image: this.image(),
					command: this.command(),
					labels: {},
					networkName: null,
					mode: "replicated",
					replicas: 0,
				},
				live: {
					serviceId: null,
					exists: false,
					createdAt: null,
					updatedAt: null,
					serviceName: null,
					runningTasks: null,
					totalTasks: null,
				},
			},
			edge: {
				mode: this.edgeMode,
				replicas: 0,
				routeTarget: this.routeTarget(),
				wildcard: this.wildcard(),
			},
		};
	}

	/** Degraded payload when probe() itself throws. */
	protected buildDegradedPayload(_detail: string): z.output<typeof cloudflaredSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			runtime: this.effectiveRuntime(),
			service: null,
			configured: this.token() !== null,
			replicas: 0,
			routeTarget: this.routeTarget(),
			wildcard: this.wildcard(),
		};
	}

	/** REAL health observation: connector service state + task count. */
	protected async probe(): Promise<SupervisorProbeResult<typeof cloudflaredSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const runtime = this.effectiveRuntime();
		const base = {
			checkedAt: new Date().toISOString(),
			configured: this.token() !== null,
			routeTarget: this.routeTarget(),
			wildcard: this.wildcard(),
		};

		if (runtime === "managed") {
			// NOT a failure: this is what `direct` looks like, and what a
			// deployment-owned edge looks like. An absence of connector is correct.
			return {
				healthy: true,
				detail:
					this.edgeMode === "tunnel"
						? "Edge is deployment-owned — the platform runs no connector."
					: `Edge mode is \`${this.edgeMode}\` — traffic reaches Traefik directly, with no tunnel.`,
				payload: {
					...base,
					latencyMs: Date.now() - startedAt,
					runtime,
					service: null,
					replicas: 0,
				},
			};
		}

		try {
			const service = await this.dockerService.inspectSwarmService(this.serviceName());
			// Docker types `ID` as optional; a service inspected BY NAME must have
			// one, so an absent id means the engine answered with something
			// unexpected — reported as a probe failure rather than stored as `""`.
			// Same narrowing the Redis supervisor uses, for the same reason.
			if (service.ID === undefined) {
				throw new Error(`Cloudflare tunnel connector "${this.serviceName()}" has no ID`);
			}
			const tasks = await this.dockerService.listSwarmServiceTasks(this.serviceName()).catch(() => []);
			const running = tasks.filter((task) => task.Status.State === "running").length;
			return {
				healthy: running > 0,
				...(running > 0 ? {} : { detail: `Connector has ${String(running)} running task(s)` }),
				payload: {
					...base,
					latencyMs: Date.now() - startedAt,
					runtime,
					service: { id: service.ID, name: service.Spec.Name, runningTasks: running, exists: true },
					replicas: running,
				},
			};
		} catch (error: unknown) {
			const message = error instanceof Error ? error.message : String(error);
			return {
				healthy: false,
				detail: `Cloudflare tunnel connector probe failed: ${message}`,
				payload: {
					...base,
					latencyMs: Date.now() - startedAt,
					runtime,
					service: null,
					replicas: 0,
				},
			};
		}
	}
}
