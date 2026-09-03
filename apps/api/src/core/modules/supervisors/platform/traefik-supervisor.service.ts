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

import { Injectable } from "@nestjs/common";
import http from "node:http";
import { stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import z from "zod/v4";

import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { PlatformPaths } from "../../platform-ingress/services/platform-paths";
import { PlatformIngressSettingsService } from "../../platform-ingress/services/platform-ingress-settings.service";
import { platformTraefikContainerName } from "../../platform-ingress/services/platform-names";
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
import { splitManagedEnv } from "@repo/env";
import { resolveDockerHostIp } from "@/core/modules/setup/utils/docker-host.utils";

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
	container: z
		.object({
			id: z.string(),
			name: z.string(),
			image: z.string(),
			running: z.boolean(),
			exitCode: z.number().int().nullable(),
			sizeRw: z.number().int().min(0).nullable(),
			sizeRootFs: z.number().int().min(0).nullable(),
			restartCount: z.number().int().min(0),
			startedAt: z.string().datetime().nullable(),
		})
		.nullable(),
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
	process: dockerProcessInfoSchema,
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
export class TraefikSupervisorService extends BaseDockerSupervisorService<
	typeof traefikSupervisorPayloadSchema,
	typeof traefikProcessInfoSchema
> {
	static readonly identifier = PLATFORM_INGRESS_SUPERVISOR_ID;
	readonly description = "Platform Traefik ingress routing api.<prefix>deployer.localhost";

	/** Container label recording the desired entry port (recreate-on-change). */
	static readonly ENTRY_PORT_LABEL = "deployer.ingress.entry-port";

	readonly payloadSchema = traefikSupervisorPayloadSchema;
	readonly processInfoSchema = traefikProcessInfoSchema;

	private static readonly PROBE_TIMEOUT_MS = 3_000;
	private static readonly SETTLE_WINDOW_MS = 3_000;

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

	/** Deterministic container spec for the platform Traefik. The HTTP
	 *  entrypoint is published outside production; headless deployments (prod
	 *  behind the user's own proxy, or dev when the host port is taken) keep
	 *  the entrypoint internal. Routing comes from the builder-generated
	 *  dynamic config (file provider); the docker provider stays enabled for
	 *  label-based discovery of future containers.
	 *
	 *  `hostPort` semantics:
	 *    - `undefined` → default (dev: env-configured port, prod: headless)
	 *    - `null`      → force HEADLESS (no host binding — port-conflict
	 *                    fallback)
	 *    - a number    → publish that specific host port */
	protected buildContainerSpec(hostPort: number | null | undefined = undefined): DockerSupervisorContainerSpec {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const socketPath =
			this.env.get("DOCKER_HOST")?.replace("unix://", "") ?? "/var/run/docker.sock";
		const isProduction = this.env.get("NODE_ENV") === "production";
		const port =
			hostPort === null
				? undefined
				: hostPort !== undefined
					? hostPort
					: isProduction
						? undefined
						: this.env.get("DEPLOYER_TRAEFIK_HTTP_PORT");

		// W5 TLS scaffolding: `DEPLOYER_TRAEFIK_TLS_ENABLED=true` adds the
		// websecure (443) entrypoint + an HTTP→HTTPS redirect. TLS serves
		// Traefik's built-in SELF-SIGNED default certificate until a real
		// certificate source (file store / ACME) is configured — perfect for
		// the first production deploy behind the platform hostname; opt-out
		// (default) keeps the plain-HTTP dev/localhost flows untouched.
		const tlsEnabled = this.env.get("DEPLOYER_TRAEFIK_TLS_ENABLED") === true;
		const command = [
			"--providers.docker=true",
			"--providers.docker.exposedbydefault=false",
			"--providers.file.directory=/config",
			"--providers.file.watch=true",
			"--entrypoints.web.address=:80",
			...(tlsEnabled
				? [
						"--entrypoints.websecure.address=:443",
						"--entrypoints.web.http.redirections.entrypoint.to=websecure",
						"--entrypoints.web.http.redirections.entrypoint.scheme=https",
						"--entrypoints.web.http.redirections.entrypoint.permanent=true",
					]
				: []),
		];

		return {
			name: platformTraefikContainerName(prefix),
			image: this.env.get("DEPLOYER_TRAEFIK_IMAGE"),
			networkName: PlatformNetwork.name(prefix),
			command,
			// Config files are shared via a NAMED VOLUME: the API writes them
			// under /app/traefik-configs (mounted from the volume by compose)
			// and Traefik mounts the same volume at /config. Binding the
			// volume name (not a container-internal path) is what makes the
			// file provider actually see the generated configs.
			binds: [`${socketPath}:/var/run/docker.sock:ro`, `${this.traefikConfigVolume()}:${TRAEFIK_CONFIG_MOUNT}:ro`],
			portBindings: port === undefined ? undefined : {
				"80/tcp": [{ HostPort: String(port) }],
				...(tlsEnabled ? { "443/tcp": [{ HostPort: String(443) }] } : {}),
			},
			restartPolicy: "unless-stopped",
			labels: {
				[PLATFORM_ROLE_LABEL]: PLATFORM_INGRESS_ROLE,
				"deployer.platform.api-hostname": this.hostnameService.apiHostname(),
				...(tlsEnabled ? { "deployer.traefik.tls": "enabled" } : {}),
				// Record the desired ENTRY PORT — the reconcile compares this
				// label to recreate the container when the web changes it.
				...(port !== undefined ? { [TraefikSupervisorService.ENTRY_PORT_LABEL]: String(port) } : {}),
			},
		};
	}

	/** One idempotent convergence pass: resolve the ENTRY PORT (local settings,
	 *  default 80) → network → attach API → write routes → inspect → create/
	 *  start → verify.
	 *
	 *  ENTRY-PORT SEMANTICS:
	 *    - Desired host port comes from the local settings (entry port), NOT a
	 *      silent auto-headless fallback. Default is 80.
	 *    - When the port is unavailable (already bound), the reconcile THROWS
	 *      → the supervisor is marked DEGRADED (an ERROR the web can see).
	 *      The web then lets the operator set a different entry port; changing
	 *      it (re-label) RECREATES the container on the new port and rechecks.
	 *    - Production headless (no host port, behind the user's own proxy) is
	 *      the only case with no host binding. */
	protected async reconcile(): Promise<void> {
		await this.runWithBackoff(
			"Platform ingress convergence",
			async () => {
				const entry = await this.settings.getPlatformEntry();
				const desiredPort = this.isProduction() ? null : entry.port;
				const spec = this.buildContainerSpec(desiredPort);

				const networkId = spec.networkName !== undefined ? await this.ensureNetwork(spec.networkName) : undefined;

				// Ensure the shared config volume exists (compose usually creates
				// it; belt-and-suspenders for dockerode-only deployments).
				await this.ensureVolume(this.traefikConfigVolume());

				// The API must be reachable from inside the platform network for
				// Traefik to forward to it. Attach our own container idempotently.
				if (networkId !== undefined) {
					await this.connectSelfToNetwork(networkId);
				}

				// NOTE: config files (dynamic-*.yml) are handled by the TRAEFIK
				// CORE module (TraefikPlatformConfigService) — the file-provider
				// watcher reloads them; this supervisor only ensures the PROCESS.

				const inspect = await this.inspectContainer(spec.name);
				// Recreate when the DESIRED entry port changed (label mismatch) —
				// the web setting a new port must restart Traefik on it.
				const labelPort = inspect !== null ? await this.readEntryPortLabel(inspect.Id) : null;
				const portChanged = desiredPort !== null && labelPort !== null && desiredPort !== labelPort;

				try {
					if (inspect === null) {
						// Fresh create on the (possibly new) entry port.
						await this.pullImage(spec.image);
						const container = await this.createContainer(spec, networkId);
						await container.start();
					} else if (portChanged) {
						this.logger.log(`Entry port changed ${String(labelPort)} → ${String(desiredPort)} — recreating Traefik`);
						await this.removeZombieContainer(spec.name);
						await this.pullImage(spec.image);
						const container = await this.createContainer(spec, networkId);
						await container.start();
					} else if (!inspect.State.Running) {
						await this.client.getContainer(spec.name).start();
					}
				} catch (startError) {
					// Entry port unavailable (already bound elsewhere) → remove
					// the broken container and throw a CONFLICT error that
					// skips further backoff retries (it is deterministic — the
					// same port will keep failing). The supervisor is marked
					// DEGRADED; the web surfaces this error and lets the
					// operator set a free entry port (recreate-on-change).
					if (!this.isPortBindError(startError)) throw startError;
					this.logger.warn(`Entry port ${String(desiredPort ?? "-")} unavailable — Traefik DEGRADED`);
					await this.removeZombieContainer(spec.name);
					throw new EntryPortConflictError(desiredPort ?? 80);
				}

				await this.verifyConvergence(spec);
			},
			{ maxAttempts: 5 },
		);
	}

	/** Read the desired entry port recorded on an existing container (label). */
	private async readEntryPortLabel(containerId: string): Promise<number | null> {
		try {
			const info = await this.client.getContainer(containerId).inspect();
			const raw = ((info.Config?.Labels ?? {}) as Record<string, string>)[TraefikSupervisorService.ENTRY_PORT_LABEL];
			if (raw === undefined) return null;
			const parsed = Number.parseInt(raw, 10);
			return Number.isFinite(parsed) ? parsed : null;
		} catch {
			return null;
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

	/** Force-remove a partially-created container, tolerating already-gone. */
	private async removeZombieContainer(name: string): Promise<void> {
		await this.removeContainerIfExists(name);
		this.logger.warn(`Removed zombie Traefik container "${name}" from the failed bind attempt`);
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

	/** Idempotently attach our own container to the platform network. The API
	 *  is usually ALREADY attached (compose declares the platform network) —
	 *  the check is by NAME or ID and Docker's 403 “already exists” race is
	 *  treated as benign. */
	private async connectSelfToNetwork(networkId: string): Promise<void> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return; // not in Docker

		const ownName = await this.resolveOwnContainerName();
		const network = this.client.getNetwork(networkId);
		const isAttached = async (): Promise<boolean> => {
			const details = await network.inspect().catch(() => null);
			return Object.values(details?.Containers ?? {}).some((entry) => {
				if (typeof entry !== "object" || entry === null) return false;
				const name = (entry as { Name?: string }).Name?.replace(/^\//, "") ?? "";
				return name === ownName;
			});
		};
		if (await isAttached()) return;

		try {
			await network.connect({ Container: selfId });
		} catch (error) {
			// Docker BANS connecting an already-attached endpoint (403 “…
			// already exists in network …”). That message is the PROOF the
			// container is already on the network (compose attached it) —
			// treat it as benign. Everything else: recheck by name, and only
			// rethrow when we're definitely absent.
			const message = error instanceof Error ? error.message : String(error);
			if (message.includes("already exists")) return;
			const attached = await isAttached();
			if (!attached) throw error;
		}
	}

	/**
	 * REAL health observation: container state + sizes (docker inspect), real
	 * entrypoint HTTP probe across candidate hosts (status code + latency) and
	 * dynamic-config file size. Never throws for an unhealthy resource — the
	 * payload records exactly what is broken.
	 */
	protected async probe(): Promise<SupervisorProbeResult<typeof traefikSupervisorPayloadSchema>> {
		const spec = this.buildContainerSpec();
		const startedAt = Date.now();

		const inspect = await this.inspectContainer(spec.name);
		const inspectDetails = inspect as unknown as {
			SizeRw?: number;
			SizeRootFs?: number;
			RestartCount?: number;
			State?: { StartedAt?: string };
		} | null;
		const container =
			inspect === null
				? null
				: {
						id: inspect.Id,
						name: spec.name,
						image: spec.image,
						running: inspect.State.Running,
						exitCode: inspect.State.ExitCode ?? null,
						sizeRw: inspectDetails?.SizeRw ?? null,
						sizeRootFs: inspectDetails?.SizeRootFs ?? null,
						restartCount: inspectDetails?.RestartCount ?? 0,
						startedAt: inspectDetails?.State?.StartedAt ?? null,
					};

		let healthy: boolean;
		let detail: string;
		let entrypoint: EntrypointProbe;
		if (spec.portBindings === undefined) {
			// Headless (prod behind user's own proxy, or host-port conflict):
			// the entrypoint has no host-reachable mapping, but when running
			// inside Docker we can still do a REAL HTTP probe via the
			// container name over the platform network (docker embedded DNS).
			// Bare-metal keeps the running-state check only.
			if (this.runsInsideContainer()) {
				entrypoint = await this.probeEntrypoint(await this.resolveProbeCandidates(spec.name));
				if (inspect === null) {
					healthy = false;
					detail = "container missing";
				} else if (!inspect.State.Running) {
					healthy = false;
					detail = `container not running (exit ${String(inspect.State.ExitCode ?? "?")})`;
				} else if (!entrypoint.reachable) {
					healthy = false;
					detail = `container running but entrypoint unreachable over the platform network`;
				} else {
					healthy = true;
					detail = `routing ${this.hostnameService.apiHostname()} (internal entrypoint, HTTP ${String(entrypoint.statusCode ?? "?")})`;
				}
			} else {
				entrypoint = { reachable: true, host: "(internal)", port: 80, statusCode: null, latencyMs: null };
				if (inspect === null) {
					healthy = false;
					detail = "container missing";
				} else if (!inspect.State.Running) {
					healthy = false;
					detail = `container not running (exit ${String(inspect.State.ExitCode ?? "?")})`;
				} else {
					healthy = true;
					detail = `routing ${this.hostnameService.apiHostname()} (internal entrypoint)`;
				}
			}
		} else {
			entrypoint = await this.probeEntrypoint(await this.resolveProbeCandidates(spec.name));
			if (entrypoint.reachable) {
				healthy = true;
				detail = `routing ${this.hostnameService.apiHostname()} via ${entrypoint.host}:${String(entrypoint.port)} (HTTP ${String(entrypoint.statusCode ?? "?")})`;
			} else {
				healthy = false;
				detail = `entrypoint unreachable (${entrypoint.host}): HTTP probe failed`;
			}
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
				container,
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

	/** Payload shape when the probe mechanism itself fails (docker socket down, etc.). */
	protected buildDegradedPayload(_detail: string): z.output<typeof traefikSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			container: null,
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
		const spec = this.buildContainerSpec(desiredPort);
		const published = spec.portBindings !== undefined;
		return {
			process: await this.describeDockerProcess(spec),
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

	/** Proof of convergence right after create/start within a backoff attempt. */
	private async verifyConvergence(spec: DockerSupervisorContainerSpec): Promise<void> {
		if (spec.portBindings !== undefined) {
			// The outer runWithBackoff retries the entire reconcile pass,
			// so a transient refusal (Traefik still binding) resolves on the
			// next attempt with backoff delay.
			const probe = await this.probeEntrypoint(await this.resolveProbeCandidates(spec.name));
			if (!probe.reachable) {
				throw new Error(`ingress entrypoint not reachable after start (${probe.host}:${String(probe.port)})`);
			}
			return;
		}
		// No published port (headless prod behind user's own proxy) — re-read
		// state after a short settle window; Traefik exits fast on bad config,
		// so still-running shortly after start is a solid liveness signal.
		await this.delay(TraefikSupervisorService.SETTLE_WINDOW_MS);
		const inspect = await this.inspectContainer(spec.name);
		if (inspect === null || !inspect.State.Running) {
			throw new Error(`ingress container exited during settle window (exit ${String(inspect?.State.ExitCode ?? "missing")})`);
		}
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
