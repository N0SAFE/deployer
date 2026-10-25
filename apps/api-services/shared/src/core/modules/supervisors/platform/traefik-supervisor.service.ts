/**
 * TraefikSupervisorService — supervises the platform ingress: one Traefik task on
 * EVERY node, with one entrypoint per lane.
 *
 * ── WHAT CHANGED, AND WHY ───────────────────────────────────────────────────
 * Traefik used to mount the Docker socket on every node and read its routes from
 * YAML files in a NODE-LOCAL volume — so every node but the API's served an empty
 * config, and every node handed Traefik root-equivalent access to its engine.
 * Now it carries no socket and no config volume: it POLLS its routes from the API
 * over the platform overlay (HTTP provider), so every node routes identically and
 * a node that loses the API keeps the last configuration it fetched.
 *
 * ── LANES ───────────────────────────────────────────────────────────────────
 *   local    :80     always      reached through the loopback door on each node
 *   private  :8001   opt-in      reached through the mesh-address door on each node
 *   public   :8002   opt-in      a tunnel edge's connectors dial it; an inbound edge publishes it
 *   public-tls :8443 ACME edges  certificates obtained by Traefik (HTTP-01 on `public`)
 *
 * Only an inbound edge (`direct`) publishes anything on the host — the ONE kind that opens inbound
 * ports, and only when the operator acknowledged it. Every other lane is reached
 * through a door the node's mesh agent runs (Swarm cannot bind a single address,
 * a plain container can), from the `node.doors` setting this supervisor publishes
 * into the replicated roster.
 */

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import http from "node:http";
import { existsSync } from "node:fs";
import z from "zod/v4";

import {
	defaultIngressLanes,
	enabledLanes,
	type IngressLanes,
} from "@deployer/contracts-entities/entities/ingress/index";
import { NODE_DOORS_SETTING_KEY, type DoorRescueRoute } from "@deployer/mesh-network";
import { BaseDockerSupervisorService } from "@deployer/nest-docker/services/base-docker-supervisor.service";
import {
	platformOverlayForPrefix,
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@deployer/nest-docker/services/docker-supervisor-runtime";
import type { SwarmEndpointPort, SwarmServiceSpecInput } from "@deployer/contracts-entities";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@deployer/nest-supervisor-core/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	swarmProcessInfoSchema,
} from "@deployer/nest-supervisor-core/supervisor-process-info";
import { splitManagedEnv } from "@deployer/env";
import { resolveDockerHostIp } from "@deployer/nest-docker/services/docker-host-address";

import { EnvService } from "@/config/env/env.module";
import { MeshAgentClient } from "@/core/modules/mesh-agent/mesh-agent.client";
import { HostnameService } from "@/core/modules/platform-ingress/services/hostname.service";
import { buildNodeDoors } from "@/core/modules/platform-ingress/services/ingress-doors";
import { IngressLanesService } from "@/core/modules/platform-ingress/services/ingress-lanes.service";
import {
	deriveIngressProviderToken,
	INGRESS_TOKEN_HEADER,
	requireIngressSecret,
	TRAEFIK_CONFIG_PATH,
} from "@/core/modules/platform-ingress/services/ingress-provider-token";
import { LANE_ENTRYPOINTS, TRAEFIK_ACME_RESOLVER } from "@/core/modules/platform-ingress/services/lane-traefik-config";
import type { EdgeIngressPlan } from "@/core/modules/edge/edge-provider";
import { EdgeProviderRegistry, NO_PUBLIC_EDGE } from "@/core/modules/edge/edge-provider.registry";
import {
	PLATFORM_WEB_INTERNAL_PORT,
	platformApiServiceName,
	platformTraefikContainerName,
} from "@/core/modules/platform-ingress/services/platform-names";
import { PlatformWebTargetService } from "@/core/modules/platform-ingress/services/platform-web-target.service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
export const PLATFORM_ROLE_LABEL = "deployer.platform.role";
export const PLATFORM_INGRESS_ROLE = "ingress";

export const PLATFORM_INGRESS_SUPERVISOR_ID = "platform-ingress-traefik";

/** How often each ingress task re-fetches its routes from the API. */
const PROVIDER_POLL_INTERVAL = "5s";

/** Where the ACME account + issued certificates are persisted (ACME edges only). */
export const TRAEFIK_ACME_STORAGE_MOUNT = "/acme";
export const TRAEFIK_ACME_STORAGE_PATH = `${TRAEFIK_ACME_STORAGE_MOUNT}/acme.json`;

/**
 * Named volume holding the ACME state, per node.
 *
 * ACME state is a CACHE, not a source of truth: two nodes each obtaining their own
 * certificate for a hostname is wasteful but correct, whereas a missing file
 * re-orders on every restart — which Let's Encrypt rate-limits.
 */
export const TRAEFIK_ACME_VOLUME = "deployer-traefik-acme";

/** Container name of the API-owned forwarder the agent's local door replaces. */
const LEGACY_FORWARDER_CONTAINER = "deployer-ingress-forwarder";

export const traefikSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	/** Live view of the ingress swarm service (null when absent). */
	service: swarmProcessInfoSchema.shape.live.nullable(),
	entrypoint: z
		.object({
			host: z.string(),
			port: z.number().int().min(1),
			reachable: z.boolean(),
			statusCode: z.number().int().nullable(),
			latencyMs: z.number().int().min(0).nullable(),
		})
		.nullable(),
	config: z.object({
		apiHostname: z.string(),
		/** Where the ingress polls its routes. */
		providerEndpoint: z.string(),
		/** Lanes the ingress serves right now. */
		lanes: z.array(z.string()),
	}),
});
export type TraefikSupervisorPayload = z.output<typeof traefikSupervisorPayloadSchema>;

export type EntrypointProbe = {
	reachable: boolean;
	host: string;
	port: number;
	statusCode: number | null;
	latencyMs: number | null;
}

export const traefikProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	entry: z.object({
		/** Host port every node door binds (local and private lanes). */
		port: z.number().int().min(1),
		/** True when the port is the default 80. */
		isDefault80: z.boolean(),
	}),
	urls: z.object({
		/** The console on THIS machine (local lane). */
		entryUrl: z.string().nullable(),
		apiUrl: z.string(),
		webUrl: z.string(),
	}),
	config: z.object({
		providerEndpoint: z.string(),
		lanes: z.array(z.string()),
	}),
});
export type TraefikProcessInfo = z.output<typeof traefikProcessInfoSchema>;

/**
 * Sentinel for a `direct` public lane whose :80/:443 is already bound on some node.
 * Deterministic — the backoff does not retry it; the supervisor goes DEGRADED and
 * the operator frees the port or picks another lane.
 */
export class EntryPortConflictError extends Error {
	readonly port: number;
	constructor(port: number) {
		super(`port ${String(port)} is already in use on a node`);
		this.name = "EntryPortConflictError";
		this.port = port;
	}
}

@Injectable()
export class TraefikSupervisorService
	extends BaseDockerSupervisorService<typeof traefikSupervisorPayloadSchema, typeof traefikProcessInfoSchema>
	implements OnModuleDestroy
{
	static readonly identifier = PLATFORM_INGRESS_SUPERVISOR_ID;
	readonly description = "Platform Traefik ingress (one task per node, one entrypoint per lane)";

	/**
	 * Label SETUP stamps on its BOOTSTRAP ingress (a plain container that serves the
	 * wizard before the API exists). Both incarnations share the name
	 * `deployer-traefik`, so the name proves nothing — only this label does.
	 */
	private static readonly BOOTSTRAP_LABELS: Record<string, string> = { "deployer.bootstrap": "true" };

	/** How often to re-check whether setup released its bootstrap ingress. */
	private static readonly HANDOVER_POLL_MS = 3_000;
	private static readonly PROBE_TIMEOUT_MS = 3_000;

	readonly payloadSchema = traefikSupervisorPayloadSchema;
	readonly processInfoSchema = traefikProcessInfoSchema;

	private handoverRetryTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * The lanes in effect, cached because `buildSwarmSpec()` is synchronous.
	 *
	 * Seeded to local-only: a spec built before the first read publishes NOTHING on
	 * the host, which is the only safe direction to be wrong in.
	 */
	private lanes: IngressLanes = defaultIngressLanes();

	/**
	 * What the public edge asks of Traefik (published ports, who serves HTTPS),
	 * resolved with the lanes. Seeded to "nothing" for the same reason.
	 */
	private edgePlan: EdgeIngressPlan = NO_PUBLIC_EDGE;

	constructor(
		dockerService: DockerService,
		private readonly hostnameService: HostnameService,
		private readonly env: EnvService,
		private readonly lanesService: IngressLanesService,
		private readonly mesh: MeshAgentClient,
		private readonly webTarget: PlatformWebTargetService,
		private readonly edges: EdgeProviderRegistry,
	) {
		super(dockerService);
	}

	/** `MANAGED_TRAEFIK_ENABLED=true`: compose/operator owns the ingress — skip. */
	override async onModuleInit(): Promise<void> {
		if (this.isExternallyManaged()) {
			this.logger.log("Externally-managed Traefik detected (MANAGED_TRAEFIK_ENABLED=true) — supervisor skipped (not registered)");
			return;
		}
		await this.loadLanes();
		super.onModuleInit();
	}

	/** Re-read the lanes (boot and every sweep — the UI changes them at runtime). */
	async loadLanes(): Promise<void> {
		this.lanes = await this.lanesService.getLanes();
		this.edgePlan = this.edges.ingressPlan(this.lanes);
	}

	/** The public edge wants Traefik to obtain certificates itself. */
	private servesAcme(): boolean {
		return this.edgePlan.tls === "acme";
	}

	isExternallyManaged(): boolean {
		return splitManagedEnv(this.env).traefik.enabled;
	}

	/**
	 * Defer while SETUP's bootstrap ingress is still running.
	 *
	 * The bootstrap container serves the wizard on loopback until the handover
	 * releases it; the local door needs the same loopback port, and setup's handover
	 * sequence expects to promote its ingress, not to race it. `pending` is exactly
	 * "the precondition is unmet", and `scheduleHandoverRetry` converges the moment
	 * setup lets go.
	 */
	protected override async convergenceBlocker(): Promise<string | null> {
		const inherited = await super.convergenceBlocker();
		if (inherited !== null) return inherited;
		if (this.isExternallyManaged()) return null;

		if (await this.bootstrapIngressRunning()) {
			this.scheduleHandoverRetry();
			return "setup's bootstrap ingress is still serving — deferred until the handover releases it";
		}
		this.cancelHandoverRetry();
		return null;
	}

	private async bootstrapIngressRunning(): Promise<boolean> {
		try {
			const container = await this.client.getContainer(this.swarmServiceName()).inspect();
			const labels: Record<string, string> = container.Config.Labels;
			return Object.entries(TraefikSupervisorService.BOOTSTRAP_LABELS).every(([key, value]) => labels[key] === value);
		} catch {
			return false;
		}
	}

	private scheduleHandoverRetry(): void {
		if (this.handoverRetryTimer !== null) return;
		this.handoverRetryTimer = setTimeout(() => {
			this.handoverRetryTimer = null;
			void this.ensureDesiredState();
		}, TraefikSupervisorService.HANDOVER_POLL_MS);
	}

	private cancelHandoverRetry(): void {
		if (this.handoverRetryTimer === null) return;
		clearTimeout(this.handoverRetryTimer);
		this.handoverRetryTimer = null;
	}

	onModuleDestroy(): void {
		this.cancelHandoverRetry();
	}

	private async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (
			resolveSupervisorRuntime({
				managed: this.isExternallyManaged(),
				rawRuntime: process.env.SUPERVISOR_RUNTIME,
				swarmActive: await this.isSwarmActive(),
				scope: "node-local",
			})
		).runtime;
	}

	private prefix(): string {
		return this.env.get("DEPLOYER_PREFIX");
	}

	private swarmServiceName(): string {
		return platformTraefikContainerName(this.prefix());
	}

	/** The stable name the ingress dials for its routes (service alias, not a task name). */
	private apiTarget(): string {
		const explicit = this.env.get("DEPLOYER_API_TARGET")?.trim();
		return explicit !== undefined && explicit !== "" ? explicit : platformApiServiceName(this.prefix());
	}

	/** The HTTP provider endpoint every ingress task polls. */
	providerEndpoint(): string {
		return `http://${this.apiTarget()}:${String(this.env.get("API_PORT"))}/${TRAEFIK_CONFIG_PATH}`;
	}

	/**
	 * The host ports this ingress publishes.
	 *
         * ── THE ENTRY PORT IS NOT PUBLISHED, BECAUSE THE DOOR OWNS IT ─────────
         * This used to publish `lanes.entryPort` on the host in `host` mode with the
         * reasoning that promotion "must keep the port" or the platform becomes
         * unreachable. The premise is right; the owner is wrong.
         *
         * The documented architecture puts a per-node **door** in front of Traefik:
         *
         *   deployer-door-local  → 127.0.0.1:<entryPort>  → deployer-traefik:80 (overlay)
         *   deployer-door-lan / -private → <that address>:<entryPort> → same
         *
         * The door is a plain nginx container owned by the mesh agent, and it binds
         * the host entry port. Traefik listens on `:80` INSIDE its container and is
         * reached by overlay name — that is what `LANE_ENTRYPOINTS.local.port = 80`
         * means, and what the door's `proxy_pass http://deployer-traefik:80` does.
         *
         * Publishing the same host port from the swarm service therefore makes TWO
         * owners of one port, and the swarm task can never start:
         *
         *   starting container failed: … Bind for 127.0.0.1:80 failed:
         *   port is already allocated
         *
         * which retried forever while the handover reported "the swarm ingress took
         * the entry port but is not routing the API yet". Measured on the affected
         * node: `deployer-door-local` held `127.0.0.1:80`, `deployer-door-lan` held
         * `192.168.1.27:80`, and `deployer-traefik` had `PublishMode: host` on 80.
         *
         * So the entry port is published by the DOOR, not here. This method now
         * returns only the ACKNOWLEDGED public edge (`direct`), which is the one case
         * where an operator has explicitly taken inbound `:80`/`:443` for Traefik
         * itself — and in that configuration the doors are not what serves the port.
         */
        private edgePorts(): SwarmEndpointPort[] {
                const ports: SwarmEndpointPort[] = [];

                // The local lane deliberately contributes NO host port: the door binds the
                // entry port and forwards to Traefik on the overlay. See the method note.

                for (const port of this.edgePlan.publishedPorts) {
                        ports.push({
                                protocol: "tcp",
                                publishedPort: port.published,
                                targetPort: port.entrypoint === "public" ? LANE_ENTRYPOINTS.public.port : LANE_ENTRYPOINTS.publicTls.port,
                                publishMode: "host",
                        });
                }

                return ports;
        }

        /**
         * Desired SWARM spec: GLOBAL (one task per node), no socket, no config volume.
         *
         * The flags are `args`, not `command`: `command` replaces the image's
         * ENTRYPOINT (`/entrypoint.sh`) and every task would die at init trying to exec
         * `--providers...` as a binary.
         */
        protected buildSwarmSpec(): SwarmServiceSpecInput {
		const tls = this.servesAcme();
		const args = [
			`--providers.http.endpoint=${this.providerEndpoint()}`,
			`--providers.http.pollInterval=${PROVIDER_POLL_INTERVAL}`,
			`--providers.http.pollTimeout=${PROVIDER_POLL_INTERVAL}`,
			`--providers.http.headers.${INGRESS_TOKEN_HEADER}=${deriveIngressProviderToken(requireIngressSecret(this.env.get("AUTH_SECRET"), this.env.get("BETTER_AUTH_SECRET")))}`,
			`--entrypoints.${LANE_ENTRYPOINTS.local.name}.address=:${String(LANE_ENTRYPOINTS.local.port)}`,
			`--entrypoints.${LANE_ENTRYPOINTS.private.name}.address=:${String(LANE_ENTRYPOINTS.private.port)}`,
			`--entrypoints.${LANE_ENTRYPOINTS.public.name}.address=:${String(LANE_ENTRYPOINTS.public.port)}`,
			...(tls
				? [
						`--entrypoints.${LANE_ENTRYPOINTS.publicTls.name}.address=:${String(LANE_ENTRYPOINTS.publicTls.port)}`,
						`--entrypoints.${LANE_ENTRYPOINTS.public.name}.http.redirections.entrypoint.to=${LANE_ENTRYPOINTS.publicTls.name}`,
						`--entrypoints.${LANE_ENTRYPOINTS.public.name}.http.redirections.entrypoint.scheme=https`,
						`--entrypoints.${LANE_ENTRYPOINTS.public.name}.http.redirections.entrypoint.permanent=true`,
						// A real certificate, not Traefik's self-signed default. HTTP-01 is
						// answered on `public`, which an ACME edge publishes as :80.
						`--certificatesresolvers.${TRAEFIK_ACME_RESOLVER}.acme.email=${this.env.get("DEPLOYER_TRAEFIK_ACME_EMAIL")}`,
						`--certificatesresolvers.${TRAEFIK_ACME_RESOLVER}.acme.storage=${TRAEFIK_ACME_STORAGE_PATH}`,
						`--certificatesresolvers.${TRAEFIK_ACME_RESOLVER}.acme.httpchallenge.entrypoint=${LANE_ENTRYPOINTS.public.name}`,
					]
				: []),
		];
		const endpointPorts = this.edgePorts();

		return {
			name: this.swarmServiceName(),
			image: this.env.get("DEPLOYER_TRAEFIK_IMAGE"),
			mode: "global",
			replicas: 1,
			env: [],
			command: [],
			args,
			labels: {
				[PLATFORM_ROLE_LABEL]: PLATFORM_INGRESS_ROLE,
				"deployer.platform.api-hostname": this.hostnameService.apiHostname(),
				"deployer.ingress.lanes": enabledLanes(this.lanes).join(","),
			},
			containerLabels: {},
			mounts: tls
				? [{ type: "volume" as const, source: TRAEFIK_ACME_VOLUME, target: TRAEFIK_ACME_STORAGE_MOUNT, readOnly: false }]
				: [],
			placementPreferences: [],
			// Every node: each one serves its own doors, so each needs a local task.
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			healthcheck: null,
			// A host-mode port can be held by ONE task per node, so an inbound-edge ingress
			// must give its ports up before the replacement can take them.
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
	}

	/** Converge the ingress service; an inbound-edge port conflict is fatal and explained. */
	private async reconcileSwarm(): Promise<SwarmServiceSpecInput> {
		const spec = this.buildSwarmSpec();
		try {
			if (this.servesAcme()) await this.ensureVolume(TRAEFIK_ACME_VOLUME);
			const overlay = await this.ensureSwarmNetwork(PlatformNetwork.name(this.prefix()));
			this.attachOverlay(spec, overlay, [spec.name]);
			await this.reconcileSwarmService(spec);
			await this.connectSelfToOverlay(overlay);
		} catch (startError) {
			if (!this.isPortBindError(startError)) throw startError;
			this.logger.warn("A node already binds :80/:443 — the inbound public edge cannot start (ingress DEGRADED)");
			await this.removeSwarmServiceIfExists(spec.name);
			throw new EntryPortConflictError(80);
		}
		return spec;
	}

	/** Attach THIS API container to the platform overlay. No-op outside Docker. */
	private async connectSelfToOverlay(overlay: string): Promise<void> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return;
		await this.client.getNetwork(overlay).connect({ Container: selfId }).catch(() => undefined);
	}

	protected async reconcile(): Promise<void> {
		await this.loadLanes();
		const runtime = await this.effectiveRuntime();

		if (runtime === "managed") {
			await this.connectSelfToOverlay(platformOverlayForPrefix(this.prefix())).catch(() => undefined);
			return;
		}
		if (runtime === "unavailable") {
			throw new Error(
				"Platform ingress requires an active swarm engine or managed (compose/operator) ownership — " +
					"no legacy container fallback. SwarmBootstrapService should have converged the engine.",
			);
		}

		await this.runWithBackoff(
			"Platform ingress convergence",
			async () => {
				this.logger.log(`Ingress lanes — ${enabledLanes(this.lanes).join(" + ")}; routes from ${this.providerEndpoint()}`);
				const spec = await this.reconcileSwarm();
				await this.verifySwarmConvergence(spec);
				await this.publishNodeDoors();
				await this.removeLegacyForwarder();
			},
			{ maxAttempts: 5 },
		);
	}

	/**
	 * Publish the doors plan into the replicated roster.
	 *
	 * Every node's agent converges its own doors from it, so this one write reaches
	 * every node — including ones this API cannot reach directly. A no-op when the
	 * plan did not change (the agent skips identical writes).
	 */
	private async publishNodeDoors(): Promise<void> {
		const prefix = this.prefix();
		const doors = buildNodeDoors({
			lanes: this.lanes,
			namePrefix: prefix === "" ? "deployer" : `deployer-${prefix}`,
			network: platformOverlayForPrefix(prefix),
			image: this.env.get("DEPLOYER_DOOR_IMAGE"),
			traefikService: this.swarmServiceName(),
			rescue: await this.rescueRoutes(),
		});
		try {
			await this.mesh.writeSetting(NODE_DOORS_SETTING_KEY, doors);
		} catch (error) {
			// The ingress itself is up; without the doors only the loopback/mesh
			// listeners are missing. Report it rather than fail the convergence.
			this.logger.warn(`Node doors not published (${error instanceof Error ? error.message : String(error)}) — the local lane has no listener yet`);
		}
	}

	/** The console hosts the local door serves directly when Traefik does not answer. */
	private async rescueRoutes(): Promise<DoorRescueRoute[]> {
		const routes: DoorRescueRoute[] = [
			{ host: this.hostnameService.apiHostname(), target: this.apiTarget(), port: this.env.get("API_PORT") },
		];
		const web = await this.webTarget.resolveWebTarget().catch(() => null);
		if (web !== null) routes.push({ host: this.hostnameService.webHostname(), target: web, port: PLATFORM_WEB_INTERNAL_PORT });
		return routes;
	}

	/**
	 * Remove the API-owned loopback forwarder the agent's local door replaced.
	 *
	 * It holds 127.0.0.1:<entry port> with a restart policy, so a node upgraded in
	 * place would otherwise keep it forever and the door could never bind.
	 */
	private async removeLegacyForwarder(): Promise<void> {
		try {
			const container = this.client.getContainer(LEGACY_FORWARDER_CONTAINER);
			await container.inspect();
			await container.remove({ force: true });
			this.logger.log(`Removed the legacy ${LEGACY_FORWARDER_CONTAINER} — the mesh agent's local door replaces it`);
		} catch {
			// absent: nothing to clean up
		}
	}

	private async verifySwarmConvergence(spec: SwarmServiceSpecInput): Promise<void> {
		const service = await this.dockerService.inspectSwarmService(spec.name);
		if (service.ID === "") throw new Error(`platform ingress swarm service '${spec.name}' was not created`);
		const tasks = await this.dockerService.listSwarmServiceTasks(spec.name).catch(() => []);
		if (tasks.length > 0 && tasks.every((task) => task.Status.State !== "running")) {
			throw new Error(`platform ingress swarm service '${spec.name}' has no running task`);
		}
	}

	protected isFatalConvergenceError(error: unknown): boolean {
		return error instanceof EntryPortConflictError;
	}

	private isPortBindError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return (
			message.includes("address already in use") ||
			message.includes("port is already allocated") ||
			message.includes("failed to bind host port") ||
			message.includes("bind: address")
		);
	}

	/**
	 * Health: the local task runs and its `local` entrypoint answers. Another node
	 * being down must not make THIS node's ingress unhealthy.
	 */
	protected async probe(): Promise<SupervisorProbeResult<typeof traefikSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const spec = this.buildSwarmSpec();
		const localTask = await this.localServiceTask(spec.name);
		const service =
			localTask === null
				? null
				: {
						serviceId: localTask.serviceId,
						exists: true,
						createdAt: null,
						updatedAt: null,
						serviceName: spec.name,
						runningTasks: localTask.state === "running" ? 1 : 0,
						totalTasks: 1,
					};

		const entrypoint = await this.probeEntrypoint(this.resolveProbeCandidates(spec.name), LANE_ENTRYPOINTS.local.port);

		let healthy: boolean;
		let detail: string;
		if (service === null) {
			healthy = false;
			detail = "ingress swarm service missing on this node";
		} else if (service.runningTasks === 0) {
			healthy = false;
			detail = `ingress task not running on this node (state=${localTask?.state ?? "unknown"})`;
		} else if (!entrypoint.reachable) {
			healthy = false;
			detail = `ingress running but its local entrypoint is unreachable (${entrypoint.host})`;
		} else {
			healthy = true;
			detail = `serving ${enabledLanes(this.lanes).join(" + ")} via ${entrypoint.host} (HTTP ${String(entrypoint.statusCode ?? "?")})`;
		}

		return {
			healthy,
			detail,
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				service,
				entrypoint,
				config: this.configView(),
			},
		};
	}

	private configView(): z.output<typeof traefikSupervisorPayloadSchema>["config"] {
		return {
			apiHostname: this.hostnameService.apiHostname(),
			providerEndpoint: this.providerEndpoint(),
			lanes: enabledLanes(this.lanes),
		};
	}

	private async localServiceTask(serviceName: string): Promise<{ serviceId: string | null; state: string } | null> {
		try {
			const service = await this.dockerService.inspectSwarmService(serviceName);
			const tasks = await this.dockerService.listSwarmServiceTasks(serviceName).catch(() => []);
			const selfNodeId = await this.selfNodeId();
			const local = selfNodeId === null ? tasks[0] : tasks.find((task) => task.NodeID === selfNodeId);
			if (local === undefined) return null;
			return { serviceId: service.ID ?? null, state: local.Status.State };
		} catch {
			return null;
		}
	}

	private async selfNodeId(): Promise<string | null> {
		try {
			const info = await this.dockerService.getSwarmInfo();
			return info.NodeID === "" ? null : info.NodeID;
		} catch {
			return null;
		}
	}

	protected buildDegradedPayload(_detail: string): z.output<typeof traefikSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			service: null,
			entrypoint: null,
			config: this.configView(),
		};
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const port = this.lanes.entryPort;
		const origin = this.hostnameService.webOrigin();
		return {
			process: await this.describeSwarmProcess(this.buildSwarmSpec()),
			entry: { port, isDefault80: port === 80 },
			urls: {
				entryUrl: port === 80 ? origin : `${origin}:${String(port)}`,
				apiUrl: this.hostnameService.apiOrigin(),
				webUrl: origin,
			},
			config: { providerEndpoint: this.providerEndpoint(), lanes: enabledLanes(this.lanes) },
		};
	}

	private runsInsideContainer(): boolean {
		const hostname = process.env.HOSTNAME;
		if (hostname !== undefined && /^[0-9a-f]{12,64}$/.test(hostname)) return true;
		return existsSync("/.dockerenv");
	}

	/**
	 * Candidate hosts for the entrypoint probe, best-first: this node's ingress task
	 * by name on the overlay, then the host's addresses (bare-metal dev).
	 */
	private resolveProbeCandidates(serviceName: string): string[] {
		const candidates: string[] = [];
		if (this.runsInsideContainer()) candidates.push(serviceName);
		candidates.push("host.docker.internal");
		const gateway = resolveDockerHostIp();
		if (gateway !== "127.0.0.1" && gateway !== "0.0.0.0") candidates.push(gateway);
		candidates.push("127.0.0.1");
		return [...new Set(candidates)];
	}

	private async probeEntrypoint(candidates: string[], port: number): Promise<EntrypointProbe> {
		for (const host of candidates) {
			const started = Date.now();
			const attempt = await this.probeHost(host, port);
			if (attempt.reachable) return { ...attempt, host, port, latencyMs: Date.now() - started };
		}
		return { reachable: false, host: candidates.join(" / "), port, statusCode: null, latencyMs: null };
	}

	private probeHost(host: string, port: number): Promise<Omit<EntrypointProbe, "host" | "port" | "latencyMs">> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value: Omit<EntrypointProbe, "host" | "port" | "latencyMs">): void => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			const req = http.get({ host, port, path: "/", timeout: TraefikSupervisorService.PROBE_TIMEOUT_MS }, (res) => {
				res.resume();
				finish({ reachable: true, statusCode: res.statusCode ?? null });
			});
			req.on("timeout", () => {
				req.destroy();
				finish({ reachable: false, statusCode: null });
			});
			req.on("error", () => {
				finish({ reachable: false, statusCode: null });
			});
		});
	}
}

/** Namespace for platform network naming. */
export const PlatformNetwork = {
	/** Deterministic network name; isolated per DEPLOYER_PREFIX instance. */
	name(prefix: string): string {
		return prefix === "" ? "deployer-platform" : `deployer-platform-${prefix}`;
	},
};
