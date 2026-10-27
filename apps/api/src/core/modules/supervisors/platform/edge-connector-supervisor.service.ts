/**
 * EdgeConnectorSupervisorService — runs the public edge's CONNECTOR, whatever the
 * edge provider is.
 *
 * A tunnel edge (Cloudflare Tunnel, or any provider that dials out) needs a client
 * process on the cluster that holds the outbound connection and forwards to
 * Traefik's `public` entrypoint. Which image, which credential, how many replicas
 * is the provider's answer (`EdgeProvider.connector()`); running it, keeping it
 * healthy and removing it when the lane changes is this supervisor's — so a new
 * tunnel provider needs no supervisor of its own.
 *
 * ── WHY `replicated` AND NOT `global` ───────────────────────────────────────
 * The opposite choice from the ingress, deliberately. Traefik is `global` because
 * each node routes for its own doors. A connector has NO ports — it dials out — so
 * nothing about it is node-local, and one per node would only multiply the
 * connections the provider tracks. Spread is a PREFERENCE, so the spec also caps
 * one replica per node (`Placement.MaxReplicas`): with only the preference, two
 * replicas may land on one node and its loss takes the whole edge.
 *
 * ── NO PORTS, EVER ──────────────────────────────────────────────────────────
 * The connector is a client. Publishing a port would be the exact inbound surface
 * a tunnel edge exists to avoid, so the spec publishes nothing whatever the
 * provider returns.
 *
 * When there is nothing to run (no public lane, an inbound edge, a tunnel not
 * provisioned yet) this supervisor reports `managed` — "nothing of ours to run" —
 * and REMOVES any connector left from before: a connector kept after a lane switch
 * keeps serving traffic the operator turned off.
 */

import { Injectable } from "@nestjs/common";
import type { SwarmServiceSpecInput } from "@deployer/contracts-entities";
import { BaseDockerSupervisorService } from "@deployer/nest-docker/services/base-docker-supervisor.service";
import { resolveSupervisorRuntime } from "@deployer/nest-docker/services/docker-supervisor-runtime";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import { baseSupervisorPayloadSchema, type SupervisorProbeResult } from "@deployer/nest-supervisor-core/base-supervisor.service";
import { baseSupervisorProcessInfoSchema, swarmProcessInfoSchema } from "@deployer/nest-supervisor-core/supervisor-process-info";
import z from "zod/v4";

import { EnvService } from "@/config/env/env.module";
import type { EdgeConnectorSpec } from "@/core/modules/edge/edge-provider";
import { PublicEdgeService } from "@/core/modules/reachability/services/public-edge.service";

import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import { PLATFORM_ROLE_LABEL, PlatformNetwork } from "./traefik-supervisor.service";

/** Ownership marker — cleanup/inspection tooling keys off this label. */
const EDGE_CONNECTOR_ROLE = "platform-edge-connector";
/** Which provider the running connector belongs to. */
const EDGE_PROVIDER_LABEL = "deployer.edge.provider";

export const EDGE_CONNECTOR_SUPERVISOR_ID = "platform-edge-connector";
export const EDGE_CONNECTOR_BASE_NAME = "deployer-edge-connector";

/** `managed` = nothing of ours to run (no tunnel edge); `swarm-replicated` = a connector runs. */
export const edgeConnectorRuntimeSchema = z.enum(["managed", "swarm-replicated"]);
export type EdgeConnectorRuntime = z.output<typeof edgeConnectorRuntimeSchema>;

export const edgeConnectorSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	runtime: edgeConnectorRuntimeSchema,
	/** The edge provider whose connector runs, when one does. */
	provider: z.string().nullable(),
	service: z
		.object({
			id: z.string(),
			name: z.string(),
			runningTasks: z.number().int().min(0).nullable(),
			exists: z.boolean(),
		})
		.nullable(),
	replicas: z.number().int().min(0),
	/** Where the connector forwards: Traefik's `public` entrypoint. */
	routeTarget: z.string(),
});
export type EdgeConnectorSupervisorPayload = z.output<typeof edgeConnectorSupervisorPayloadSchema>;

export const edgeConnectorProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
});

@Injectable()
export class EdgeConnectorSupervisorService extends BaseDockerSupervisorService<
	typeof edgeConnectorSupervisorPayloadSchema,
	typeof edgeConnectorProcessInfoSchema
> {
	static readonly identifier = EDGE_CONNECTOR_SUPERVISOR_ID;
	readonly description = "Public edge connector (outbound-only: no inbound port, no public IP required)";

	readonly payloadSchema = edgeConnectorSupervisorPayloadSchema;
	readonly processInfoSchema = edgeConnectorProcessInfoSchema;

	/**
	 * The connector the active provider wants, resolved on each sweep. Cached because
	 * `probe()` and `buildSwarmSpec()` are synchronous while providers are not.
	 */
	private desired: { providerId: string; spec: EdgeConnectorSpec } | null = null;

	constructor(
		dockerService: DockerService,
		private readonly env: EnvService,
		private readonly lanes: IngressLanesService,
		private readonly edge: PublicEdgeService,
	) {
		super(dockerService);
	}

	/** Prime the cache before registering, so a running edge does not read as absent on the first probe. */
	override onModuleInit(): void {
		void this.loadDesired()
			.catch((error: unknown) => {
				this.logger.warn(`Edge connector not resolved at boot: ${error instanceof Error ? error.message : String(error)}`);
			})
			.then(() => {
				this.logger.log(`Edge connector supervisor registering — runtime=${this.effectiveRuntime()}`);
				super.onModuleInit();
			});
	}

	async loadDesired(): Promise<void> {
		this.desired = await this.edge.connector(await this.lanes.getLanes());
	}

	protected effectiveRuntime(): EdgeConnectorRuntime {
		const resolved = resolveSupervisorRuntime({
			managed: this.desired === null,
			rawRuntime: process.env.SUPERVISOR_RUNTIME,
			swarmActive: true,
			scope: "mesh-wide",
		});
		return resolved.runtime === "managed" ? "managed" : "swarm-replicated";
	}

	protected override isDeploymentManaged(): boolean {
		return this.desired === null;
	}

	private serviceName(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		return prefix === "" ? EDGE_CONNECTOR_BASE_NAME : `${EDGE_CONNECTOR_BASE_NAME}-${prefix}`;
	}

	private routeTarget(): string {
		return this.edge.ingressTarget();
	}

	protected buildSwarmSpec(): SwarmServiceSpecInput {
		const desired = this.desired;
		return {
			name: this.serviceName(),
			image: desired?.spec.image ?? "",
			mode: "replicated",
			replicas: desired?.spec.replicas ?? 0,
			stopGracePeriodSeconds: 30,
			env: desired?.spec.env ?? [],
			command: desired?.spec.command ?? [],
			args: desired?.spec.args ?? [],
			labels: {
				[PLATFORM_ROLE_LABEL]: EDGE_CONNECTOR_ROLE,
				[EDGE_PROVIDER_LABEL]: desired?.providerId ?? "",
				"deployer.managed": "true",
			},
			containerLabels: {},
			mounts: [],
			// Preference AND hard cap — see the header.
			placementPreferences: [{ spreadDescriptor: "node.id" }],
			placementMaxReplicasPerNode: 1,
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			capabilitiesAdd: [],
			// A connector that loses its provider reconnects on its own; a container
			// healthcheck would only add a restart loop. Health is the provider's
			// reported connections (Ingress page) plus running tasks (here).
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			endpointPorts: [],
			endpointMode: "dnsrr",
		};
	}

	protected async reconcile(): Promise<void> {
		// Re-resolve every sweep: the lanes and the provider's state are written by
		// the Ingress page, and this is how the supervisor learns about it.
		await this.loadDesired();

		if (this.desired === null) {
			const leftover = await this.dockerService.inspectSwarmService(this.serviceName()).then(
				() => true,
				() => false,
			);
			if (leftover) {
				await this.removeSwarmServiceIfExists(this.serviceName());
				this.logger.log(`No tunnel edge any more — connector '${this.serviceName()}' removed`);
			}
			return;
		}

		await this.runWithBackoff(
			"Edge connector convergence",
			async () => {
				const overlay = await this.ensureSwarmNetwork(PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX")));
				const spec = this.buildSwarmSpec();
				// The connector resolves Traefik by its overlay alias.
				this.attachOverlay(spec, overlay, [spec.name]);
				await this.reconcileSwarmService(spec);
				const tasks = await this.dockerService.listSwarmServiceTasks(spec.name).catch(() => []);
				if (!tasks.some((task) => task.Status.State === "running")) {
					throw new Error(`Edge connector '${spec.name}' has no running task`);
				}
			},
			{ maxAttempts: 5 },
		);
	}

	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		if (this.effectiveRuntime() === "swarm-replicated") {
			return { process: await this.describeSwarmProcess(this.buildSwarmSpec()), edge: { provider: this.desired?.providerId ?? null } };
		}
		// Nothing runs — reported as a zero-replica swarm resource so consumers see one shape.
		return {
			process: {
				kind: "swarm",
				runtime: "managed",
				desired: {
					name: this.serviceName(),
					image: "",
					command: [],
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
			edge: { provider: null },
		};
	}

	protected buildDegradedPayload(): EdgeConnectorSupervisorPayload {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			runtime: this.effectiveRuntime(),
			provider: this.desired?.providerId ?? null,
			service: null,
			replicas: 0,
			routeTarget: this.routeTarget(),
		};
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof edgeConnectorSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const runtime = this.effectiveRuntime();
		const base = {
			checkedAt: new Date().toISOString(),
			runtime,
			provider: this.desired?.providerId ?? null,
			routeTarget: this.routeTarget(),
		};

		if (runtime === "managed") {
			// NOT a failure: an inbound edge, no public lane, or a tunnel not provisioned yet.
			return {
				healthy: true,
				detail: "No tunnel edge needs a connector.",
				payload: { ...base, latencyMs: Date.now() - startedAt, service: null, replicas: 0 },
			};
		}

		try {
			const service = await this.dockerService.inspectSwarmService(this.serviceName());
			if (service.ID === undefined) throw new Error(`Edge connector "${this.serviceName()}" has no ID`);
			const tasks = await this.dockerService.listSwarmServiceTasks(this.serviceName()).catch(() => []);
			const running = tasks.filter((task) => task.Status.State === "running").length;
			return {
				healthy: running > 0,
				...(running > 0 ? {} : { detail: `Connector has ${String(running)} running task(s)` }),
				payload: {
					...base,
					latencyMs: Date.now() - startedAt,
					service: { id: service.ID, name: service.Spec.Name, runningTasks: running, exists: true },
					replicas: running,
				},
			};
		} catch (error: unknown) {
			return {
				healthy: false,
				detail: `Edge connector probe failed: ${error instanceof Error ? error.message : String(error)}`,
				payload: { ...base, latencyMs: Date.now() - startedAt, service: null, replicas: 0 },
			};
		}
	}
}
