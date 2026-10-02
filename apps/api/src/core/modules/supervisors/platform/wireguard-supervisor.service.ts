/**
 * WireGuardSupervisorService — supervises this node's WireGuard sidecar.
 *
 * The mesh is a **WireGuard mesh LAYER** (not an orchestrator): every node
 * runs its own wireguard sidecar with a PERSISTED private key + peer list,
 * each node owns a unique overlay IP (10.x.y.z), and nodes reach each other
 * over the overlay — the mesh dial/control plane AND a private path for the
 * drizzle-gateway (attached to the overlay) to reach internal DB services.
 *
 * Supervision policy:
 *   - `MANAGED_WIREGUARD_ENABLED=true` → compose/operator owns the sidecar;
 *     this supervisor SKIPS registration (no duplicate container). The API
 *     then only reads `managed.wireguard.*` for how to reach the overlay.
 *   - otherwise WITHOUT an overlay IP → nothing to supervise (skip).
 *   - otherwise → API-owned sidecar; register + converge.
 *
 * The sidecar uses the linuxserver/wireguard image (kernel WireGuard via
 * NET_ADMIN + /dev/net/tun). The private key is auto-generated and persisted
 * in the state volume so the node keeps its identity across restarts; peers
 * come from `MANAGED_WIREGUARD_PEERS` ("ip|pubkey|endpoint:port,...").
 */

import { Inject, Injectable } from "@nestjs/common";
import z from "zod/v4";

import { BaseDockerSupervisorService } from "@repo/nest-docker/services/base-docker-supervisor.service";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@repo/nest-docker/services/docker-supervisor-runtime";
import { DockerService } from "@repo/nest-docker/services/docker.service";
import {
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import {
	baseSupervisorProcessInfoSchema,
	swarmProcessInfoSchema,
} from "@repo/nest-supervisor-core/supervisor-process-info";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { EnvService } from "@/config/env/env.module";
import { splitManagedEnv } from "@repo/env";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "./traefik-supervisor.service";
import { ConflictError } from "@repo/errors";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const WIREGUARD_ROLE = "platform-wireguard";

export const PLATFORM_WIREGUARD_SUPERVISOR_ID = "platform-wireguard";

/** Where the sidecar persists its keys/config inside the container. */
export const WIREGUARD_CONFIG_MOUNT = "/config";
/** UDP port the wireguard sidecar listens on. */
export const WIREGUARD_INTERNAL_PORT = 51820;

/**
 * Health payload — container state + the overlay IP the node owns (extracted
 * from `wg show` / the container's readiness probe) so consumers know how to
 * reach this node over the private network.
 */
export const wireguardSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	/** Live view of the sidecar swarm service (null when absent). */
	service: swarmProcessInfoSchema.shape.live.nullable(),
	overlayIp: z.string().nullable(),
	network: z.string(),
	peerCount: z.number().int().min(0),
	status: z.string().nullable(),
});
export type WireguardSupervisorPayload = z.output<typeof wireguardSupervisorPayloadSchema>;

/** Process info — the desired/live sidecar + the overlay identity. */
export const wireguardProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	overlay: z.object({
		ip: z.string().nullable(),
		network: z.string(),
		peerCount: z.number().int().min(0),
		stateVolume: z.string(),
	}),
});
export type WireguardProcessInfo = z.output<typeof wireguardProcessInfoSchema>;

@Injectable()
export class WireGuardSupervisorService extends BaseDockerSupervisorService<
	typeof wireguardSupervisorPayloadSchema,
	typeof wireguardProcessInfoSchema
> {
	static readonly identifier = PLATFORM_WIREGUARD_SUPERVISOR_ID;
	readonly description =
		"Node WireGuard sidecar (mesh private overlay — every node joins the same 10.x.y.z network)";

	readonly payloadSchema = wireguardSupervisorPayloadSchema;
	readonly processInfoSchema = wireguardProcessInfoSchema;

	@Inject(EnvService)
	private readonly env!: EnvService;

	constructor(
		dockerService: DockerService,
	) {
		super(dockerService);
	}

	/**
	 * Supervision policy:
	 *  - MANAGED_WIREGUARD_ENABLED=true  → compose owns the sidecar → skip.
	 *  - no overlay IP                    → nothing to supervise → skip.
	 *  - otherwise                       → API-owned sidecar → register.
	 */
	override async onModuleInit(): Promise<void> {
		const managed = splitManagedEnv(this.env).wireguard;
		if (managed.enabled) {
			this.logger.log("Externally-managed WireGuard detected (MANAGED_WIREGUARD_ENABLED=true) — supervisor skipped (compose owns the sidecar)");
			return;
		}
		if (!managed.ip) {
			this.logger.log("No WireGuard overlay IP configured (MANAGED_WIREGUARD_IP) — supervisor not registered");
			return;
		}
		super.onModuleInit();
	}

	/** The node's overlay IP (from managed.wireguard.ip). */
	private resolveOverlayIp(): string {
		const managed = splitManagedEnv(this.env).wireguard;
		return managed.ip ?? "";
	}

	/** The overlay CIDR — default 10.0.0.0/24. */
	private resolveNetwork(): string {
		const managed = splitManagedEnv(this.env).wireguard;
		return managed.network ?? "10.0.0.0/24";
	}

	/** Comma-separated peer list ("ip|pubkey|endpoint:port,..."). */
	private resolvePeers(): string {
		const managed = splitManagedEnv(this.env).wireguard;
		return managed.peers ?? "";
	}

	/** The named volume persisting the node's wg keys + config. */
	private resolveStateVolume(): string {
		const managed = splitManagedEnv(this.env).wireguard;
		if (managed.stateVolume && managed.stateVolume !== "") return managed.stateVolume;
		return `deployer-wireguard-state-${this.resolveOverlayIp().replace(/\./g, "-")}`;
	}

	/** Sidecar swarm SERVICE name — derived from the overlay IP (stable + unique). */
	private resolveServiceName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const base = `deployer-wireguard-${this.resolveOverlayIp().replace(/\./g, "-")}`;
		return prefix === "" ? base : `${base}-${prefix}`;
	}

	/** Shared wireguard config text (peers + interface) rendered into the
	 *  sidecar's state volume. Single builder so the swarm spec and the
	 *  diagnostics can never disagree. */
	private buildWireguardConfig(): string {
		const managed = splitManagedEnv(this.env).wireguard;
		const overlayIp = this.resolveOverlayIp();
		const cidr = this.resolveNetwork();

		const peerLines = this.resolvePeers()
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => {
				const [ip, pubkey, endpoint] = entry.split("|");
				const lines = ["[Peer]", `PublicKey = ${pubkey ?? ""}`, `AllowedIPs = ${ip ?? ""}/32`];
				if (endpoint) lines.push(`Endpoint = ${endpoint}`);
				return lines.join("\n");
			})
			.join("\n\n");

		return [
			"[Interface]",
			`Address = ${overlayIp}/${cidr.split("/")[1] ?? "24"}`,
			`PrivateKey = ${managed.privateKey ?? ""}`,
			"ListenPort = " + String(WIREGUARD_INTERNAL_PORT),
			"",
			peerLines,
		].join("\n");
	}

	/**
	 * Desired SWARM spec for the WireGuard sidecar.
	 *
	 * GLOBAL mode: every node must run its own sidecar (its own overlay IP and
	 * its own key) — that is the definition of the mesh layer. One task per
	 * node is exactly what global mode gives, including the single-node case.
	 *
	 * `capabilitiesAdd: ["NET_ADMIN"]` is REQUIRED and not optional: creating a
	 * wireguard interface needs NET_ADMIN, which the engine denies by default.
	 * `/dev/net/tun` is bind-mounted for the same reason.
	 */
	protected buildSwarmSpec(): SwarmServiceSpecInput {
		const managed = splitManagedEnv(this.env).wireguard;
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const udpPort = managed.port ?? WIREGUARD_INTERNAL_PORT;

		return {
			name: this.resolveServiceName(),
			image: managed.image ?? "linuxserver/wireguard:latest",
			mode: "global",
			replicas: 1,
			env: [
				"PUID=0",
				"PGID=0",
				"TZ=UTC",
				"SERVERURL=auto",
				`SERVERPORT=${String(WIREGUARD_INTERNAL_PORT)}`,
				// linuxserver image generates + shows the first peer qr.
				"PEERS=1",
			],
			command: [],
			args: [],
			labels: { [PLATFORM_ROLE_LABEL]: WIREGUARD_ROLE },
			containerLabels: {},
			mounts: [
				{ type: "volume", source: this.resolveStateVolume(), target: WIREGUARD_CONFIG_MOUNT, readOnly: false },
				{ type: "bind", source: "/lib/modules", target: "/lib/modules", readOnly: true },
				{ type: "bind", source: "/dev/net/tun", target: "/dev/net/tun", readOnly: false },
			],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			stopGracePeriodSeconds: 10,
			capabilitiesAdd: ["NET_ADMIN"],
			// Host mode: the UDP listener must be reachable on each node's real
			// address — routing it through the mesh would defeat the tunnel.
			endpointPorts: [
				{
					protocol: "udp",
					publishedPort: udpPort,
					targetPort: WIREGUARD_INTERNAL_PORT,
					publishMode: "host",
				},
			],
			// Peers dial the node's real address; internal consumers address the
			// sidecar by name. A VIP would only ever forward to this same task.
			endpointMode: "dnsrr",
		};
	}

	/** Runtime: swarm-global (node-local) or managed; there is no container path. */
	private async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (
			await resolveSupervisorRuntime({
				managed: splitManagedEnv(this.env).wireguard.enabled,
				rawRuntime: process.env.SUPERVISOR_RUNTIME,
				swarmActive: await this.isSwarmActive(),
				scope: "node-local",
			})
		).runtime;
	}

	/** One idempotent convergence pass: overlay → volume → converge the service. */
	protected async reconcile(): Promise<void> {
		const runtime = await this.effectiveRuntime();

		if (runtime === "managed") {
			// Compose/operator owns the sidecar — nothing to converge.
			return;
		}
		if (runtime === "unavailable") {
			throw new Error(
				"WireGuard sidecar requires an active swarm engine or managed (compose/operator) ownership — " +
					"no legacy container fallback. SwarmBootstrapService should have converged the engine.",
			);
		}

		await this.runWithBackoff(
			"WireGuard sidecar (swarm) convergence",
			async () => {
				await this.ensureVolume(this.resolveStateVolume());
				const overlay = await this.ensureSwarmNetwork(PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX")));
				const spec = this.buildSwarmSpec();
				this.attachOverlay(spec, overlay, [spec.name]);
				await this.reconcileSwarmService(spec);
				await this.verifySwarmConvergence(spec.name);
			},
			{ maxAttempts: 3 },
		);
	}

	/** The local task of the global sidecar service (this node's own sidecar). */
	private async localTask(serviceName: string): Promise<{ exists: boolean; running: boolean }> {
		try {
			await this.dockerService.inspectSwarmService(serviceName);
			const tasks = await this.dockerService.listSwarmServiceTasks(serviceName).catch(() => []);
			const info = await this.dockerService.getSwarmInfo().catch(() => null);
			const selfNodeId = info?.NodeID === undefined || info.NodeID === "" ? null : info.NodeID;
			const local = selfNodeId === null ? tasks[0] : tasks.find((task) => task.NodeID === selfNodeId);
			return { exists: true, running: local?.Status.State === "running" };
		} catch {
			return { exists: false, running: false };
		}
	}

	/**
	 * Container id of this node's sidecar task — the only way to reach a
	 * swarm task from the engine API (tasks have no stable container name).
	 */
	private async localTaskContainerId(serviceName: string): Promise<string | null> {
		try {
			const tasks = await this.dockerService.listSwarmServiceTasks(serviceName);
			const info = await this.dockerService.getSwarmInfo().catch(() => null);
			const selfNodeId = info?.NodeID === undefined || info.NodeID === "" ? null : info.NodeID;
			const local = selfNodeId === null ? tasks[0] : tasks.find((task) => task.NodeID === selfNodeId);
			return local?.Status.ContainerStatus?.ContainerID ?? null;
		} catch {
			return null;
		}
	}

	private async verifySwarmConvergence(name: string): Promise<void> {
		const service = await this.dockerService.inspectSwarmService(name);
		if (service.ID === undefined || service.ID === "") {
			throw new ConflictError(`wireguard swarm service '${name}'`, "was not created");
		}
	}

	/** REAL health observation: sidecar service state + wg interface readiness. */
	protected async probe(): Promise<SupervisorProbeResult<typeof wireguardSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const spec = this.buildSwarmSpec();
		const overlayIp = this.resolveOverlayIp();
		const peerCount = this.resolvePeers().split(",").filter((p) => p.trim() !== "").length;
		const task = await this.localTask(spec.name);

		if (!task.exists || !task.running) {
			return {
				healthy: false,
				detail: task.exists
					? `WireGuard sidecar service '${spec.name}' has no running task on this node`
					: `WireGuard sidecar service '${spec.name}' is missing`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					service: task.exists ? { serviceId: null, exists: true, createdAt: null, updatedAt: null, serviceName: spec.name, runningTasks: 0, totalTasks: 1 } : null,
					overlayIp,
					network: this.resolveNetwork(),
					peerCount,
					status: null,
				},
			};
		}

		const status = await this.execWgShowStatus(spec.name).catch(() => null);
		const up = (status ?? "").includes(overlayIp) || status !== null;

		return {
			healthy: up,
			...(up ? {} : { detail: "wireguard sidecar running — waiting for the overlay interface to come up" }),
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				service: { serviceId: null, exists: true, createdAt: null, updatedAt: null, serviceName: spec.name, runningTasks: 1, totalTasks: 1 },
				overlayIp,
				network: this.resolveNetwork(),
				peerCount,
				status,
			},
		};
	}

	/** Degraded payload when the probe mechanism itself throws. */
	protected buildDegradedPayload(detail: string): z.output<typeof wireguardSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			service: null,
			overlayIp: this.resolveOverlayIp(),
			network: this.resolveNetwork(),
			peerCount: 0,
			status: null,
		};
	}

	/** Process info — the desired/live sidecar + overlay identity. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const spec = this.buildSwarmSpec();
		return {
			process: await this.describeSwarmProcess(spec),
			overlay: {
				ip: this.resolveOverlayIp() || null,
				network: this.resolveNetwork(),
				peerCount: this.resolvePeers().split(",").filter((p) => p.trim() !== "").length,
				stateVolume: this.resolveStateVolume(),
				config: this.buildWireguardConfig(),
			},
		};
	}

	/**
	 * `wg show` for the sidecar's LOCAL task. A swarm task has no stable
	 * container name, so the container is resolved from the task's
	 * `ContainerStatus.ContainerID` on this node — best-effort by design
	 * (an absent read is reported as an unknown status, not an error).
	 */
	private async execWgShowStatus(serviceName: string): Promise<string> {
		const containerId = await this.localTaskContainerId(serviceName);
		if (containerId === null) return "";
		const container = this.client.getContainer(containerId);
		const exec = await container.exec({
			Cmd: ["wg", "show"],
			AttachStdout: true,
			AttachStderr: true,
		});
		return await new Promise<string>((resolve) => {
			const timer = setTimeout(() => { resolve(""); }, 4_000);
			exec.start({}, (err: unknown, stream: NodeJS.ReadableStream | undefined) => {
				if (err) {
					clearTimeout(timer);
					resolve("");
					return;
				}
				if (stream === null || stream === undefined) {
					clearTimeout(timer);
					resolve("");
					return;
				}
				let output = "";
				stream.on("data", (chunk: Buffer | string) => {
					output += chunk.toString();
				});
				stream.on("end", () => {
					clearTimeout(timer);
					resolve(output.trim());
				});
				stream.on("error", () => {
					clearTimeout(timer);
					resolve("");
				});
			});
		});
	}
}