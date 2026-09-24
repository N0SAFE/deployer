/**
 * SwarmAppWiringSupervisorService — keeps the platform's OWN app containers
 * attached to the Swarm OVERLAY while the engine is swarm-active.
 *
 * WHY this exists
 * ---------------
 * The platform runs a MIXED topology in dev/compose deployments:
 *
 *   - platform services (ingress, Redis, the managed database) become Swarm
 *     SERVICES on the attachable overlay (`deployer-platform-overlay`);
 *   - the API/web/doc containers stay plain CONTAINERS on the compose BRIDGE
 *     (`deployer-platform`) for fast iteration (hot reload).
 *
 * Docker networks are isolated, so without this wiring the swarm ingress has
 * no route to `web-dev` (every `*.deployer.localhost` 502s) and the API cannot
 * reach the swarm-scheduled database/Redis. Attaching the app containers to the
 * overlay makes them the BRIDGE HEAD between both planes.
 *
 * ADDRESSING (the subtle part)
 * ----------------------------
 * The ingress routes to a container by its **network alias** (`web-dev:3000`),
 * but the ENGINE addresses containers by **name/id**
 * (`nextjs-nestjs-supervised-web-dev`). Wiring must therefore:
 *
 *   1. resolve each configured target (`DEPLOYER_WEB_TARGET`, …) from the
 *      platform network's container list — matching container NAME **and**
 *      aliases, since the configured value is a compose alias;
 *   2. attach the resolved container to the overlay **carrying its aliases**,
 *      so the ingress keeps resolving `web-dev` on the overlay too.
 *
 * WHY a SUPERVISOR (and not a boot-time step)
 * -------------------------------------------
 * Container start order is not ours to assume: `web-dev` is declared with
 * `depends_on: api-dev: condition: service_healthy`, so it is created *after*
 * the API is already up. A one-shot "wire at boot" pass therefore always missed
 * it, and any `docker compose restart web-dev` would silently lose the overlay
 * again. Instead this is a CONVERGED supervisor:
 *
 *   - it reconciles on the normal supervisor cadence (boot + `convergeNow`),
 *   - reacts to Docker's container `start` events, so a container that
 *     appears or restarts LATER is wired immediately,
 *   - and re-converges on a 30s cadence as a safety net, so a missed event can
 *     never leave the ingress permanently unable to reach the app (see
 *     `RECONCILE_INTERVAL_MS`).
 *
 * Best-effort by design: with no active swarm (pre-setup, or a node that has
 * not converged yet) this is a no-op — the platform runs on plain containers.
 */

import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import type { Readable } from "node:stream";
import z from "zod/v4";

import { EnvService } from "@/config/env/env.module";
import { DockerService } from "@/core/modules/docker/services/docker.service";
import {
	platformNetworkName,
	platformOverlayForPrefix,
} from "@/core/modules/docker/services/docker-supervisor-runtime";
import {
	BaseSupervisorService,
	baseSupervisorPayloadSchema,
	type SupervisorProbeResult,
} from "@repo/nest-supervisor-core/base-supervisor.service";
import { baseSupervisorProcessInfoSchema } from "@repo/nest-supervisor-core/supervisor-process-info";

export const SWARM_APP_WIRING_SUPERVISOR_ID = "platform-app-wiring";

/** One app container's wiring status on the overlay. */
export const swarmAppWiringTargetSchema = z.object({
	/** Canonical container name (what the engine matches). */
	name: z.string().min(1),
	/** Network aliases re-declared on the overlay (how consumers address it). */
	aliases: z.array(z.string()),
	/** True when the container is attached to the overlay. */
	attached: z.boolean(),
});
export type SwarmAppWiringTarget = z.infer<typeof swarmAppWiringTargetSchema>;

/**
 * Rich health payload: whether the engine is swarm-active, the overlay name,
 * and the per-container attachment status.
 *
 * A configured target that is not RUNNING is simply absent from `targets` (the
 * wiring owns containers that run, not containers this deployment does not
 * define yet) — the Docker start event re-converges the moment it appears.
 */
export const swarmAppWiringPayloadSchema = baseSupervisorPayloadSchema.extend({
	swarmActive: z.boolean(),
	overlay: z.string().min(1),
	targets: z.array(swarmAppWiringTargetSchema),
});
export type SwarmAppWiringPayload = z.output<typeof swarmAppWiringPayloadSchema>;

/** Process info: the overlay this supervisor joins app containers to. */
export const swarmAppWiringProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	overlay: z.string().min(1),
	targets: z.array(swarmAppWiringTargetSchema),
});
export type SwarmAppWiringProcessInfo = z.output<typeof swarmAppWiringProcessInfoSchema>;

/** Minimal shape of the Docker daemon events we consume. */
const dockerEventSchema = z.object({
	Actor: z
		.object({
			Attributes: z.record(z.string(), z.string()).optional(),
		})
		.optional(),
});

/** A resolved container that must be reachable from swarm services. */
interface ResolvedTarget {
	/** Container id — stable handle for `network.connect`. */
	id: string;
	/** Canonical container name (`/name` stripped). */
	name: string;
	/** Every alias declared on the platform network (name included). */
	aliases: string[];
}

/** Container inspect fields this supervisor consumes. */
interface ContainerDetail {
	name: string;
	networkAliases: Record<string, string[]>;
}

@Injectable()
export class SwarmAppWiringSupervisorService
	extends BaseSupervisorService<typeof swarmAppWiringPayloadSchema, typeof swarmAppWiringProcessInfoSchema>
	implements OnModuleDestroy
{
	static readonly identifier = SWARM_APP_WIRING_SUPERVISOR_ID;
	readonly description =
		"Joins the app containers (API/web) to the Swarm overlay so the swarm ingress reaches them and they reach swarm-scheduled services";

	readonly payloadSchema = swarmAppWiringPayloadSchema;
	readonly processInfoSchema = swarmAppWiringProcessInfoSchema;

	/** Live Docker events stream used to re-wire containers that start later. */
	private eventStream: Readable | null = null;
	private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
	private reconcileTimer: ReturnType<typeof setTimeout> | null = null;
	private disposed = false;

	/**
	 * Safety-net cadence for the event-driven fast path.
	 *
	 * The Docker event stream is the FAST path (a container that starts later is
	 * wired within milliseconds). It is NOT sufficient on its own: reachability
	 * of the app containers is a correctness requirement, and a missed event —
	 * a stream that never opened, a dropped subscription, a daemon restart —
	 * leaves the ingress permanently 502-ing with no recovery. That failure mode
	 * was observed in practice: a `docker restart` of the web container was
	 * never wired, while an equivalent standalone subscription received the
	 * event normally.
	 *
	 * `reconcile()` is idempotent and cheap (one `listContainers` plus an
	 * inspect per target; it short-circuits when the aliases already match), so
	 * re-running it on a cadence costs nothing and makes convergence
	 * independent of event delivery. Same reasoning as the fleet-inventory
	 * sweep: the event path optimizes, the cadence guarantees.
	 */
	private static readonly RECONCILE_INTERVAL_MS = 30_000;

	constructor(
		private readonly dockerService: DockerService,
		private readonly envService: EnvService,
	) {
		super();
	}

	override onModuleInit(): void {
		super.onModuleInit();
		this.startWatchingContainerStarts();
		this.scheduleReconcile();
	}

	onModuleDestroy(): void {
		this.disposed = true;
		if (this.reconnectTimer !== null) {
			clearTimeout(this.reconnectTimer);
			this.reconnectTimer = null;
		}
		if (this.reconcileTimer !== null) {
			clearTimeout(this.reconcileTimer);
			this.reconcileTimer = null;
		}
		this.stopEventStream();
	}

	// ─── Desired state ───────────────────────────────────────────────────────

	/**
	 * Idempotent convergence: ensure the overlay exists and every app container
	 * that EXISTS is attached to it (carrying its aliases). A configured target
	 * that has not started yet is not an error — the Docker event subscription
	 * re-converges the moment it does.
	 */
	protected async reconcile(): Promise<void> {
		if (!(await this.isSwarmActive())) {
			// Containers-only phase (pre-setup or a node that has not converged):
			// there is no overlay to join, and the ingress runs as a container.
			return;
		}

		const overlay = this.overlayName();
		await this.dockerService.ensureOverlayNetwork({
			name: overlay,
			driver: "overlay",
			attachable: true,
			ingress: false,
			enableIpv6: false,
			labels: { "deployer.platform": "true", "deployer.managed": "true" },
		});

		const wired: string[] = [];
		for (const target of await this.resolveTargets()) {
			// Only a CHANGE is worth a log line: this reconcile runs on a
			// 30s safety-net cadence, so logging the already-wired case every
			// pass drowned the log without conveying anything.
			if ((await this.ensureAttached(overlay, target)) === "wired") wired.push(target.name);
		}
		if (wired.length > 0) {
			this.logger.log(
				`Wired app container(s) onto ${overlay}: ${wired.join(", ")} — the bridge head between the compose network and the swarm overlay`,
			);
		}
	}

	/** Read-only wiring status (never mutates networks). */
	protected async probe(): Promise<SupervisorProbeResult<typeof swarmAppWiringPayloadSchema>> {
		const startedAt = Date.now();
		const overlay = this.overlayName();
		const swarmActive = await this.isSwarmActive();

		if (!swarmActive) {
			return {
				healthy: true,
				detail: "swarm is not active — app containers stay on the compose network (container ingress)",
				payload: {
					checkedAt: new Date().toISOString(),
					latencyMs: Date.now() - startedAt,
					swarmActive: false,
					overlay,
					targets: [],
				},
			};
		}

		const targets = await this.describeTargets(overlay);
		const missingWiring = targets.filter((target) => !target.attached);

		return {
			healthy: missingWiring.length === 0,
			detail:
				missingWiring.length === 0
					? targets.length === 0
						? "no app container running yet"
						: `${String(targets.length)} app container(s) wired to ${overlay}`
					: `not wired to ${overlay}: ${missingWiring.map((t) => t.name).join(", ")}`,
			payload: {
				checkedAt: new Date().toISOString(),
				latencyMs: Date.now() - startedAt,
				swarmActive: true,
				overlay,
				targets,
			},
		};
	}

	protected buildDegradedPayload(_detail: string): z.output<typeof swarmAppWiringPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			swarmActive: false,
			overlay: this.overlayName(),
			targets: [],
		};
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		const overlay = this.overlayName();
		return { overlay, targets: await this.describeTargets(overlay) };
	}

	// ─── Helpers ─────────────────────────────────────────────────────────────

	/** The attachable overlay every platform process shares. */
	private overlayName(): string {
		return platformOverlayForPrefix(this.envService.get("DEPLOYER_PREFIX"));
	}

	/** The compose/operator bridge the app containers live on by default. */
	private platformNetwork(): string {
		return platformNetworkName(this.envService.get("DEPLOYER_PREFIX"));
	}

	/** True when the local engine is an active swarm member. */
	private async isSwarmActive(): Promise<boolean> {
		try {
			const info = await this.dockerService.getSwarmInfo();
			return info.LocalNodeState === "active";
		} catch {
			return false;
		}
	}

	/**
	 * The app containers that must be reachable from swarm services.
	 *
	 * Containers are resolved from the PLATFORM network (where the app lives)
	 * and matched by NAME **or ALIAS** against the declared targets
	 * (`DEPLOYER_API_TARGET`, `DEPLOYER_WEB_TARGET`) — those values are compose
	 * ALIASES in a compose deployment while the engine knows the container by
	 * its generated name. The API container itself is always included: it hosts
	 * the platform and must reach the swarm-scheduled DB/Redis.
	 */
	private async resolveTargets(): Promise<ResolvedTarget[]> {
		const [declared, selfName] = await Promise.all([
			Promise.resolve(this.declaredTargets()),
			this.resolveSelfContainerName(),
		]);
		const wanted = selfName === null ? declared : [...declared, selfName];

		const client = this.dockerService.getDockerClient();
		const network = this.platformNetwork();

		let containers: { Id?: string }[];
		try {
			// Filter server-side: only RUNNING app containers on this network —
			// a stopped container cannot serve traffic and re-attaching it would
			// only add noise (its aliases would compete with the live one).
			containers = (await client.listContainers({
				all: false,
				filters: { network: [network] },
			}));
		} catch (error: unknown) {
			this.logger.debug(`Could not list containers on ${network}: ${String(error)}`);
			return [];
		}

		const resolved: ResolvedTarget[] = [];
		for (const container of containers) {
			const id = container.Id;
			if (typeof id !== "string" || id === "") continue;
			const detail = await this.inspectContainer(id);
			if (detail === null) continue;

			const aliases = detail.networkAliases[network] ?? [];
			const matched = wanted.some((value) => value === detail.name || aliases.includes(value));
			if (!matched) continue;

			// The container's OWN name is always carried over, so swarm services
			// (and the ingress) can address it exactly as compose does.
			resolved.push({
				id,
				name: detail.name,
				aliases: [...new Set([detail.name, ...aliases])],
			});
		}
		return resolved;
	}

	/** Wiring status of every resolved target (read-only). */
	private async describeTargets(overlay: string): Promise<SwarmAppWiringTarget[]> {
		const targets = await this.resolveTargets();
		const described: SwarmAppWiringTarget[] = [];
		for (const target of targets) {
			const detail = await this.inspectContainer(target.id);
			if (detail === null) continue;
			described.push({
				name: target.name,
				aliases: target.aliases,
				attached: Object.hasOwn(detail.networkAliases, overlay),
			});
		}
		return described;
	}

	/** The configured container identifiers from the environment. */
	private declaredTargets(): string[] {
		const values: string[] = [];
		for (const key of ["DEPLOYER_API_TARGET", "DEPLOYER_WEB_TARGET"] as const) {
			const value = this.envService.get(key)?.trim();
			if (value !== undefined && value !== "") values.push(value);
		}
		return values;
	}

	/** Name + per-network aliases of a container; null when it does not exist. */
	private async inspectContainer(idOrName: string): Promise<ContainerDetail | null> {
		try {
			const info = (await this.dockerService.getDockerClient().getContainer(idOrName).inspect()) as {
				Name?: string;
				NetworkSettings?: {
					Networks?: Record<string, { Aliases?: string[] } | null>;
				};
			};
			const name = (info.Name ?? "").replace(/^\//, "");
			const networkAliases: Record<string, string[]> = {};
			for (const [network, endpoint] of Object.entries(info.NetworkSettings?.Networks ?? {})) {
				networkAliases[network] = Array.isArray(endpoint?.Aliases) ? endpoint.Aliases : [];
			}
			return { name: name === "" ? idOrName : name, networkAliases };
		} catch (error: unknown) {
			if (this.isNotFound(error)) return null;
			throw error;
		}
	}

	/** This API container's canonical name (HOSTNAME is the container id). */
	private async resolveSelfContainerName(): Promise<string | null> {
		const selfId = process.env.HOSTNAME;
		if (selfId === undefined || !/^[0-9a-f]{12,64}$/.test(selfId)) return null;
		const detail = await this.inspectContainer(selfId);
		return detail?.name ?? null;
	}

	/**
	 * Ensure one container is on the overlay WITH its aliases.
	 *
	 * Returns whether this call CHANGED the wiring:
	 *   - "attached"  → the container was already wired with all its aliases.
	 *   - "wired"     → this call attached (or re-attached) it.
	 *   - "absent"    → the container vanished — not an error, the start event
	 *                   re-converges when it comes back.
	 *
	 * The distinction matters for LOGGING: reporting "wired" on every pass made
	 * an idempotent safety-net cadence look like repeated work.
	 */
	private async ensureAttached(
		overlay: string,
		target: ResolvedTarget,
	): Promise<"attached" | "wired" | "absent"> {
		const detail = await this.inspectContainer(target.id);
		if (detail === null) return "absent";

		const current = detail.networkAliases[overlay];
		const alreadyComplete =
			current !== undefined && target.aliases.every((alias) => current.includes(alias));
		if (alreadyComplete) return "attached";

		const network = this.dockerService.getDockerClient().getNetwork(overlay);
		// An endpoint already on the overlay with STALE aliases must be
		// reconnected — Docker cannot update an endpoint in place.
		if (current !== undefined) {
			await network.disconnect({ Container: target.id, Force: true }).catch(() => undefined);
		}
		try {
			await network.connect({
				Container: target.id,
				EndpointConfig: { Aliases: target.aliases },
			});
			return "wired";
		} catch (error: unknown) {
			// 403 "already exists" proves the endpoint is attached with the
			// aliases we asked for — that is the already-complete case.
			if (this.isAlreadyAttached(error)) return "attached";
			if (this.isNotFound(error)) return "absent";
			throw error;
		}
	}

	/** Dockerode errors carry the HTTP status code on the error object. */
	private statusCodeOf(error: unknown): number | null {
		if (typeof error !== "object" || error === null) return null;
		const code = (error as { statusCode?: unknown }).statusCode;
		return typeof code === "number" ? code : null;
	}

	private isNotFound(error: unknown): boolean {
		return this.statusCodeOf(error) === 404;
	}

	private isAlreadyAttached(error: unknown): boolean {
		const message = error instanceof Error ? error.message : String(error);
		return (
			this.statusCodeOf(error) === 403 ||
			message.includes("already exists") ||
			message.includes("already attached")
		);
	}

	// ─── Event-driven re-wiring ──────────────────────────────────────────────
	//
	// Container start order is not ours to assume and a container can restart at
	// any time. Subscribing to the daemon's `start` events means those cases are
	// handled the moment they happen — no polling, no ordering assumptions.

	private startWatchingContainerStarts(): void {
		void (async (): Promise<void> => {
			try {
				const client = this.dockerService.getDockerClient();
				const stream = (await (client.getEvents as (opts: object) => Promise<Readable>)({
					filters: {
						type: ["container"],
						event: ["start"],
					},
				}));
				if (this.disposed) {
					stream.destroy();
					return;
				}
				this.eventStream = stream;
				let buffer = "";
				stream.on("data", (chunk: Buffer) => {
					buffer += chunk.toString();
					const lines = buffer.split("\n");
					buffer = lines.pop() ?? "";
					for (const line of lines) this.handleEventLine(line);
				});
				stream.on("error", () => { this.scheduleReconnect(); });
				stream.on("close", () => { this.scheduleReconnect(); });
			} catch {
				this.scheduleReconnect();
			}
		})();
	}

	private handleEventLine(line: string): void {
		if (line.trim() === "") return;
		const parsed = dockerEventSchema.safeParse(this.parseJson(line));
		if (!parsed.success) return;

		const containerName = parsed.data.Actor?.Attributes?.name;
		if (containerName === undefined || containerName === "") return;

		void this.rewireIfTarget(containerName);
	}

	/**
	 * Re-converge when a container we care about starts. Reuses the normal
	 * convergence path, so the wiring decision lives in exactly one place.
	 */
	private async rewireIfTarget(containerName: string): Promise<void> {
		const targets = await this.resolveTargets().catch((): ResolvedTarget[] => []);
		const isTarget = targets.some(
			(target) => target.name === containerName || target.aliases.includes(containerName),
		);
		if (!isTarget) return;
		await this.ensureDesiredState();
	}

	private scheduleReconnect(): void {
		this.stopEventStream();
		if (this.disposed || this.reconnectTimer !== null) return;
		this.reconnectTimer = setTimeout(() => {
			this.reconnectTimer = null;
			this.startWatchingContainerStarts();
		}, 5_000);
	}

	// ─── Safety-net cadence ──────────────────────────────────────────────────
	//
	// Chained timers rather than `setInterval`: the next pass is scheduled only
	// after the current one settles, so a slow probe can never stack up passes.

	private scheduleReconcile(): void {
		if (this.disposed) return;
		this.reconcileTimer = setTimeout(() => {
			this.reconcileTimer = null;
			void this.ensureDesiredState()
				.catch((error: unknown) => {
					this.logger.warn(
						`App wiring re-converge failed: ${error instanceof Error ? error.message : String(error)}`,
					);
				})
				.finally(() => {
					this.scheduleReconcile();
				});
		}, SwarmAppWiringSupervisorService.RECONCILE_INTERVAL_MS);
	}

	private stopEventStream(): void {
		if (this.eventStream === null) return;
		this.eventStream.removeAllListeners();
		this.eventStream.destroy();
		this.eventStream = null;
	}

	private parseJson(text: string): unknown {
		try {
			return JSON.parse(text);
		} catch {
			return null;
		}
	}
}
