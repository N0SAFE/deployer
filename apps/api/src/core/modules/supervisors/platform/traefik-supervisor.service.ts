/**
 * TraefikSupervisorService — supervises the platform Traefik ingress container.
 *
 * Extends BaseDockerSupervisorService: desired state is a single Traefik
 * container ("always running"), converged idempotently with backoff. Auto-
 * registers into the SupervisorOrchestratorService via the base class — this
 * file contains zero registration code.
 *
 * Convergence failures degrade gracefully — the API stays reachable by port to
 * fix its own infrastructure.
 */

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import http from "node:http";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import z from "zod/v4";

import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { PlatformPaths } from "../../platform-ingress/services/platform-paths";
import { PlatformIngressSettingsService } from "../../platform-ingress/services/platform-ingress-settings.service";
import { platformTraefikContainerName } from "../../platform-ingress/services/platform-names";
import { BaseDockerSupervisorService } from "@repo/nest-docker/services/base-docker-supervisor.service";
import {
	platformOverlayForPrefix,
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@repo/nest-docker/services/docker-supervisor-runtime";
import type { SwarmEndpointPort, SwarmServiceSpecInput } from "@repo/contracts-entities";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
	type SupervisorState,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	swarmProcessInfoSchema,
} from "@repo/nest-supervisor-core/supervisor-process-info";
import { EnvService } from "@/config/env/env.module";
import { splitManagedEnv } from "@repo/env";
import { resolveDockerHostIp } from "@repo/nest-docker/services/docker-host-address";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
export const PLATFORM_ROLE_LABEL = "deployer.platform.role";
export const PLATFORM_INGRESS_ROLE = "ingress";

export const PLATFORM_INGRESS_SUPERVISOR_ID = "platform-ingress-traefik";

/**
 * Zod schema of the rich health payload this supervisor reports. Real
 * measurements: container state + disk sizes, entrypoint HTTP probe
 * (status code + latency) and dynamic-config file size. `null` marks a
 * measurement that could not be obtained (container missing, probe failed).
 */
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
		configDir: z.string(),
		dynamicApiFile: z.string(),
		fileSizeBytes: z.number().int().min(0).nullable(),
	}),
});
export type TraefikSupervisorPayload = z.output<typeof traefikSupervisorPayloadSchema>;

export interface EntrypointProbe {
	reachable: boolean;
	host: string;
	port: number;
	statusCode: number | null;
	latencyMs: number | null;
}

/**
 * Process info reported by the Traefik supervisor through `getProcessInfo()`
 * — the entire config + live state of the ingress process plus how to reach
 * it (entry port, entry/api/web URLs) and the dynamic-config locations.
 */
export const traefikProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	entry: z.object({
		/** Configured entry port the ingress publishes (default 80). */
		port: z.number().int().min(1),
		/** True when the port is the default 80 (global domains / plain DNS work). */
		isDefault80: z.boolean(),
		/** Where the value came from: the local settings DB or the env default. */
		source: z.enum(["local-db", "env", "default"]),
	}),
	urls: z.object({
		/** Host-side entry URL (null when headless — no host binding). */
		entryUrl: z.string().nullable(),
		/** HTTP origin of the API behind the ingress. */
		apiUrl: z.string(),
		/** HTTP origin of the web app behind the ingress. */
		webUrl: z.string(),
	}),
	config: z.object({
		/** Host directory holding the builder-generated dynamic configs. */
		configDir: z.string(),
		/** Absolute path of the generated API routing file. */
		dynamicApiFile: z.string(),
	}),
});
export type TraefikProcessInfo = z.output<typeof traefikProcessInfoSchema>;

/** Mount point of the shared config volume inside the Traefik container. */
export const TRAEFIK_CONFIG_MOUNT = "/config";

/**
 * Name of the ACME certificate resolver declared in the ingress's static args.
 *
 * Exported because the ROUTES must reference the SAME name: a router that asks
 * for a resolver which does not exist gets Traefik's self-signed default
 * certificate instead of a real one, and that failure is silent — the route
 * works, it is just untrusted. Keeping the name in one place is what stops the
 * two from drifting.
 */
export const TRAEFIK_ACME_RESOLVER = "letsencrypt";

/** Where the ACME account + issued certificates are persisted. */
export const TRAEFIK_ACME_STORAGE_MOUNT = "/acme";
export const TRAEFIK_ACME_STORAGE_PATH = `${TRAEFIK_ACME_STORAGE_MOUNT}/acme.json`;

/**
 * Named volume holding the ACME state, mounted per node.
 *
 * `local` driver, like the config volume, and that is sufficient here for a
 * different reason than the config volume's: ACME state is a CACHE, not a
 * source of truth. Two nodes each obtaining their own certificate for the same
 * hostname is wasteful but correct, whereas a missing one triggers a fresh
 * order on every restart — which Let's Encrypt rate-limits. So the volume
 * exists to avoid re-ordering, and a node that loses it simply re-orders once.
 */
export const TRAEFIK_ACME_VOLUME = "deployer-traefik-acme";

/** Sentinel thrown when the ENTRY PORT is already bound — the backoff will NOT
 *  retry it (deterministic config conflict). The supervisor goes DEGRADED and
 *  the web must pick a free entry port instead. */
export class EntryPortConflictError extends Error {
	readonly port: number;
	constructor(port: number) {
		super(`entry port ${String(port)} is already in use`);
		this.name = "EntryPortConflictError";
		this.port = port;
	}
}

@Injectable()
export class TraefikSupervisorService
	extends BaseDockerSupervisorService<
		typeof traefikSupervisorPayloadSchema,
		typeof traefikProcessInfoSchema
	>
	implements OnModuleDestroy
{
	static readonly identifier = PLATFORM_INGRESS_SUPERVISOR_ID;
	readonly description = "Platform Traefik ingress routing api.<prefix>deployer.localhost";

	/** Container label recording the desired entry port (recreate-on-change). */
	static readonly ENTRY_PORT_LABEL = "deployer.ingress.entry-port";

	/**
	 * Label SETUP stamps on its BOOTSTRAP ingress (State A — a plain container).
	 *
	 * This is the ONLY reliable way to tell "the ingress running right now is the
	 * one setup runs" from "the ingress running right now is ours": both
	 * incarnations share the container/service name `deployer-traefik` on
	 * purpose (see `BootstrapIngressService` — the promotion must not move a
	 * name or a port), so the name proves nothing.
	 */
	private static readonly BOOTSTRAP_LABELS: Record<string, string> = {
		"deployer.bootstrap": "true",
	};

	/** How often to re-check whether setup released the entry port. */
	private static readonly HANDOVER_POLL_MS = 3_000;

	readonly payloadSchema = traefikSupervisorPayloadSchema;
	readonly processInfoSchema = traefikProcessInfoSchema;

	private static readonly PROBE_TIMEOUT_MS = 3_000;
	private static readonly SETTLE_WINDOW_MS = 3_000;

	/** Deferred-convergence poll timer (see `scheduleHandoverRetry`). */
	private handoverRetryTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(
		dockerService: DockerService,
		private readonly hostnameService: HostnameService,
		private readonly env: EnvService,
		private readonly settings: PlatformIngressSettingsService,
	) {
		super(dockerService);
	}

	/**
	 * Externally-managed Traefik: `MANAGED_TRAEFIK_ENABLED=true` means the
	 * deployment (compose/operator) owns the ingress container — this
	 * supervisor skips spawning and consumers reach the already-managed
	 * Traefik through `managed.traefik.*` (host/ports). The route config
	 * generation (platform-routes-source) still feeds the MANAGED traefik's
	 * file provider.
	 */
	override async onModuleInit(): Promise<void> {
		if (this.isExternallyManaged()) {
			this.logger.log("Externally-managed Traefik detected (MANAGED_TRAEFIK_ENABLED=true) — supervisor skipped (not registered)");
			return;
		}
		super.onModuleInit();
	}

	/** True when the deployment owns the Traefik ingress (compose/operator). */
	isExternallyManaged(): boolean {
		return splitManagedEnv(this.env).traefik.enabled === true;
	}

	/**
	 * Refuse to converge while SETUP still owns the entry port.
	 *
	 * ── THE FAILURE THIS PREVENTS (observed, not theoretical) ────────────────
	 * The ingress runs in two incarnations (see `BootstrapIngressService`): a
	 * plain container setup runs BEFORE the gate opens (State A), and this
	 * supervisor's GLOBAL swarm service AFTER the handover (State B). Both bind
	 * the SAME host port by design.
	 *
	 * Because a swarm CREATE succeeds even when the port is taken — the bind
	 * happens later, when the task is scheduled — this supervisor used to create
	 * the service anyway, and every task then died in a ~5s loop:
	 *
	 *   fatal task error: starting container failed: failed to set up container
	 *   networking: endpoint join on GW Network failed: Bind for 0.0.0.0:80
	 *   failed: port is already allocated
	 *
	 * Each failed JOIN damaged `deployer-platform-overlay`'s NetworkDB, tearing
	 * down the sandbox veths of EVERY container on it:
	 *
	 *   deleteServiceInfoFromCluster NetworkDB DeleteEntry failed ... cannot
	 *   delete entry overlay_peer_table ... already being deleted
	 *
	 * The result was far worse than a degraded ingress: the overlay dataplane
	 * went dead, so the API could no longer reach Postgres (`ECONNREFUSED
	 * 10.0.1.8:5432`) and setup could not reach the API — the operator saw
	 * "The platform API is not reachable yet" AFTER a fully successful wizard.
	 *
	 * Deferring is what the base class is for: `pending` means the precondition
	 * is unmet, which is exactly true here. Setup releases the port during the
	 * handover, and `scheduleHandoverRetry()` converges the moment it does — so
	 * this is a "not yet", never a "never".
	 */
	protected override async convergenceBlocker(): Promise<string | null> {
		const inherited = await super.convergenceBlocker();
		if (inherited !== null) return inherited;

		// A deployment-owned ingress is not ours to create at all.
		if (this.isExternallyManaged()) return null;

		if (await this.bootstrapIngressOwnsEntryPort()) {
			this.scheduleHandoverRetry();
			return "setup's bootstrap ingress owns the entry port — deferred until the handover releases it";
		}

		this.cancelHandoverRetry();

		return null;
	}

	/**
	 * True when setup's bootstrap ingress container is currently running.
	 *
	 * Matched on setup's OWN label rather than on the name, because both
	 * incarnations are named `deployer-traefik` — the name can only tell us a
	 * container exists, not WHOSE it is. Setup is the only writer of
	 * `deployer.bootstrap=true`, and it stamps the label at creation, so its
	 * presence is proof that the port has not been released yet.
	 */
	private async bootstrapIngressOwnsEntryPort(): Promise<boolean> {
		const name = this.swarmServiceName();
		try {
			const container = await this.client.getContainer(name).inspect();
			const labels: Record<string, string> = container.Config.Labels;
			return Object.entries(TraefikSupervisorService.BOOTSTRAP_LABELS).every(
				([key, value]) => labels[key] === value,
			);
		} catch {
			// Absent (404) or an engine hiccup: not a handover, so let the normal
			// convergence path run and report whatever it finds.
			return false;
		}
	}

	/**
	 * Re-converge shortly after a deferred handover.
	 *
	 * Needed because NOTHING else wakes this supervisor up: it has no cadence of
	 * its own (`TraefikConfigRefresher` fires on boot and operator actions), and
	 * setup's release of the port is not a docker event this process listens for.
	 * Without this poll the ingress would stay `pending` until an unrelated
	 * operator action re-converged it — i.e. the platform would come up with no
	 * ingress at all after a successful handover.
	 *
	 * Chained timeouts rather than `setInterval`, so a slow convergence can never
	 * stack passes (the same pattern as `SwarmAppWiringSupervisorService`).
	 */
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

	/**
	 * Resolve the runtime. Ingress is NODE-LOCAL → `swarm-global` (one task per
	 * node), `managed` when compose/operator owns it, and `unavailable` when the
	 * engine is not a swarm member (no container fallback — see
	 * `resolveSupervisorRuntime`).
	 */
	private async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (
			await resolveSupervisorRuntime({
				managed: this.isExternallyManaged(),
				rawRuntime: process.env.SUPERVISOR_RUNTIME,
				swarmActive: await this.isSwarmActive(),
				scope: "node-local",
			})
		).runtime;
	}

	/** Swarm service name — one GLOBAL task per node (node-local ingress). */
	private swarmServiceName(): string {
		return platformTraefikContainerName(this.env.get("DEPLOYER_PREFIX"));
	}

	/**
	 * Desired SWARM spec for the platform ingress.
	 *
	 * GLOBAL mode: every node publishes its own entry ports and routes for the
	 * tasks scheduled on it — the single-node case is identical (one task), so
	 * there is one code path for every fleet size.
	 *
	 * `PublishMode: host` is required, not cosmetic: with the default ingress
	 * mode a global service is rejected by the engine (the routing-mesh load
	 * balancer cannot front one task per node), and bind failures for a taken
	 * port must be reported per node rather than silently load balanced.
	 */
	protected buildSwarmSpec(hostPort: number | null | undefined = undefined): SwarmServiceSpecInput {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const socketPath = this.env.get("DOCKER_HOST")?.replace("unix://", "") ?? "/var/run/docker.sock";
		const isProduction = this.env.get("NODE_ENV") === "production";
		const port =
			hostPort === null
				? undefined
				: hostPort !== undefined
					? hostPort
					: isProduction
						? undefined
						: this.env.get("DEPLOYER_TRAEFIK_HTTP_PORT");

		const tlsEnabled = this.env.get("DEPLOYER_TRAEFIK_TLS_ENABLED") === true;
		// Traefik v3 SPLIT the docker provider in two, and passing the v2 option
		// PREVENTS TRAEFIK FROM STARTING:
		//
		//   Docker provider — containers only, NO swarm support
		//   Swarm provider  — swarm services only
		//
		// The v2 `--providers.docker.swarmMode=true` is not merely deprecated: the
		// v3 migration guide states that leaving it in place "would prevent Traefik
		// to start" ("Install Configuration Changes → SwarmMode"). So the workloads
		// below are published through the SWARM provider, and the DOCKER provider
		// stays enabled for plain containers — a platform node can legitimately have
		// both, e.g. a host-run dev sidecar beside swarm-scheduled services.
		const command = [
			"--providers.docker=true",
			"--providers.docker.exposedbydefault=false",
			"--providers.swarm=true",
			"--providers.swarm.exposedbydefault=false",
			"--providers.file.directory=/config",
			"--providers.file.watch=true",
			"--entrypoints.web.address=:80",
			...(tlsEnabled
				? [
						"--entrypoints.websecure.address=:443",
						"--entrypoints.web.http.redirections.entrypoint.to=websecure",
						"--entrypoints.web.http.redirections.entrypoint.scheme=https",
						"--entrypoints.web.http.redirections.entrypoint.permanent=true",
						// ── A REAL CERTIFICATE RESOLVER, NOT JUST A 443 SOCKET ───────
						// Enabling TLS used to add the entrypoint and the redirect and
						// stop there, so every HTTPS request was answered with Traefik's
						// built-in SELF-SIGNED certificate. Browsers warn, and an edge
						// that fronts this on a real domain (Cloudflare tunnel, or DNS
						// pointed at the node) cannot complete a valid connection.
						//
						// The resolver is what actually obtains a certificate. It is
						// declared HERE rather than in a static file because these args
						// ARE this ingress's static configuration — there is no
						// `traefik.yml` in the container, so a resolver defined anywhere
						// else would never be read.
						//
						// HTTP-01 is the challenge type because it needs only port 80,
						// which every mode already publishes (the tunnel connects
						// outbound but Cloudflare still reaches the origin over the
						// tunnel for the challenge). Storage is mounted below and MUST
						// persist: Traefik re-requests a certificate on every start if
						// `acme.json` is missing, and Let's Encrypt rate-limits that.
						`--certificatesresolvers.${TRAEFIK_ACME_RESOLVER}.acme.email=${this.env.get("DEPLOYER_TRAEFIK_ACME_EMAIL")}`,
						`--certificatesresolvers.${TRAEFIK_ACME_RESOLVER}.acme.storage=${TRAEFIK_ACME_STORAGE_PATH}`,
						`--certificatesresolvers.${TRAEFIK_ACME_RESOLVER}.acme.httpchallenge.entrypoint=web`,
					]
				: []),
		];

		// ── THESE ARE `args`, NOT `command` ─────────────────────────────────
		// `toDockerServiceSpec` maps `command` → Docker's `Command`, which
		// REPLACES the image's ENTRYPOINT. The Traefik image has
		//
		//   Entrypoint: ["/entrypoint.sh"]
		//   Cmd:        ["traefik"]
		//
		// so putting the flags in `command` discarded `/entrypoint.sh` and asked
		// the engine to exec `--providers.docker=true` directly. Every task died
		// at container init:
		//
		//   exec: "--providers.docker=true": executable file not found
		//
		// leaving the ingress at 0/0, readiness reporting
		// `platform-ingress-traefik: degraded — ingress task not up`, and the
		// handover failing after its 300s budget.
		//
		// `args` maps to Docker's `Args`, which is APPENDED to the image's CMD —
		// exactly what compose's `command:` does for the working compose-managed
		// ingress, so both incarnations of the ingress now start the same way.

		const endpointPorts: SwarmEndpointPort[] = [];
		if (port !== undefined) {
			endpointPorts.push({ protocol: "tcp", publishedPort: port, targetPort: 80, publishMode: "host" });
		}
		if (tlsEnabled) {
			endpointPorts.push({ protocol: "tcp", publishedPort: 443, targetPort: 443, publishMode: "host" });
		}

		return {
			name: this.swarmServiceName(),
			image: this.env.get("DEPLOYER_TRAEFIK_IMAGE"),
			mode: "global",
			replicas: 1,
			env: [],
			// NOT `command`: that would replace the image's ENTRYPOINT and the task
			// would die at container init (see the note above).
			command: [],
			args: command,
			labels: {
				[PLATFORM_ROLE_LABEL]: PLATFORM_INGRESS_ROLE,
				"deployer.platform.api-hostname": this.hostnameService.apiHostname(),
				...(tlsEnabled ? { "deployer.traefik.tls": "enabled" } : {}),
				// Record the desired ENTRY PORT — the reconcile compares this
				// label to re-converge when the web changes it.
				...(port !== undefined ? { [TraefikSupervisorService.ENTRY_PORT_LABEL]: String(port) } : {}),
			},
			containerLabels: {},
			mounts: [
				{ type: "bind", source: socketPath, target: "/var/run/docker.sock", readOnly: true },
				{ type: "volume", source: this.traefikConfigVolume(), target: TRAEFIK_CONFIG_MOUNT, readOnly: true },
				// ── ACME STATE MUST PERSIST, AND ONLY WITH TLS ON ──────────────
				// `acme.json` holds the Let's Encrypt account key and every issued
				// certificate. Traefik RE-ORDERS on every start when it is missing,
				// and Let's Encrypt rate-limits failed/duplicate orders, so a
				// forgotten volume turns a restart loop into a lockout.
				//
				// Mounted only when TLS is on: without a resolver nothing writes
				// there, and an unused volume on every node is noise.
				...(tlsEnabled
					? [{ type: "volume" as const, source: TRAEFIK_ACME_VOLUME, target: TRAEFIK_ACME_STORAGE_MOUNT, readOnly: false }]
					: []),
			],
			placementPreferences: [],
			// Node-local ingress only makes sense where routing is desired.
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			healthcheck: null,
			// ── `stop-first` WHEN THE ENTRY PORT IS PUBLISHED IN HOST MODE ──────
			// `endpointPorts` publishes the entry port with `publishMode: "host"`
			// (see the block above), and a host-mode port can be held by exactly
			// ONE task on a node. `start-first` starts the replacement BEFORE
			// stopping the old task, so the new one can never bind:
			//
			//   "no suitable node (host-mode port already in use on 1 node)"
			//
			// leaving the ingress at 0/0 and the platform unreachable.
			//
			// The ORDER therefore has to follow the PUBLISH MODE, not a blanket
			// preference: ingress-published services (the API) keep `start-first`
			// for zero-downtime rollouts, while a host-bound one must give the
			// port up first.
			updateConfig: {
				parallelism: 1,
				delayMs: 0,
				order: endpointPorts.some((p) => p.publishMode === "host") ? "stop-first" : "start-first",
				failureAction: "rollback",
			},
			stopGracePeriodSeconds: 10,
			endpointPorts,
			// The ingress is reached on the HOST entry port (or by container name for
			// the setup handover) — never through a swarm VIP on the overlay.
			endpointMode: "dnsrr",
		};
	}

	/**
	 * Swarm-global convergence: ensure the overlay + config volume exist, then
	 * idempotently converge the ingress service.
	 *
	 * A bind failure on the entry port means the port is taken ON SOME NODE.
	 * The service is removed (so no partial/looping state is left) and the
	 * deterministic `EntryPortConflictError` is thrown — the backoff will not
	 * retry it, and the web surfaces the conflict so the operator can pick a
	 * free port.
	 */
	private async reconcileSwarm(desiredPort: number | null | undefined): Promise<void> {
		const spec = this.buildSwarmSpec(desiredPort);
		try {
			await this.ensureVolume(this.traefikConfigVolume());
			// The ACME volume must exist BEFORE the service references it, or the
			// task fails to start on a node that never created it — the same
			// "volume does not exist" class as the config volume. Only when TLS is
			// on, matching the conditional mount.
			if (this.env.get("DEPLOYER_TRAEFIK_TLS_ENABLED")) {
				await this.ensureVolume(TRAEFIK_ACME_VOLUME);
			}
			const overlay = await this.ensureSwarmNetwork(PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX")));
			this.attachOverlay(spec, overlay, [spec.name]);
			await this.reconcileSwarmService(spec);
			await this.connectSelfToOverlay(overlay);
		} catch (startError) {
			if (!this.isPortBindError(startError)) throw startError;
			this.logger.warn(`Entry port ${String(desiredPort ?? "-")} unavailable — Traefik DEGRADED`);
			await this.removeSwarmServiceIfExists(spec.name);
			throw new EntryPortConflictError(desiredPort ?? 80);
		}
	}

	/** Attach THIS API container to the platform overlay (bridge head between
	 *  the compose-managed and swarm planes). No-op outside Docker. */
	private async connectSelfToOverlay(overlay: string): Promise<void> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return;
		await this.client.getNetwork(overlay).connect({ Container: selfId }).catch(() => undefined);
	}

	/**
	 * One idempotent convergence pass: resolve the ENTRY PORT (local settings,
	 * default 80) → network → attach API → write routes → converge → verify.
	 *
	 * ENTRY-PORT SEMANTICS:
	 *    - Desired host port comes from the local settings (entry port), NOT a
	 *      silent auto-headless fallback. Default is 80.
	 *    - When the port is unavailable (already bound), the reconcile THROWS
	 *      → the supervisor is marked DEGRADED (an ERROR the web can see).
	 *      The web then lets the operator set a different entry port; changing
	 *      it (re-label) RECONVERGES the service on the new port and rechecks.
	 *    - Production headless (no host port, behind the user's own proxy) is
	 *      the only case with no host binding. */
	protected async reconcile(): Promise<void> {
		const runtime = await this.effectiveRuntime();

		if (runtime === "managed") {
			// Compose/operator owns the ingress — the platform only needs its
			// own config generated (the traefik core module does that) and the
			// app containers reachable on the overlay.
			await this.connectSelfToOverlay(platformOverlayForPrefix(this.env.get("DEPLOYER_PREFIX"))).catch(
				() => undefined,
			);
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
				const entry = await this.settings.getPlatformEntry();
				const desiredPort = this.isProduction() ? null : entry.port;
				// Config files (dynamic-*.yml) are handled by the TRAEFIK CORE
				// module (TraefikPlatformConfigService) — the file-provider
				// watcher reloads them; this supervisor only ensures the PROCESS.
				await this.reconcileSwarm(desiredPort);
				await this.verifySwarmConvergence(this.buildSwarmSpec(desiredPort));
			},
			{ maxAttempts: 5 },
		);
	}

	/** Confirm the ingress service exists and has a running task on this node. */
	private async verifySwarmConvergence(spec: SwarmServiceSpecInput): Promise<void> {
		const service = await this.dockerService.inspectSwarmService(spec.name);
		if (service.ID === "") {
			throw new Error(`platform ingress swarm service '${spec.name}' was not created`);
		}
		const tasks = await this.dockerService.listSwarmServiceTasks(spec.name).catch(() => []);
		if (tasks.length > 0 && tasks.every((task) => task.Status.State !== "running")) {
			throw new Error(`platform ingress swarm service '${spec.name}' has no running task`);
		}
	}

	/** The entry-port conflict is deterministic — never retried by backoff. */
	protected isFatalConvergenceError(error: unknown): boolean {
		return error instanceof EntryPortConflictError;
	}

	/** True when the process runs in production mode (no host port publishing). */
	private isProduction(): boolean {
		return this.env.get("NODE_ENV") === "production";
	}

	/** Heuristic for Docker port-binding failures (host port already in use). */
	private isPortBindError(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return (
			message.includes("address already in use") ||
			message.includes("port is already allocated") ||
			message.includes("failed to bind host port") ||
			message.includes("bind: address")
		);
	}

	/** Directory on the API-side mount of the shared config volume (base of the
	 *  file provider's watched input). The CONFIG files themselves are written
	 *  by the traefik core module — this only reports their location/size in
	 *  the probe payload. */
	private platformConfigDir(): string {
		return this.env.get("TRAEFIK_CONFIG_BASE_PATH") ?? "/app/traefik-configs";
	}

	/** Named docker volume sharing the generated configs with the API container. */
	private traefikConfigVolume(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const envVol = this.env.get("TRAEFIK_CONFIG_VOLUME");
		if (envVol !== undefined && envVol.trim().length > 0) return envVol.trim();
		return prefix === "" ? "deployer-traefik-config" : `deployer-traefik-config-${prefix}`;
	}

	/**
	 * Resolve THIS API container's name so Traefik can target it inside the
	 * platform network. Inside Docker, HOSTNAME equals the container id —
	 * inspect it to get the canonical name. Outside Docker (bare-metal dev)
	 * there is no container; fall back to host-gateway addressing via the
	 * published port instead.
	 */
	/** Resolve THIS API container's canonical name so Traefik (and the
	 *  self-attach check) can target it inside the platform network. Priority:
	 *   1. explicit DEPLOYER_API_TARGET (compose passes the api alias),
	 *   2. the container's CANONICAL NAME (inspect by HOSTNAME=container-id)
	 *      — docker embedded DNS resolves by NAME, not by id,
	 *   3. HOSTNAME (container id) as a last resort,
	 *   4. host.docker.internal (bare-metal dev — no container). */
	private async resolveOwnContainerName(): Promise<string> {
		const explicit = this.env.get("DEPLOYER_API_TARGET")?.trim();
		if (explicit !== undefined && explicit !== "") return explicit;

		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return "host.docker.internal";
		try {
			const info = await this.client.getContainer(selfId).inspect();
			const name = ((info as unknown as { Name?: string })?.Name ?? "").replace(/^\//, "");
			if (name !== "") return name;
		} catch {
			/* inspect failed — fall through to the container-id heuristic */
		}
		return selfId;
	}

	/**
	 * REAL health observation: ingress service/task state, real entrypoint HTTP
	 * probe across candidate hosts (status code + latency) and dynamic-config
	 * file size. Never throws for an unhealthy resource — the payload records
	 * exactly what is broken.
	 *
	 * A GLOBAL service runs one task per node, so health is judged on the LOCAL
	 * task (the task this API's node runs) plus the entrypoint probe: another
	 * node being down must not make THIS node's ingress report unhealthy.
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

		const entrypoint = await this.probeEntrypoint(await this.resolveProbeCandidates(spec.name));

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
			detail = `ingress running but entrypoint unreachable (${entrypoint.host})`;
		} else {
			healthy = true;
			detail = `routing ${this.hostnameService.apiHostname()} via ${entrypoint.host}:${String(entrypoint.port)} (HTTP ${String(entrypoint.statusCode ?? "?")})`;
		}

		// Dynamic config artifact measurement.
		const configDir = this.platformConfigDir();
		const dynamicApiFile = PlatformPaths.apiConfigFile(configDir);
		let fileSizeBytes: number | null = null;
		try {
			const statResult = await stat(dynamicApiFile);
			fileSizeBytes = statResult.size;
		} catch {
			fileSizeBytes = null;
		}

		return {
			healthy,
			detail,
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				service,
				entrypoint,
				config: {
					apiHostname: this.hostnameService.apiHostname(),
					configDir,
					dynamicApiFile,
					fileSizeBytes,
				},
			},
		};
	}

	/**
	 * The task of a GLOBAL service that runs on THIS node, with its state.
	 * Returns null when the service or the local task is absent.
	 */
	private async localServiceTask(
		serviceName: string,
	): Promise<{ serviceId: string | null; state: string } | null> {
		try {
			const service = await this.dockerService.inspectSwarmService(serviceName);
			const tasks = await this.dockerService.listSwarmServiceTasks(serviceName).catch(() => []);
			const selfNodeId = await this.selfNodeId();
			const local =
				selfNodeId === null
					? tasks[0]
					: tasks.find((task) => task.NodeID === selfNodeId);
			if (local === undefined) return null;
			return { serviceId: service.ID ?? null, state: local.Status.State };
		} catch {
			return null;
		}
	}

	/** This node's engine id (read once per call — survives node re-joins). */
	private async selfNodeId(): Promise<string | null> {
		try {
			const info = await this.dockerService.getSwarmInfo();
			return info.NodeID === "" ? null : info.NodeID;
		} catch {
			return null;
		}
	}

	/** Payload shape when the probe mechanism itself fails (docker socket down, etc.). */
	protected buildDegradedPayload(_detail: string): z.output<typeof traefikSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			service: null,
			entrypoint: null,
			config: {
				apiHostname: this.hostnameService.apiHostname(),
				configDir: this.platformConfigDir(),
				dynamicApiFile: PlatformPaths.apiConfigFile(this.platformConfigDir()),
				fileSizeBytes: null,
			},
		};
	}

	/**
	 * The entire config + live state of the ingress process, mirroring the
	 * reconcile's desired spec (entry port resolved the same way, so what the
	 * web configures as entry port is what this reports).
	 */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const entry = await this.settings.getPlatformEntry();
		const desiredPort = this.isProduction() ? null : entry.port;
		const spec = this.buildSwarmSpec(desiredPort);
		const published = spec.endpointPorts.length > 0;
		return {
			process: await this.describeSwarmProcess(spec),
			entry: {
				port: entry.port,
				isDefault80: entry.isDefault80,
				source: entry.sourcedFrom,
			},
			urls: {
				entryUrl: published ? `http://localhost:${String(entry.port)}` : null,
				apiUrl: this.hostnameService.apiOrigin(),
				webUrl: this.hostnameService.webOrigin(),
			},
			config: {
				configDir: this.platformConfigDir(),
				dynamicApiFile: PlatformPaths.apiConfigFile(this.platformConfigDir()),
			},
		};
	}

	/** True when this process runs inside a Docker container. */
	private runsInsideContainer(): boolean {
		const hostname = process.env.HOSTNAME;
		if (hostname !== undefined && /^[0-9a-f]{12,64}$/.test(hostname)) return true;
		return existsSync("/.dockerenv");
	}

	/**
	 * Candidate hosts for the entrypoint liveness probe, best-first:
	 *
	 *   1. THIS container's IP on the platform network (read from the docker
	 *      API). Reachable EVEN when the API is not attached to that network
	 *      (e.g. after a compose watch recreate dropped the attachment) —
	 *      the docker socket is always available. THE robust dev fix.
	 *   2. THIS container's name on the platform network (docker embedded
	 *      DNS — works when the API is attached via connectSelfToNetwork).
	 *   3. `host.docker.internal` — the Docker host, where Traefik's
	 *      published port 80 actually lives.
	 *   4. The default-gateway IP (Docker host) read from /proc/net/route.
	 *   5. `127.0.0.1` — bare-metal dev.
	 *
	 * The first host that answers wins — healing both the "not attached" and
	 * "legacy container on the bridge network" cases without recreating
	 * anything.
	 */
	private async resolveProbeCandidates(containerName: string): Promise<string[]> {
		const candidates: string[] = [];
		if (this.runsInsideContainer()) {
			const ip = await this.containerNetworkIp(containerName);
			if (ip !== null) candidates.push(ip);
			candidates.push(containerName);
		}
		candidates.push("host.docker.internal");
		const gateway = resolveDockerHostIp();
		if (gateway !== "127.0.0.1" && gateway !== "0.0.0.0") candidates.push(gateway);
		candidates.push("127.0.0.1");
		return [...new Set(candidates)];
	}

	/** This container's IP on the platform network (via the docker API). */
	private async containerNetworkIp(containerName: string): Promise<string | null> {
		try {
			const info = await this.client.getContainer(containerName).inspect();
			const netName = PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX"));
			const networks = (info.NetworkSettings?.Networks ?? {}) as Record<string, { IPAddress?: string }>;
			return networks[netName]?.IPAddress ?? null;
		} catch {
			return null;
		}
	}

	/**
	 * Probe the Traefik entrypoint across candidate hosts. Any HTTP response
	 * (even 404) proves the router is alive — status code + latency are
	 * measured and reported. Raw failures are captured per candidate and the
	 * list is exhausted before giving up; the result is a measurement, not an
	 * exception.
	 */
	private async probeEntrypoint(candidates: string[], port = 80): Promise<EntrypointProbe> {
		for (const host of candidates) {
			const started = Date.now();
			const attempt = await this.probeHost(host, port);
			if (attempt.reachable) {
				return { ...attempt, host, port, latencyMs: Date.now() - started };
			}
		}
		return {
			reachable: false,
			host: candidates.join(" / "),
			port,
			statusCode: null,
			latencyMs: null,
		};
	}

	/** Single HTTP GET against one candidate; resolves with reachability + status. */
	private probeHost(host: string, port: number): Promise<Omit<EntrypointProbe, "host" | "port" | "latencyMs">> {
		return new Promise((resolve) => {
			let settled = false;
			const finish = (value: Omit<EntrypointProbe, "host" | "port" | "latencyMs">): void => {
				if (settled) return;
				settled = true;
				resolve(value);
			};
			const req = http.get(
				{ host, port, path: "/", timeout: TraefikSupervisorService.PROBE_TIMEOUT_MS },
				(res) => {
					res.resume();
					finish({ reachable: true, statusCode: res.statusCode ?? null });
				},
			);
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
