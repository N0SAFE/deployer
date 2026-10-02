/**
 * ManagedWebSupervisorService — spawns and supervises the API's managed web
 * app container when the `managed_web_app.enabled` platform flag is on.
 *
 * Desired state is read from the DB flag at each convergence (the management
 * console flips it live). When MANAGED_WEB_APP_EXTERNAL is set (dev
 * side-by-side), the supervisor converges to "removed" — an externally running
 * dev web satisfies the architecture without container duplication.
 *
 * The spawned web receives a freshly provisioned app-instance token as env —
 * the "managed shortcut": no credentials travel through the web container,
 * registration is skipped, heartbeat still applies. Raw tokens are never
 * stored server-side, so each convergence mints a fresh instance and revokes
 * the previous one (rotation is safe: only the newest env-carrying container
 * survives).
 */

import { Injectable } from "@nestjs/common";

import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { AppInstanceService } from "../../platform-ingress/services/app-instance.service";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import { MANAGED_WEB_CONTAINER_BASE_NAME } from "../../platform-ingress/services/platform-names";
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
import z from "zod/v4";
import {
	resolveSupervisorRuntime,
	type DockerSupervisorRuntime,
} from "@repo/nest-docker/services/docker-supervisor-runtime";
import type { SwarmServiceSpecInput } from "@repo/contracts-entities";
import { PlatformNetwork } from "./traefik-supervisor.service";
import { AppError, ConflictError } from "@repo/errors";

export const PLATFORM_MANAGED_WEB_ROLE = "managed-web";
export const PLATFORM_MANAGED_WEB_SUPERVISOR_ID = "platform-managed-web";

/** Rich health payload: console service state + desired-state mode. */
export const managedWebSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	desired: z.enum(["enabled", "disabled"]),
	/** Live view of the console swarm service (null when absent). */
	service: swarmProcessInfoSchema.shape.live.nullable(),
});
export type ManagedWebSupervisorPayload = z.output<typeof managedWebSupervisorPayloadSchema>;

/**
 * Process info reported by the managed-web supervisor through
 * `getProcessInfo()` — the container process + the origins it serves.
 */
export const managedWebProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: swarmProcessInfoSchema,
	urls: z.object({
		/** HTTP origin the managed web app serves. */
		webUrl: z.string(),
		/** HTTP origin of the API the web app talks to. */
		apiUrl: z.string(),
	}),
});
export type ManagedWebProcessInfo = z.output<typeof managedWebProcessInfoSchema>;

@Injectable()
export class ManagedWebSupervisorService extends BaseDockerSupervisorService<
	typeof managedWebSupervisorPayloadSchema,
	typeof managedWebProcessInfoSchema
> {
	static readonly identifier = PLATFORM_MANAGED_WEB_SUPERVISOR_ID;
	readonly description = "Managed web app container (flag-controlled)";

	readonly payloadSchema = managedWebSupervisorPayloadSchema;
	readonly processInfoSchema = managedWebProcessInfoSchema;

	constructor(
		dockerService: DockerService,
		private readonly hostnameService: HostnameService,
		private readonly env: EnvService,
		private readonly platformConfig: PlatformConfigService,
		private readonly appInstances: AppInstanceService,
	) {
		super(dockerService);
	}

	/** Runtime: mesh-wide → swarm-replicated (one console for the platform). */
	protected async effectiveRuntime(): Promise<DockerSupervisorRuntime> {
		return (
			await resolveSupervisorRuntime({
				managed: false,
				rawRuntime: process.env.SUPERVISOR_RUNTIME,
				swarmActive: await this.isSwarmActive(),
				scope: "mesh-wide",
			})
		).runtime;
	}

	protected buildSwarmSpec(): SwarmServiceSpecInput {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const name = prefix === "" ? MANAGED_WEB_CONTAINER_BASE_NAME : `${MANAGED_WEB_CONTAINER_BASE_NAME}-${prefix}`;
		return {
			name,
			image: this.env.get("MANAGED_WEB_APP_IMAGE") ?? "deployer-web:latest",
			mode: "replicated",
			replicas: 1,
			env: [],
			command: [],
			args: [],
			labels: {
				"deployer.platform.role": PLATFORM_MANAGED_WEB_ROLE,
				"deployer.platform.web-hostname": this.hostnameService.webHostname(),
			},
			containerLabels: {},
			mounts: [],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			networks: [],
			capabilitiesAdd: [],
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			stopGracePeriodSeconds: 10,
			endpointPorts: [],
			// One task addressed by DNS name: `dnsrr` keeps consumers off the VIP.
			endpointMode: "dnsrr",
		};
	}

	protected async reconcile(): Promise<void> {
		if (!(await this.desiredEnabled())) {
			await this.removeManagedWeb();
			return;
		}

		const runtime = await this.effectiveRuntime();

		if (runtime === "managed") {
			// The deployment owns the console — nothing to converge.
			return;
		}
		if (runtime === "unavailable") {
			throw new AppError(
				"Managed web console requires an active swarm engine (no container fallback) — SwarmBootstrapService should have converged the engine",
				"SWARM_UNAVAILABLE",
				{ supervisor: "platform-managed-web" },
			);
		}

		await this.runWithBackoff(
			"Managed web (swarm) convergence",
			async () => {
				const overlay = await this.ensureSwarmNetwork(PlatformNetwork.name(this.env.get("DEPLOYER_PREFIX") ?? ""));
				const spec = this.buildSwarmSpec();
				spec.env = await this.managedWebEnv();
				spec.networks = [{ target: overlay, aliases: [spec.name] }];
				await this.reconcileSwarmService(spec);
				const svc = await this.dockerService.inspectSwarmService(spec.name).catch(() => null);
				if (!svc?.ID) throw new ConflictError(`managed web swarm service '${spec.name}'`, "was not created");
			},
			{ maxAttempts: 3 },
		);
	}

	/**
	 * The env the console needs to boot.
	 *
	 * A swarm task inherits NOTHING from the compose project, so everything the
	 * web app's env schema REQUIRES has to be passed explicitly. The schema
	 * (`webEnvSchema`) refuses to start without all of these, and the failure is
	 * a crash-loop with no running task — the supervisor reports "service has no
	 * running task" and the operator sees no hint of the missing variable:
	 *
	 *   ✖ Invalid input: expected string, received undefined → at API_URL
	 *   ✖ ... → at AUTH_SECRET / BETTER_AUTH_SECRET / NEXT_PUBLIC_APP_URL
	 *
	 * `AUTH_SECRET` and `BETTER_AUTH_SECRET` must be EQUAL — the schema refines
	 * on it, and the platform signs sessions with the same value on both sides
	 * so a token minted by the API is accepted by the web app.
	 */
	private async managedWebEnv(): Promise<string[]> {
		const minted = await this.appInstances.create({
			label: `managed-web-${this.env.get("DEPLOYER_PREFIX") || "default"}`,
			kind: "managed",
		});
		const apiOrigin = this.hostnameService.apiOrigin();
		const webOrigin = this.hostnameService.webOrigin();
		// ONE secret for both keys: the web schema rejects them when they differ.
		// The fallback mirrors compose's own literal (`${AUTH_SECRET:-...}`) so a
		// deployment that never set `AUTH_SECRET` behaves as it did under compose;
		// production already refuses to boot without a real one
		// (`schema-codecs.ts`), so this cannot silently weaken prod.
		const authSecret = this.env.get("AUTH_SECRET") ?? "fallback-auth-secret";
		return [
			`API_URL=${apiOrigin}`,
			`NEXT_PUBLIC_API_URL=${apiOrigin}`,
			`NEXT_PUBLIC_APP_URL=${webOrigin}`,
			`AUTH_SECRET=${authSecret}`,
			`BETTER_AUTH_SECRET=${authSecret}`,
			// The name the web app READS (see `getAppInstanceToken`). Passing it as
			// `WEB_INSTANCE_TOKEN` silently did nothing: the app looked for
			// `APP_INSTANCE_TOKEN`, found neither a persisted token nor credentials,
			// and failed its boot-time app-instance registration.
			`APP_INSTANCE_TOKEN=${minted.appToken}`,
		];
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof managedWebSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const desired = (await this.desiredEnabled()) ? "enabled" : "disabled";
		const spec = this.buildSwarmSpec();
		const live = await this.liveService(spec.name);

		if (desired === "disabled") {
			return {
				healthy: true,
				detail: "managed web disabled by flag",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, service: null },
			};
		}
		if (!live.exists) {
			return {
				healthy: false,
				detail: "service missing while flag enabled",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, service: null },
			};
		}
		if (live.runningTasks === 0) {
			return {
				healthy: false,
				detail: "service has no running task",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, service: live.snapshot },
			};
		}
		return {
			healthy: true,
			detail: `serving ${this.hostnameService.webHostname()}`,
			payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, service: live.snapshot },
		};
	}

	/** The console service's live state (absent → exists=false). */
	private async liveService(name: string): Promise<{
		exists: boolean;
		runningTasks: number;
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
			const service = await this.dockerService.inspectSwarmService(name);
			const tasks = await this.dockerService.listSwarmServiceTasks(name).catch(() => []);
			const runningTasks = tasks.filter((task) => task.Status.State === "running").length;
			return {
				exists: true,
				runningTasks,
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
			return { exists: false, runningTasks: 0, snapshot: null };
		}
	}

	/** Payload shape when the probe mechanism itself fails. */
	protected buildDegradedPayload(): z.output<typeof managedWebSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			desired: "disabled",
			service: null,
		};
	}

	/** The entire config + live state of the managed web process. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		return {
			process: await this.describeSwarmProcess(this.buildSwarmSpec()),
			urls: {
				webUrl: this.hostnameService.webOrigin(),
				apiUrl: this.hostnameService.apiOrigin(),
			},
		};
	}

	/** Flag + external marker decide desired existence of the container. */
	private async desiredEnabled(): Promise<boolean> {
		if (this.env.get("MANAGED_WEB_APP_EXTERNAL")) return false;
		return await this.platformConfig.isManagedWebAppEnabled();
	}

	/** Remove the console service when the flag turns off. */
	private async removeManagedWeb(): Promise<void> {
		await this.removeSwarmServiceIfExists(this.buildSwarmSpec().name);
		// Teardown kills trust immediately.
		const managed = await this.appInstances.findManaged().catch(() => null);
		if (managed !== null) await this.appInstances.revoke(managed.id);
	}

	/** API container name on the platform network (server→server), falling
	 *  back to host-gateway when running bare-metal. */
	private resolveApiContainerName(): string {
		const hostname = process.env.HOSTNAME;
		if (hostname !== undefined && /^[0-9a-f]{12,64}$/.test(hostname)) {
			const prefix = this.env.get("DEPLOYER_PREFIX");
			return prefix === "" ? "api-dev" : `deployer-api-${prefix}`;
		}
		return "host.docker.internal";
	}
}
