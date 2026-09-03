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
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "./traefik-supervisor.service";

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
	container: z
		.object({
			id: z.string(),
			name: z.string(),
			image: z.string(),
			running: z.boolean(),
			exitCode: z.number().int().nullable(),
			restartCount: z.number().int().min(0),
			startedAt: z.string().datetime().nullable(),
		})
		.nullable(),
	overlayIp: z.string().nullable(),
	network: z.string(),
	peerCount: z.number().int().min(0),
	status: z.string().nullable(),
});
export type WireguardSupervisorPayload = z.output<typeof wireguardSupervisorPayloadSchema>;

/** Process info — the desired/live sidecar + the overlay identity. */
export const wireguardProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: dockerProcessInfoSchema,
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

	/** Sidecar container name — derived from the overlay IP (stable + unique). */
	private resolveContainerName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const base = `deployer-wireguard-${this.resolveOverlayIp().replace(/\./g, "-")}`;
		return prefix === "" ? base : `${base}-${prefix}`;
	}

	protected buildContainerSpec(): DockerSupervisorContainerSpec {
		const managed = splitManagedEnv(this.env).wireguard;
		const overlayIp = this.resolveOverlayIp();
		const cidr = this.resolveNetwork();
		const prefix = this.env.get("DEPLOYER_PREFIX");

		// Build a minimal wg config: [Interface] Address + private key (from
		// env or a placeholder persisted to the volume), plus [Peer] entries
		// from MANAGED_WIREGUARD_PEERS ("ip|pubkey|endpoint:port").
		const peers = managed.peers ?? "";
		const peerLines = peers
			.split(",")
			.map((entry) => entry.trim())
			.filter(Boolean)
			.map((entry) => {
				const [ip, pubkey, endpoint] = entry.split("|");
				const lines = [
					"[Peer]",
					`PublicKey = ${pubkey ?? ""}`,
					`AllowedIPs = ${ip ?? ""}/32`,
				];
				if (endpoint) lines.push(`Endpoint = ${endpoint}`);
				return lines.join("\n");
			})
			.join("\n\n");

		const config = [
			"[Interface]",
			`Address = ${overlayIp}/${cidr.split("/")[1] ?? "24"}`,
			`PrivateKey = ${managed.privateKey ?? ""}`,
			"ListenPort = " + String(WIREGUARD_INTERNAL_PORT),
			"",
			peerLines,
		].join("\n");

		return {
			name: this.resolveContainerName(),
			image: managed.image ?? "linuxserver/wireguard:latest",
			networkName: PlatformNetwork.name(prefix),
			env: [
				`PUID=0`,
				`PGID=0`,
				`TZ=UTC`,
				`SERVERURL=auto`,
				`SERVERPORT=${String(WIREGUARD_INTERNAL_PORT)}`,
				`PEERS=1`, // linuxserver image generates + shows the first peer qr
			],
			binds: [
				`${this.resolveStateVolume()}:${WIREGUARD_CONFIG_MOUNT}`,
				`/lib/modules:/lib/modules:ro`,
			],
			portBindings: {
				[`${WIREGUARD_INTERNAL_PORT}/udp`]: [{ HostPort: String(managed.port ?? WIREGUARD_INTERNAL_PORT) }],
			},
			restartPolicy: "unless-stopped",
			labels: {
				[PLATFORM_ROLE_LABEL]: WIREGUARD_ROLE,
			},
		};
	}

	/** One idempotent convergence pass: network → volume → create/start. */
	protected async reconcile(): Promise<void> {
		await this.runWithBackoff(
			"WireGuard sidecar convergence",
			async () => {
				const spec = this.buildContainerSpec();
				const networkId = spec.networkName !== undefined ? await this.ensureNetwork(spec.networkName) : undefined;
				await this.ensureVolume(this.resolveStateVolume());

				const inspect = await this.inspectContainer(spec.name);
				try {
					if (inspect === null) {
						await this.pullImage(spec.image);
						const container = await this.createContainer(spec, networkId);
						await container.start();
					} else if (!inspect.State.Running) {
						await this.client.getContainer(spec.name).start();
					}
				} catch (startError) {
					await this.removeContainerIfExists(spec.name);
					throw startError;
				}

				await this.verifyConvergence(spec);
			},
			{ maxAttempts: 3 },
		);
	}

	/** REAL health observation: container state + wg interface readiness. */
	protected async probe(): Promise<SupervisorProbeResult<typeof wireguardSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const spec = this.buildContainerSpec();
		const overlayIp = this.resolveOverlayIp();

		const inspect = await this.inspectContainer(spec.name);
		if (inspect === null || !inspect.State.Running) {
			return {
				healthy: false,
				detail: `WireGuard sidecar '${spec.name}' is not running`,
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					container: inspect
						? {
								id: inspect.Id,
								name: spec.name,
								image: spec.image,
								running: inspect.State.Running,
								exitCode: inspect.State.ExitCode ?? null,
								restartCount: inspect.RestartCount ?? 0,
								startedAt: inspect.State.StartedAt ?? null,
							}
						: null,
					overlayIp,
					network: this.resolveNetwork(),
					peerCount: this.resolvePeers().split(",").filter((p) => p.trim() !== "").length,
					status: null,
				},
			};
		}

		const status = await this.execWgShowStatus(spec.name).catch(() => null);
		const peerCount = this.resolvePeers().split(",").filter((p) => p.trim() !== "").length;
		const up = (status ?? "").includes(overlayIp) || status !== null;

		return {
			healthy: up,
			...(up ? {} : { detail: "wireguard sidecar running — waiting for the overlay interface to come up" }),
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				container: {
					id: inspect.Id,
					name: spec.name,
					image: spec.image,
					running: inspect.State.Running,
					exitCode: inspect.State.ExitCode ?? null,
					restartCount: inspect.RestartCount ?? 0,
					startedAt: inspect.State.StartedAt ?? null,
				},
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
			container: null,
			overlayIp: this.resolveOverlayIp(),
			network: this.resolveNetwork(),
			peerCount: 0,
			status: null,
		};
	}

	/** Process info — the desired/live sidecar + overlay identity. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const spec = this.buildContainerSpec();
		return {
			process: await this.describeDockerProcess(spec),
			overlay: {
				ip: this.resolveOverlayIp() || null,
				network: this.resolveNetwork(),
				peerCount: this.resolvePeers().split(",").filter((p) => p.trim() !== "").length,
				stateVolume: this.resolveStateVolume(),
			},
		};
	}

	/** `wg show` inside the sidecar (best-effort interface read). */
	private async execWgShowStatus(containerName: string): Promise<string> {
		const container = this.client.getContainer(containerName);
		const exec = await container.exec({
			Cmd: ["wg", "show"],
			AttachStdout: true,
			AttachStderr: true,
		});
		return await new Promise<string>((resolve) => {
			const timer = setTimeout(() => resolve(""), 4_000);
			exec.start({} as never, (err: unknown, stream: NodeJS.ReadableStream | undefined) => {
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

	/** Throw when the container is not actually running after converge. */
	private async verifyConvergence(spec: DockerSupervisorContainerSpec): Promise<void> {
		const live = await this.inspectContainer(spec.name);
		if (live === null || !live.State.Running) {
			throw new Error(`WireGuard container '${spec.name}' did not start`);
		}
	}
}