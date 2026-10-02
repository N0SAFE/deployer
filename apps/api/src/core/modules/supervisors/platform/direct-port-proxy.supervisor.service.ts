/**
 * DirectPortProxySupervisorService — FALLBACK ingress when the platform
 * Traefik (the single entry point) FAILS.
 *
 * ARCHITECTURE ("traefik-first"):
 *   - Traefik is the ONLY published surface: api.<prefix>deployer.localhost /
 *     web.<prefix>deployer.localhost over the ENTRY PORT (default 80).
 *     Compose services do NOT publish any host port.
 *   - If Traefik cannot bind the entry port (→ `EntryPortConflictError` →
 *     DEGRADED with its container removed), NOTHING serves the app. THIS
 *     supervisor takes over: a supervised nginx container binds the SERVICE
 *     ports on the host (API_PORT + the web port) and forwards to the
 *     container names over the private platform network — the rescue lane
 *     the operator uses to reach the platform and reconfigure the entry
 *     port in the web console.
 *   - As soon as Traefik converges again (events on the supervisor bus), the
 *     proxy REMOVES its container and closes itself — Traefik resumes being
 *     the single entry point.
 *
 * Event-driven: subscribes to every Traefik supervisor event (registered,
 * state-changed, reconciled, health-snapshot) and re-evaluates its own
 * desired state — start on Traefik failure, stop on Traefik recovery. A
 * running guard de-dupes bursts (e.g. periodic health polls).
 *
 * Self-healing: a host port already bound by another process is detected on
 * start failure, dropped from the forwarding set, and the proxy converges
 * with the remaining ports (logging the drop as a warning).
 */

import { Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Subscription } from "rxjs";
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
import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { PlatformIngressSettingsService } from "../../platform-ingress/services/platform-ingress-settings.service";
import { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import { PLATFORM_WEB_INTERNAL_PORT } from "../../platform-ingress/services/platform-names";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@repo/nest-docker/services/docker-supervisor-runtime";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { PlatformNetwork, TraefikSupervisorService } from "./traefik-supervisor.service";
import { AppError, ConflictError } from "@repo/errors";

export const DIRECT_PORT_PROXY_SUPERVISOR_ID = "platform-direct-port-proxy";

/** Mount point of the shared nginx-config volume inside the proxy container. */
export const DIRECT_PORT_PROXY_CONFIG_MOUNT = "/etc/nginx/port-proxy";

/** One host-port → internal target forward (ordered for stable JSON labels). */
export interface DirectProxyForward {
	hostPort: number;
	/** Container name on the platform network (docker embedded DNS). */
	target: string;
	targetPort: number;
}

/**
 * The HOST-ROUTED ingress surface the proxy mirrors while Traefik is down.
 *
 * The direct port lane (localhost:<api|web port>) alone is not enough: the
 * platform's canonical URLs are `*.deployer.localhost` on the ENTRY PORT, so
 * losing Traefik must not lose the hostname surface — the setup wizard and
 * the console live there. When this binding is taken, the proxy answers the
 * hostnames on the entry port exactly like the real ingress does.
 */
export interface DirectProxyIngress {
	/** Host port the ingress publishes (Traefik's configured entry port). */
	entryPort: number;
	apiHost: string;
	webHost: string;
	apiTarget: string;
	apiPort: number;
	webTarget: string;
	webPort: number;
}

/** Runtime parser for the ingress label (labels are untrusted container data). */
export const directProxyIngressSchema = z.object({
	entryPort: z.number().int().min(1).max(65_535),
	apiHost: z.string().min(1),
	webHost: z.string().min(1),
	apiTarget: z.string().min(1),
	apiPort: z.number().int().min(1).max(65_535),
	webTarget: z.string().min(1),
	webPort: z.number().int().min(1).max(65_535),
});

/** Rich health payload for the fallback proxy. */
export const directPortProxyPayloadSchema = baseSupervisorPayloadSchema.extend({
	/** True when the fallback proxy container is RUNNING (Traefik is failed). */
	active: z.boolean(),
	/** The current host-port → target forwards (conflicts dropped). */
	forwards: z.array(
		z.object({
			hostPort: z.number().int().min(1),
			target: z.string().min(1),
			targetPort: z.number().int().min(1),
		}),
	),
	/** Host-routed ingress surface mirrored while Traefik is down. Null when
	 *  the entry port could not be taken (direct ports stay the only lane). */
	ingress: z
		.object({
			entryPort: z.number().int().min(1),
			apiHost: z.string().min(1),
			webHost: z.string().min(1),
		})
		.nullable()
		.default(null),
	/** Live view of the proxy's swarm service (null when absent). */
	service: swarmProcessInfoSchema.shape.live.nullable(),
});
export type DirectPortProxyPayload = z.output<typeof directPortProxyPayloadSchema>;

/** Process info: the nginx process + the direct host URLs it forwards to. */
export const directPortProxyProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	urls: z.object({
		/** Direct API URL (null when the proxy is not running). */
		apiDirectUrl: z.string().nullable(),
		/** Direct web URL (null when the proxy is not running). */
		webDirectUrl: z.string().nullable(),
	}),
	/** Hostname surface served on the entry port (null when not taken). */
	ingressUrls: z
		.object({
			entryPort: z.number().int().min(1),
			apiUrl: z.string(),
			webUrl: z.string(),
			serving: z.boolean(),
		})
		.nullable()
		.default(null),
});
export type DirectPortProxyProcessInfo = z.output<typeof directPortProxyProcessInfoSchema>;

/** Dockerode bind-failure error text (Linux + Docker Desktop on macOS). */
const BIND_ERROR_HINTS = [
	"address already in use",
	"port is already allocated",
	"failed to bind host port",
	"bind: address",
	"bind: An attempt was made to access a socket in a way forbidden",
];

@Injectable()
export class DirectPortProxySupervisorService
	extends BaseDockerSupervisorService<typeof directPortProxyPayloadSchema, typeof directPortProxyProcessInfoSchema>
	implements OnModuleInit, OnModuleDestroy
{
	static readonly identifier = DIRECT_PORT_PROXY_SUPERVISOR_ID;
	readonly description = "Fallback direct-port proxy (active only while the Traefik ingress is failed)";

	readonly payloadSchema = directPortProxyPayloadSchema;
	readonly processInfoSchema = directPortProxyProcessInfoSchema;

	/** Container label recording the current forwards (restart-on-change). */
	static readonly FORWARDS_LABEL = "deployer.proxy.forwards";

	/** Container label recording the mirrored ingress (restart-on-change). */
	static readonly INGRESS_LABEL = "deployer.proxy.ingress";

	private static readonly CONTAINER_BASE_NAME = "deployer-port-proxy";

	private eventSubscription: Subscription | undefined;

	constructor(
		dockerService: DockerService,
		private readonly env: EnvService,
		private readonly webTarget: PlatformWebTargetService,
		private readonly hostnameService: HostnameService,
		private readonly ingressSettings: PlatformIngressSettingsService,
	) {
		super(dockerService);
	}

	/**
	 * Self-register + subscribe to the Traefik supervisor events. Every state
	 * transition (registered, state-changed, reconciled, health-snapshot) is
	 * a reason to re-evaluate: take over the host ports when Traefik fails,
	 * close ourselves when it recovers. Burst events coalesce into one run
	 * (and a run never misses the last transition — a pending flag replays).
	 */
	onModuleInit(): void {
		super.onModuleInit();
		this.eventSubscription = this.eventBus?.of({ supervisorId: TraefikSupervisorService.getIdentifier() }).subscribe({
			next: () => {
				void this.scheduleReevaluate();
			},
		});
	}

	onModuleDestroy(): void {
		this.eventSubscription?.unsubscribe();
		this.eventSubscription = undefined;
	}

	private reevaluating = false;
	private pendingReevaluate = false;

	/** Coalesce bursts of Traefik events into ONE re-evaluation run. */
	private async scheduleReevaluate(): Promise<void> {
		if (this.reevaluating) {
			this.pendingReevaluate = true;
			return;
		}
		this.reevaluating = true;
		try {
			await this.ensureDesiredState();
		} finally {
			this.reevaluating = false;
			if (this.pendingReevaluate) {
				this.pendingReevaluate = false;
				void this.scheduleReevaluate();
			}
		}
	}

	/**
	 * Desired state: REMOVED while Traefik is the working single entry point,
	 * RUNNING (nginx forwarding api/web host ports) while Traefik is failed.
	 * Suppressed entirely by DEPLOYER_DIRECT_PROXY_ENABLED=false.
	 */
	protected async reconcile(): Promise<void> {
		const runtime = await this.effectiveRuntime();

		const takeOver =
			this.env.get("DEPLOYER_DIRECT_PROXY_ENABLED") && !(await this.isTraefikActingAsIngress());

		if (!takeOver) {
			// Traefik is the single entry point (or the proxy is disabled) —
			// remove the swarm incarnation so nothing competes for the ports.
			await this.removeSwarmServiceIfExists(this.proxyServiceName());
			return;
		}

		if (runtime === "unavailable") {
			throw new AppError(
				"Direct-port proxy requires an active swarm engine (no container fallback) — SwarmBootstrapService should have converged the engine",
				"SWARM_UNAVAILABLE",
				{ supervisor: "platform-direct-port-proxy" },
			);
		}

		await this.runWithBackoff(
			"Direct-port proxy (swarm) convergence",
			async () => {
				await this.ensureProxyServiceRunning();
			},
			{ maxAttempts: 3 },
		);
	}

	/** Remove the proxy service (container-era incarnations included). */
	private async removeProxyProcess(): Promise<void> {
		await this.removeSwarmServiceIfExists(this.proxyServiceName());
	}

	// ─── Take-over ───────────────────────────────────────────────────────────

	/**
	 * Runtime: NODE-LOCAL → swarm-global (one proxy per node, each publishing
	 * that node's ports). There is no container path.
	 */
	private async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (
			await resolveSupervisorRuntime({
				managed: false,
				rawRuntime: process.env.SUPERVISOR_RUNTIME,
				swarmActive: await this.isSwarmActive(),
				scope: "node-local",
			})
		).runtime;
	}

	private async verifySwarmService(name: string): Promise<void> {
		const svc = await this.dockerService.inspectSwarmService(name);
		if (!svc.ID) throw new ConflictError(`failover proxy swarm service '${name}'`, "was not created");
	}

	/**
	 * Take over the host ports as a swarm-GLOBAL nginx service, dropping host
	 * ports already bound by other processes (self-healing: Docker reports the
	 * conflict, the port leaves the forwarding set, and the service converges
	 * with what remains).
	 */
	private async ensureProxyServiceRunning(): Promise<void> {
		let forwards = await this.buildForwardSet();
		if (forwards.length === 0) {
			throw new AppError(
				"Direct-port proxy has no API/web target to forward to",
				"SWARM_FORWARD_TARGET_UNRESOLVED",
			);
		}

		await this.ensureVolume(this.configVolume());
		const dropped: number[] = [];
		const svcName = this.proxyServiceName();
		const ingress = await this.resolveIngressBinding(forwards);

		for (let attempt = 0; attempt <= forwards.length && forwards.length > 0; attempt++) {
			const forwardsJson = stableJson(forwards);
			await this.writeNginxConfig(forwards, ingress);
			const spec = this.buildProxySwarmSpec(forwards, forwardsJson, ingress);
			try {
				const overlay = await this.ensureSwarmNetwork(PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX") ?? ""));
				this.attachOverlay(spec, overlay, [spec.name]);
				await this.reconcileSwarmService(spec);
				await this.verifySwarmService(svcName);
				return;
			} catch (error) {
				const boundPort = this.parseBindErrorHostPort(error, [
					...forwards.map((f) => f.hostPort),
					...(ingress === null ? [] : [ingress.entryPort]),
				]);
				if (boundPort === null) {
					// Make sure no partial service lingers, then surface.
					await this.removeSwarmServiceIfExists(svcName);
					throw error;
				}
				this.logger.warn(`Direct-port proxy: host port ${String(boundPort)} already bound — dropping it`);
				dropped.push(boundPort);
				forwards = forwards.filter((f) => f.hostPort !== boundPort);
				await this.removeSwarmServiceIfExists(svcName);
			}
		}

		if (forwards.length === 0) {
			throw new ConflictError(`direct-port proxy host ports (${dropped.join(", ")})`, "all are already bound by other processes");
		}
	}

	/** Swarm-GLOBAL nginx spec for the current forwards (published host ports)
	 *  plus the mirrored Host-routed ingress on the entry port. */
	private buildProxySwarmSpec(
		forwards: DirectProxyForward[],
		forwardsJson: string,
		ingress: DirectProxyIngress | null,
	): SwarmServiceSpecInput {
		// HOST publish mode is REQUIRED, not cosmetic: this is a GLOBAL service,
		// and the engine rejects a global service publishing through the swarm
		// routing mesh (the mesh load balancer cannot front one task per node).
		// Each node must bind its own ports directly — which is also the
		// semantics we want for a per-node rescue lane.
		const endpointPorts = forwards.map((f) => ({
			protocol: "tcp" as const,
			publishedPort: f.hostPort,
			targetPort: f.hostPort,
			publishMode: "host" as const,
		}));
		if (ingress !== null) {
			endpointPorts.push({
				protocol: "tcp" as const,
				publishedPort: ingress.entryPort,
				targetPort: ingress.entryPort,
				publishMode: "host" as const,
			});
		}
		return {
			name: this.proxyServiceName(),
			image: this.env.get("DEPLOYER_DIRECT_PROXY_IMAGE"),
			mode: "global",
			replicas: 1,
			env: [],
			command: ["nginx", "-c", `${DIRECT_PORT_PROXY_CONFIG_MOUNT}/nginx.conf`, "-g", "daemon off;"],
			args: [],
			labels: {
				[DirectPortProxySupervisorService.FORWARDS_LABEL]: forwardsJson,
				[DirectPortProxySupervisorService.INGRESS_LABEL]: stableIngressJson(ingress),
			},
			containerLabels: {},
			mounts: [{ type: "volume", source: this.configVolume(), target: DIRECT_PORT_PROXY_CONFIG_MOUNT, readOnly: false }],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			capabilitiesAdd: [],
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			stopGracePeriodSeconds: 10,
			endpointPorts,
			// NODE-LOCAL (global mode): consumers reach it on the HOST port, never
			// through the overlay's DNS name, so no VIP should be allocated at all.
			endpointMode: "dnsrr",
		};
	}

	/**
	 * Cheap decision input (no docker probing): only a CONVERGED Traefik owns
	 * the ingress. While Traefik is idle/converging (the boot window) the
	 * proxy HOLDS OFF — Traefik will either converge (→ nothing to do) or
	 * DEGRADE (→ its `state-changed`/`reconciled` event triggers this proxy
	 * to take over). Absent → take over. The event subscription re-runs us
	 * the moment Traefik's state changes.
	 */
	private async isTraefikActingAsIngress(): Promise<boolean> {
		const traefik =
			(await this.orchestrator?.getSupervisorById(TraefikSupervisorService.getIdentifier(), { timeoutMs: 0 })) ??
			null;
		if (traefik === null) return false; // not registered → ingress NOT working
		const state = traefik.getStateSnapshot().state;
		if (state === "converged") return true; // Traefik owns the ingress
		if (state === "degraded") return false; // FAILED → proxy takes over
		return true; // idle/converging → Traefik is (about to be) the ingress
	}

	// ─── Take-over ───────────────────────────────────────────────────────────

	/** Swarm SERVICE name of the fallback proxy (same name as the container era). */
	private proxyServiceName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		return prefix === "" ? DirectPortProxySupervisorService.CONTAINER_BASE_NAME : `${DirectPortProxySupervisorService.CONTAINER_BASE_NAME}-${prefix}`;
	}

	/** The api + web forwards, from compose-passed targets and env ports. */
	private async buildForwardSet(): Promise<DirectProxyForward[]> {
		const forwards: DirectProxyForward[] = [];

		const apiPort = this.env.get("API_PORT");
		const apiTarget = this.env.get("DIRECT_PROXY_API_TARGET")?.trim() || (await this.resolveApiTarget());
		if (apiTarget !== "") forwards.push({ hostPort: apiPort, target: apiTarget, targetPort: apiPort });

		const webHostPort = this.env.get("DIRECT_PROXY_WEB_HOST_PORT");
		// Explicit proxy-specific target wins; otherwise the SHARED platform
		// web target (the same container the Traefik web route points at).
		const explicitWebTarget = this.env.get("DIRECT_PROXY_WEB_TARGET")?.trim();
		const webTarget =
			explicitWebTarget !== undefined && explicitWebTarget !== ""
				? explicitWebTarget
				: await this.webTarget.resolveWebTarget();

		if (webTarget !== null) {
			// The web runtime listens on the internal port inside the container
			// (never published to the host).
			forwards.push({ hostPort: webHostPort, target: webTarget, targetPort: PLATFORM_WEB_INTERNAL_PORT });
		}

		return forwards;
	}

	/**
	 * THIS API's DNS name for the proxy to forward to.
	 *
	 * Priority:
	 *   1. `DEPLOYER_API_TARGET` — the compose alias the deployment already
	 *      publishes (`api-dev`). Stable across container recreations, and the
	 *      name the swarm overlay wiring re-declares, so it resolves from BOTH
	 *      the compose bridge and the overlay.
	 *   2. the container's canonical NAME, discovered by inspecting our own
	 *      container (HOSTNAME == container id inside Docker).
	 *   3. `host.docker.internal` — bare-metal dev only. Deliberately NOT the
	 *      fallback when the inspect fails: a SWARM task cannot resolve that
	 *      name (no ExtraHosts equivalent in a service spec), and nginx refuses
	 *      to start with an unresolvable upstream. Using the alias keeps the
	 *      proxy bootable whenever the deployment declared one.
	 */
	private async resolveApiTarget(): Promise<string> {
		const explicit = this.env.get("DEPLOYER_API_TARGET")?.trim();
		if (explicit !== undefined && explicit !== "") return explicit;

		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return "host.docker.internal";
		const info = await this.client.getContainer(selfId).inspect().catch(() => null);
		const name = ((info as unknown as { Name?: string })?.Name ?? "").replace(/^\//, "");
		if (name !== "") return name;

		// Fall back to the container ID: Docker's embedded DNS resolves a
		// container by id on any network it is attached to, which is always
		// true for the API here (compose attaches it to the platform network).
		return /^[0-9a-f]{12,64}$/.test(selfId) ? selfId : "host.docker.internal";
	}

	/**
	 * The mirrored ingress binding: the hostnames the proxy serves on the
	 * ENTRY port while Traefik is down (null when the entry port is taken by
	 * someone else, so only the direct ports can be served).
	 */
	private async resolveIngressBinding(forwards: DirectProxyForward[]): Promise<DirectProxyIngress | null> {
		try {
			const entry = await this.ingressSettings.getPlatformEntry();
			const apiForward = forwards.find((f) => f.targetPort === this.env.get("API_PORT"));
			const webForward = forwards.find((f) => f.targetPort === PLATFORM_WEB_INTERNAL_PORT);
			if (apiForward === undefined || webForward === undefined) return null;
			return {
				entryPort: entry.port,
				apiHost: this.hostnameService.apiHostname(),
				webHost: this.hostnameService.webHostname(),
				apiTarget: apiForward.target,
				apiPort: apiForward.targetPort,
				webTarget: webForward.target,
				webPort: webForward.targetPort,
			};
		} catch {
			return null;
		}
	}

	/**
	 * Deterministic nginx config, written into the shared config volume: one
	 * `server` block per forward, plus the Host-routed ingress servers on the
	 * entry port so `*.deployer.localhost` survives a Traefik failure.
	 */
	private async writeNginxConfig(
		forwards: DirectProxyForward[],
		ingress: DirectProxyIngress | null,
	): Promise<void> {
		const servers = forwards
			.map(
				(f) => `  server {
    listen ${String(f.hostPort)};
    location / {
      proxy_pass http://${f.target}:${String(f.targetPort)};
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Real-IP $remote_addr;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }`,
			)
			.join("\n");
		const ingressServers =
			ingress === null
				? ""
				: [
						`  server {
    listen ${String(ingress.entryPort)};
    server_name ${ingress.apiHost};
    location / {
      proxy_pass http://${ingress.apiTarget}:${String(ingress.apiPort)};
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }`,
						`  server {
    listen ${String(ingress.entryPort)};
    server_name ${ingress.webHost};
    location / {
      proxy_pass http://${ingress.webTarget}:${String(ingress.webPort)};
      proxy_http_version 1.1;
      proxy_set_header Host $host;
      proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
      proxy_set_header X-Forwarded-Proto $scheme;
    }
  }`,
					].join("\n");
		const conf = `events {}\nhttp {\n  include /etc/nginx/mime.types;\n${servers}\n${ingressServers}\n}\n`;

		const dir = this.configWriteDir();
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "nginx.conf"), conf, "utf8");
	}

	/** API-side base directory of the shared config volume. */
	private configWriteDir(): string {
		return this.env.get("DIRECT_PROXY_CONFIG_BASE_PATH") ?? "/app/port-proxy-config";
	}

	/** Named volume sharing nginx.conf with the proxy tasks. */
	private configVolume(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const envVol = this.env.get("DIRECT_PROXY_CONFIG_VOLUME");
		if (envVol !== undefined && envVol.trim().length > 0) return envVol.trim();
		return prefix === "" ? "deployer-port-proxy-config" : `deployer-port-proxy-config-${prefix}`;
	}

	/**
	 * Extract the host port from a Docker port-bind failure; null when the
	 * error is not a bind conflict (→ rethrow).
	 *
	 * Docker reports the conflict in several shapes:
	 *   "Bind for 0.0.0.0:80 failed: port is already allocated"      (compose/engine)
	 *   "failed to bind host port 0.0.0.0:3005/tcp: address already in use"
	 *   "bind: address already in use"                                (no port)
	 * The explicit `host:port` forms are parsed first; otherwise the message is
	 * matched against the ports we ACTUALLY tried to bind (the only reliable
	 * signal when the message carries no port), so a conflict never escapes
	 * the self-healing loop.
	 */
	private parseBindErrorHostPort(error: unknown, candidates: number[]): number | null {
		const message = error instanceof Error ? error.message : String(error);
		if (!BIND_ERROR_HINTS.some((hint) => message.includes(hint))) return null;

		const explicit = /(?:Bind for|bind host port)\s+[0-9a-fA-F.:\[\]]*:(\d{1,5})/.exec(message);
		if (explicit !== null) {
			const port = Number(explicit[1]);
			if (port >= 1 && port <= 65_535) return port;
		}

		return (
			candidates.find((port) =>
				// "…:PORT", "….PORT" or "port PORT", never part of a longer number.
				new RegExp(`(?::|\\.|port\\s+)${String(port)}(?![0-9])`).test(message),
			) ?? null
		);
	}

	// ─── Health ─────────────────────────────────────────────────────────────

	/**
	 * REAL observation: the proxy SERVICE's recorded forwards + mirrored
	 * ingress, read from the service LABELS (stamped by the convergence) —
	 * never a reconciliation trigger.
	 */
	protected async probe(): Promise<SupervisorProbeResult<typeof directPortProxyPayloadSchema>> {
		const serviceName = this.proxyServiceName();
		const startedAt = Date.now();

		const live = await this.serviceLive(serviceName);
		const forwards = this.forwardsFromLabels(live.labels);
		const ingress = this.ingressFromLabels(live.labels);

		if (!live.exists) {
			return {
				healthy: true, // nothing to run while Traefik is the single entry point
				detail: "inactive — ingress (Traefik) is the single entry point",
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					active: false,
					forwards: [],
					ingress: null,
					service: null,
				},
			};
		}

		if (!live.running) {
			return {
				healthy: false,
				detail: `proxy service not forwarding (running=false)`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					active: false,
					forwards,
					ingress: null,
					service: live.snapshot,
				},
			};
		}

		const summary = forwards.map((f) => `:${String(f.hostPort)}→${f.target}:${String(f.targetPort)}`).join(" ");
		const hostnames =
			ingress === null
				? " — hostnames UNAVAILABLE (entry port taken)"
				: ` + ${ingress.webHost}/${ingress.apiHost} on :${String(ingress.entryPort)}`;
		return {
			healthy: true,
			detail: `forwarding ${summary}${hostnames}`,
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				active: true,
				forwards,
				ingress,
				service: live.snapshot,
			},
		};
	}

	/** The proxy service's live state + its service-level labels. */
	private async serviceLive(serviceName: string): Promise<{
		exists: boolean;
		running: boolean;
		labels: Record<string, string>;
		snapshot: {
			serviceId: string | null;
			exists: boolean | null;
			createdAt: string | null;
			updatedAt: string | null;
			serviceName: string | null;
			runningTasks: number | null;
			totalTasks: number | null;
		} | null;
	}> {
		try {
			const service = await this.dockerService.inspectSwarmService(serviceName);
			const tasks = await this.dockerService.listSwarmServiceTasks(serviceName).catch(() => []);
			const runningTasks = tasks.filter((task) => task.Status.State === "running").length;
			return {
				exists: true,
				running: runningTasks > 0,
				labels: service.Spec.Labels,
				snapshot: {
					serviceId: service.ID ?? null,
					exists: true,
					createdAt: service.CreatedAt ?? null,
					updatedAt: service.UpdatedAt ?? null,
					serviceName: service.Spec.Name ?? null,
					runningTasks,
					totalTasks: tasks.length,
				},
			};
		} catch {
			return { exists: false, running: false, labels: {}, snapshot: null };
		}
	}

	/** Forwards decoded from the service label (empty when absent/invalid). */
	private forwardsFromLabels(labels: Record<string, string>): DirectProxyForward[] {
		const raw = labels[DirectPortProxySupervisorService.FORWARDS_LABEL];
		if (raw === undefined || raw === "") return [];
		try {
			const parsed: unknown = JSON.parse(raw);
			if (!Array.isArray(parsed)) return [];
			return parsed.filter(
				(entry): entry is DirectProxyForward =>
					typeof entry === "object" &&
					entry !== null &&
					typeof (entry as DirectProxyForward).hostPort === "number" &&
					typeof (entry as DirectProxyForward).target === "string" &&
					typeof (entry as DirectProxyForward).targetPort === "number",
			);
		} catch {
			return [];
		}
	}

	/** Mirrored ingress decoded from the service label (null when the entry
	 *  port could not be taken, or nothing is recorded yet). */
	private ingressFromLabels(labels: Record<string, string>): DirectProxyIngress | null {
		const raw = labels[DirectPortProxySupervisorService.INGRESS_LABEL];
		if (raw === undefined || raw === "" || raw === "none") return null;
		try {
			const parsed: unknown = JSON.parse(raw);
			return directProxyIngressSchema.parse(parsed);
		} catch {
			return null;
		}
	}

	/** Payload shape when the probe mechanism itself fails. */
	protected buildDegradedPayload(_detail: string): z.output<typeof directPortProxyPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			active: false,
			forwards: [],
			ingress: null,
			service: null,
		};
	}

	/** Non-fatal warning the operator must act on: Traefik is FAILED and the
	 *  fallback proxy has taken over the service ports. Fix = configure a
	 *  free entry port in the web console (Traefik then restarts and the
	 *  proxy closes itself). */
	protected collectWarnings(probe: SupervisorProbeResult<typeof directPortProxyPayloadSchema>): string[] {
		const base = super.collectWarnings(probe);
		if (probe.payload.active && probe.payload.ingress === null) {
			return [
				...base,
				"Traefik ingress is FAILED and the entry port is held by another process — the *.deployer.localhost hostnames are UNAVAILABLE; only the direct ports respond. Free the entry port (or set a new one in the web app) to restore them.",
			];
		}
		if (probe.payload.active) {
			return [...base, "Traefik ingress is FAILED — the fallback proxy is serving the api/web ports AND the *.deployer.localhost hostnames. Fix the entry port from the web app."];
		}
		return base;
	}

	/** The entire config + live state of the fallback proxy process. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const serviceName = this.proxyServiceName();
		const live = await this.serviceLive(serviceName);
		const forwards = this.forwardsFromLabels(live.labels);
		const active = live.running && forwards.length > 0;
		const servedIngress = this.ingressFromLabels(live.labels);

		// What the proxy would forward right now (its desired set) — used for
		// the process view even when the service is currently absent.
		const desired = forwards.length > 0 ? forwards : await this.buildForwardSet();
		const desiredIngress = servedIngress ?? (await this.resolveIngressBinding(desired));

		const apiHostPort = desired.find((f) => f.targetPort === this.env.get("API_PORT"))?.hostPort ?? null;
		const webHostPort = desired.find((f) => f.targetPort === PLATFORM_WEB_INTERNAL_PORT)?.hostPort ?? null;

		const spec = this.buildProxySwarmSpec(desired, stableJson(desired), desiredIngress);
		return {
			process: await this.describeSwarmProcess(spec),
			urls: {
				apiDirectUrl: active && apiHostPort !== null ? `http://localhost:${String(apiHostPort)}` : null,
				webDirectUrl: active && webHostPort !== null ? `http://localhost:${String(webHostPort)}` : null,
			},
			ingressUrls:
				desiredIngress === null
					? null
					: {
							entryPort: desiredIngress.entryPort,
							apiUrl: `http://${desiredIngress.apiHost}`,
							webUrl: `http://${desiredIngress.webHost}`,
							serving: active && servedIngress !== null,
						},
		};
	}
}

/** Stable JSON: fixed field order so label comparisons are deterministic. */
function stableJson(forwards: DirectProxyForward[]): string {
	return JSON.stringify(forwards.map((f) => ({ hostPort: f.hostPort, target: f.target, targetPort: f.targetPort })));
}

/** Stable JSON for the mirrored ingress (null → the literal marker "none"). */
function stableIngressJson(ingress: DirectProxyIngress | null): string {
	if (ingress === null) return "none";
	return JSON.stringify({
		entryPort: ingress.entryPort,
		apiHost: ingress.apiHost,
		webHost: ingress.webHost,
		apiTarget: ingress.apiTarget,
		apiPort: ingress.apiPort,
		webTarget: ingress.webTarget,
		webPort: ingress.webPort,
	});
}