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

import {
	BaseDockerSupervisorService,
	type DockerSupervisorContainerSpec,
} from "@/core/modules/docker/services/base-docker-supervisor.service";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@/core/modules/supervisors/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	dockerProcessInfoSchema,
} from "@/core/modules/supervisors/supervisor-process-info";
import { EnvService } from "@/config/env/env.service";
import { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import { PLATFORM_WEB_INTERNAL_PORT } from "../../platform-ingress/services/platform-names";
import { PlatformNetwork, TraefikSupervisorService } from "./traefik-supervisor.service";

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
	container: z
		.object({
			id: z.string(),
			name: z.string(),
			running: z.boolean(),
			exitCode: z.number().int().nullable(),
			startedAt: z.string().datetime().nullable(),
		})
		.nullable(),
});
export type DirectPortProxyPayload = z.output<typeof directPortProxyPayloadSchema>;

/** Process info: the nginx process + the direct host URLs it forwards to. */
export const directPortProxyProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: dockerProcessInfoSchema,
	urls: z.object({
		/** Direct API URL (null when the proxy is not running). */
		apiDirectUrl: z.string().nullable(),
		/** Direct web URL (null when the proxy is not running). */
		webDirectUrl: z.string().nullable(),
	}),
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

	private static readonly CONTAINER_BASE_NAME = "deployer-port-proxy";

	private eventSubscription: Subscription | undefined;

	constructor(
		dockerService: DockerService,
		private readonly env: EnvService,
		private readonly webTarget: PlatformWebTargetService,
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
	 * Required by the docker base, but the proxy's spec is ALWAYS derived
	 * from the current failover forwards (never a fixed container). This
	 * returns the spec for the DEFAULT forward set (api + web) so the
	 * process-info view always has a determinable container; the reconcile
	 * uses `buildProxySpec(forwards, hash)` per iteration.
	 */
	protected buildContainerSpec(): DockerSupervisorContainerSpec {
		return this.buildProxySpec(
			[{ hostPort: this.env.get("API_PORT"), target: "host.docker.internal", targetPort: this.env.get("API_PORT") }],
			"[]",
		);
	}

	/**
	 * Desired state: REMOVED while Traefik is the working single entry point,
	 * RUNNING (nginx forwarding api/web host ports) while Traefik is failed.
	 * Suppressed entirely by DEPLOYER_DIRECT_PROXY_ENABLED=false.
	 */
	protected async reconcile(): Promise<void> {
		if (!this.env.get("DEPLOYER_DIRECT_PROXY_ENABLED")) {
			await this.removeProxyContainer();
			return;
		}
		if (await this.isTraefikActingAsIngress()) {
			// Traefik is the single entry point — the proxy must not publish
			// any service port.
			await this.removeProxyContainer();
			return;
		}
		// Traefik FAILED (degraded on entry-port conflict, removed, or not
		// registered yet) — take over the service ports so the operator can
		// still reach the platform and fix the ingress.
		await this.runWithBackoff(
			"Direct-port proxy convergence",
			async () => {
				await this.ensureProxyRunning();
			},
			{ maxAttempts: 3 },
		);
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

	/** Create/update the nginx container for the api + web forwards, dropping
	 *  host ports already bound by other processes (self-healing). */
	private async ensureProxyRunning(): Promise<void> {
		let forwards = await this.buildForwardSet();
		if (forwards.length === 0) {
			throw new Error("direct-port proxy: no API/web target resolvable");
		}

		// Shared config volume — compose usually creates it; belt-and-
		// suspenders for dockerode-only deployments (same as Traefik).
		await this.ensureVolume(this.configVolume());

		const specBase = this.proxyContainerName();
		const dropped: number[] = [];

		for (let attempt = 0; attempt <= forwards.length && forwards.length > 0; attempt++) {
			const forwardsJson = stableJson(forwards);
			await this.writeNginxConfig(forwards);
			const spec = this.buildProxySpec(forwards, forwardsJson);
			const networkId =
				spec.networkName !== undefined ? await this.ensureNetwork(spec.networkName) : undefined;

			try {
				const inspect = await this.inspectContainer(specBase);
				if (inspect !== null) {
					// Restart-on-change: forwards (ports/targets/config) differ
					// from the recorded label → recreate. Otherwise just ensure
					// it is running.
					const recorded = await this.readForwardsLabel(inspect.Id);
					if (recorded === forwardsJson) {
						if (!inspect.State.Running) await this.client.getContainer(specBase).start();
						return;
					}
					this.logger.log(`Direct-port proxy forwards changed — recreating (${String(forwards.length)} forward(s))`);
					await this.removeProxyContainer();
				}
				await this.pullImage(spec.image);
				const container = await this.createContainer(spec, networkId);
				await container.start();
				return;
			} catch (error) {
				const boundPort = this.parseBindErrorHostPort(error);
				if (boundPort === null) throw error;
				this.logger.warn(`Direct-port proxy: host port ${String(boundPort)} already bound by another process — dropping it`);
				dropped.push(boundPort);
				forwards = forwards.filter((f) => f.hostPort !== boundPort);
				await this.removeProxyContainer();
			}
		}

		if (forwards.length === 0) {
			throw new Error(`direct-port proxy: all host ports are already bound by other processes (${dropped.join(", ")})`);
		}
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
	 * THIS API container's name on the platform network (docker embedded DNS
	 * target for the proxy). Inside Docker, HOSTNAME equals the container id
	 * — inspect it to get the canonical name. Outside Docker (bare-metal dev)
	 * the proxy targets the Docker HOST via host.docker.internal (ExtraHosts
	 * added to the container spec), where the API listens.
	 */
	private async resolveApiTarget(): Promise<string> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return "host.docker.internal";
		const info = await this.client.getContainer(selfId).inspect().catch(() => null);
		const name = ((info as unknown as { Name?: string })?.Name ?? "").replace(/^\//, "");
		return name !== "" ? name : "host.docker.internal";
	}

	/**
	 * Deterministic nginx config: one `server` block per forward, proxying to
	 * the container name over the platform network (docker embedded DNS).
	 */
	private async writeNginxConfig(forwards: DirectProxyForward[]): Promise<void> {
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
		const conf = `events {}\nhttp {\n  include /etc/nginx/mime.types;\n${servers}\n}\n`;

		const dir = this.configWriteDir();
		await mkdir(dir, { recursive: true });
		await writeFile(path.join(dir, "nginx.conf"), conf, "utf8");
	}

	/** Container spec for the current forwards. The forwards JSON is stamped
	 *  into a label — restart-on-change + probe reads it back for reporting. */
	private buildProxySpec(forwards: DirectProxyForward[], forwardsJson: string): DockerSupervisorContainerSpec {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const needsHostGateway = forwards.some((f) => f.target === "host.docker.internal");
		return {
			name: this.proxyContainerName(),
			image: this.env.get("DEPLOYER_DIRECT_PROXY_IMAGE"),
			networkName: PlatformNetwork.name(prefix),
			command: ["nginx", "-c", `${DIRECT_PORT_PROXY_CONFIG_MOUNT}/nginx.conf`, "-g", "daemon off;"],
			labels: {
				[DirectPortProxySupervisorService.FORWARDS_LABEL]: forwardsJson,
			},
			binds: [`${this.configVolume()}:${DIRECT_PORT_PROXY_CONFIG_MOUNT}:ro`],
			portBindings: Object.fromEntries(
				forwards.map((f) => [`${String(f.hostPort)}/tcp`, [{ HostPort: String(f.hostPort) }]]),
			),
			extraHosts: needsHostGateway ? ["host.docker.internal:host-gateway"] : undefined,
			restartPolicy: "unless-stopped",
		};
	}

	/** Remove the proxy container (no-op when already gone). */
	private async removeProxyContainer(): Promise<void> {
		await this.removeContainerIfExists(this.proxyContainerName());
	}

	private proxyContainerName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		return prefix === "" ? DirectPortProxySupervisorService.CONTAINER_BASE_NAME : `${DirectPortProxySupervisorService.CONTAINER_BASE_NAME}-${prefix}`;
	}

	/** API-side boss directory of the shared config volume. */
	private configWriteDir(): string {
		return this.env.get("DIRECT_PROXY_CONFIG_BASE_PATH") ?? "/app/port-proxy-config";
	}

	/** Named volume sharing nginx.conf with the proxy container. */
	private configVolume(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const envVol = this.env.get("DIRECT_PROXY_CONFIG_VOLUME");
		if (envVol !== undefined && envVol.trim().length > 0) return envVol.trim();
		return prefix === "" ? "deployer-port-proxy-config" : `deployer-port-proxy-config-${prefix}`;
	}

	/** The forwards JSON recorded on the running container (label). */
	private async readForwardsLabel(containerId: string): Promise<string | null> {
		try {
			const info = await this.client.getContainer(containerId).inspect();
			const raw = ((info.Config?.Labels ?? {}) as Record<string, string>)[DirectPortProxySupervisorService.FORWARDS_LABEL];
			return raw ?? null;
		} catch {
			return null;
		}
	}

	/** Extract the host port from a Docker port-bind failure; null when the
	 *  error is not a bind conflict (→ rethrow). */
	private parseBindErrorHostPort(error: unknown): number | null {
		const message = error instanceof Error ? error.message : String(error);
		if (!BIND_ERROR_HINTS.some((hint) => message.includes(hint))) return null;
		const match = /(\d{1,5})\/(tcp|udp)/.exec(message);
		if (match === null) return null;
		const port = Number(match[1]);
		return port >= 1 && port <= 65_535 ? port : null;
	}

	// ─── Health ─────────────────────────────────────────────────────────────

	/** REAL observation: the nginx container state + the recorded forwards
	 *  (read from the container label — no reconciliation triggered). */
	protected async probe(): Promise<SupervisorProbeResult<typeof directPortProxyPayloadSchema>> {
		const specBase = this.proxyContainerName();
		const startedAt = Date.now();
		const inspect = await this.inspectContainer(specBase);
		const forwards = inspect !== null ? await this.readForwards(inspect.Id) : [];

		const active = inspect !== null && inspect.State.Running && forwards.length > 0;
		const container =
			inspect === null
				? null
				: {
						id: inspect.Id,
						name: specBase,
						running: inspect.State.Running,
						exitCode: inspect.State.ExitCode ?? null,
						startedAt: inspect.State.StartedAt ?? null,
					};

		if (inspect === null) {
			return {
				healthy: true, // nothing to run while Traefik is the single entry point
				detail: "inactive — ingress (Traefik) is the single entry point",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, active: false, forwards: [], container: null },
			};
		}
		if (!active) {
			return {
				healthy: false,
				detail: `proxy container not forwarding (running=${String(inspect.State.Running)})`,
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, active: false, forwards, container },
			};
		}
		const summary = forwards.map((f) => `:${String(f.hostPort)}→${f.target}:${String(f.targetPort)}`).join(" ");
		return {
			healthy: true,
			detail: `forwarding ${summary}`,
			payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, active: true, forwards, container },
		};
	}

	/** Forwards decoded from the running container's label. */
	private async readForwards(containerId: string): Promise<DirectProxyForward[]> {
		const raw = await this.readForwardsLabel(containerId);
		if (raw === null) return [];
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

	/** Payload shape when the probe mechanism itself fails. */
	protected buildDegradedPayload(_detail: string): z.output<typeof directPortProxyPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			active: false,
			forwards: [],
			container: null,
		};
	}

	/** Non-fatal warning the operator must act on: Traefik is FAILED and the
	 *  fallback proxy has taken over the service ports. Fix = configure a
	 *  free entry port in the web console (Traefik then restarts and the
	 *  proxy closes itself). */
	protected collectWarnings(probe: SupervisorProbeResult<typeof directPortProxyPayloadSchema>): string[] {
		const base = super.collectWarnings(probe);
		if (probe.payload.active) {
			return [...base, "Traefik ingress is FAILED — the fallback proxy is forwarding the api/web ports directly. Fix the entry port from the web app."];
		}
		return base;
	}

	/** The entire config + live state of the fallback proxy process. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const specBase = this.proxyContainerName();
		const inspect = await this.inspectContainer(specBase);
		const forwards = inspect !== null ? await this.readForwards(inspect.Id) : [];
		const active = inspect !== null && inspect.State.Running && forwards.length > 0;

		// What the proxy would forward right now (its desired set) — used for
		// the docker process view even when it is currently removed.
		const desired = forwards.length > 0 ? forwards : await this.buildForwardSet();

		const apiHostPort = desired.find((f) => f.targetPort === this.env.get("API_PORT"))?.hostPort ?? null;
		const webHostPort = desired.find((f) => f.targetPort === PLATFORM_WEB_INTERNAL_PORT)?.hostPort ?? null;

		return {
			process: await this.describeDockerProcess(this.buildProxySpec(desired, stableJson(desired))),
			urls: {
				apiDirectUrl: active && apiHostPort !== null ? `http://localhost:${String(apiHostPort)}` : null,
				webDirectUrl: active && webHostPort !== null ? `http://localhost:${String(webHostPort)}` : null,
			},
		};
	}
}

/** Stable JSON: fixed field order so label comparisons are deterministic. */
function stableJson(forwards: DirectProxyForward[]): string {
	return JSON.stringify(forwards.map((f) => ({ hostPort: f.hostPort, target: f.target, targetPort: f.targetPort })));
}