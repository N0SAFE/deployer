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
import z from "zod/v4";
import { PlatformNetwork } from "./traefik-supervisor.service";

export const PLATFORM_MANAGED_WEB_ROLE = "managed-web";
export const PLATFORM_MANAGED_WEB_SUPERVISOR_ID = "platform-managed-web";

/** Rich health payload: container state + sizes + desired-state mode. */
export const managedWebSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
	desired: z.enum(["enabled", "disabled"]),
	container: z
		.object({
			id: z.string(),
			name: z.string(),
			image: z.string(),
			running: z.boolean(),
			exitCode: z.number().int().nullable(),
			sizeRw: z.number().int().min(0).nullable(),
			sizeRootFs: z.number().int().min(0).nullable(),
			startedAt: z.string().datetime().nullable(),
			hostname: z.string(),
		})
		.nullable(),
});
export type ManagedWebSupervisorPayload = z.output<typeof managedWebSupervisorPayloadSchema>;

/**
 * Process info reported by the managed-web supervisor through
 * `getProcessInfo()` — the container process + the origins it serves.
 */
export const managedWebProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
	process: dockerProcessInfoSchema,
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

	protected buildContainerSpec(): DockerSupervisorContainerSpec {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		return {
			name: prefix === "" ? MANAGED_WEB_CONTAINER_BASE_NAME : `${MANAGED_WEB_CONTAINER_BASE_NAME}-${prefix}`,
			image: this.env.get("MANAGED_WEB_APP_IMAGE") ?? "deployer-web:latest",
			networkName: PlatformNetwork.name(prefix),
			restartPolicy: "unless-stopped",
			labels: {
				"deployer.platform.role": PLATFORM_MANAGED_WEB_ROLE,
				"deployer.platform.web-hostname": this.hostnameService.webHostname(),
			},
		};
	}

	protected async reconcile(): Promise<void> {
		if (!(await this.desiredEnabled())) {
			await this.removeManagedWeb();
			return;
		}

		await this.runWithBackoff(
			"Managed web convergence",
			async () => {
				const baseSpec = this.buildContainerSpec();
				const networkId = baseSpec.networkName !== undefined ? await this.ensureNetwork(baseSpec.networkName) : undefined;

				const inspect = await this.inspectContainer(baseSpec.name);
				if (inspect === null) {
					// Fresh spawn: rotate token, inject env, create.
					const spec = await this.buildManagedWebSpec();
					await this.pullImage(spec.image);
					const container = await this.createContainer(spec, networkId);
					await container.start();
				} else if (!inspect.State.Running) {
					// Exited container may hold a stale/revoked env token —
					// recreation guarantees a fresh valid one.
					await containerRemove(this.client, baseSpec.name);
					const spec = await this.buildManagedWebSpec();
					await this.pullImage(spec.image);
					const container = await this.createContainer(spec, networkId);
					await container.start();
				}
				// Healthy + running: leave it alone — its env token stays valid.
			},
			{ maxAttempts: 3 },
		);

		// NOTE: the web HOSTNAME ROUTE is owned by the Traefik supervisor
		// (writeDynamicConfig → dynamic-web.yml) — the ingress is the single
		// source of routes and it knows the resolved web target (managed web
		// or the external web name). This supervisor only ensures the
		// container exists. writeWebRoute was removed: it proxied to the API
		// backend and never ran while the managed web was disabled, so
		// web.deployer.localhost 404'd in dev side-by-side.
	}

	protected async probe(): Promise<SupervisorProbeResult<typeof managedWebSupervisorPayloadSchema>> {
		const startedAt = Date.now();
		const desired = (await this.desiredEnabled()) ? "enabled" : "disabled";
		const spec = this.buildContainerSpec();
		const inspect = await this.inspectContainer(spec.name);
		const details = inspect as unknown as {
			SizeRw?: number;
			SizeRootFs?: number;
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
						sizeRw: details?.SizeRw ?? null,
						sizeRootFs: details?.SizeRootFs ?? null,
						startedAt: details?.State?.StartedAt ?? null,
						hostname: this.hostnameService.webHostname(),
					};

		if (desired === "disabled") {
			return {
				healthy: true,
				detail: "managed web disabled by flag",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, container: null },
			};
		}
		if (inspect === null) {
			return {
				healthy: false,
				detail: "container missing while flag enabled",
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, container: null },
			};
		}
		if (!inspect.State.Running) {
			return {
				healthy: false,
				detail: `container not running (exit ${String(inspect.State.ExitCode ?? "?")})`,
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, container },
			};
		}
		return {
			healthy: true,
			detail: `serving ${this.hostnameService.webHostname()}`,
			payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, container },
		};
	}

	/** Payload shape when the probe mechanism itself fails. */
	protected buildDegradedPayload(): z.output<typeof managedWebSupervisorPayloadSchema> {
		return {
			checkedAt: new Date().toISOString(),
			latencyMs: 0,
			desired: "disabled",
			container: null,
		};
	}

	/** The entire config + live state of the managed web process. */
	protected async buildProcessInfo(): Promise<Record<string, unknown>> {
		return {
			process: await this.describeDockerProcess(this.buildContainerSpec()),
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

	/** Full desired-state spec including provisioned token + env injection.
	 *  Call ONLY on create/recreate paths — minting revokes the previous
	 *  managed instance, which would break a healthy running container. */
	private async buildManagedWebSpec(): Promise<DockerSupervisorContainerSpec> {
		const base = this.buildContainerSpec();

		// Rotate: raw tokens are never stored, so mint fresh each convergence
		// and revoke the previous managed instance (only the newest container
		// carries an env token that works).
		// .catch(null) guards against missing app_instances table during
		// early boot or first-time migration — the table may not exist yet
		// if global Postgres migrations haven't been applied.
		const previous = await this.appInstances.findManaged().catch((): null => null);
		if (previous !== null) await this.appInstances.revoke(previous.id).catch(() => {});
		const minted = await this.appInstances.create({
			label: `managed-web-${this.env.get("DEPLOYER_PREFIX") || "default"}`,
			kind: "managed",
		});

		const apiPort = String(this.env.get("API_PORT"));
		const webHostname = this.hostnameService.webHostname();
		// The managed web app's OWN public surface: a custom origin (domain /
		// IP) and/or a dedicated tunnel hostname. These also terminate at the
		// platform Traefik (Host → web) so the operator can publish the web
		// app independently of the node's global address.
		const customHosts: string[] = [];
		const customOrigin = await this.platformConfig.getManagedWebOrigin();
		if (customOrigin !== null) customHosts.push(customOrigin);
		const webTunnel = await this.platformConfig.getManagedWebTunnel();
		if (webTunnel !== null) customHosts.push(webTunnel.hostname);

		// Public app URL = the operator-configured origin when set, else the
		// dedicated web tunnel hostname when set, else the platform web
		// hostname (web.<base>.localhost) dev surface.
		const publicAppUrl = customOrigin ?? webTunnel?.hostname ?? webHostname;

		// Dev-HMR allowlist: exact routed hostnames (+ subdomain wildcard over
		// the platform base domain). The custom origin/tunnel hostname must be
		// allowed too — the operator's browser hits that origin. Next rejects
		// a bare '*' — `*.{parent-domain}` is the correct whole-domain form.
		const webBaseDomain = webHostname.split(".").slice(1).join(".");
		const allowedDevOrigins = [
			webHostname,
			...(webBaseDomain ? [`*.${webBaseDomain}`] : []),
			...customHosts,
		].join(",");

		return {
			...base,
			env: [
				"NODE_ENV=production",
				// Server-side calls go over the PRIVATE platform network to the
				// API container name — not through the host gateway — so no
				// host port is required for internal traffic.
				`API_URL=http://${this.resolveApiContainerName()}:${apiPort}`,
				`NEXT_PUBLIC_API_URL=http://${this.hostnameService.apiHostname()}`,
				`NEXT_PUBLIC_APP_URL=http://${publicAppUrl}`,
				`NEXT_ALLOWED_DEV_ORIGINS=${allowedDevOrigins}`,
				`APP_INSTANCE_TOKEN=${minted.appToken}`,
			],
		};
	}

	/** Remove the managed container when the flag turns off. */
	private async removeManagedWeb(): Promise<void> {
		const spec = this.buildContainerSpec();
		const inspect = await this.inspectContainer(spec.name);
		if (inspect !== null) {
			await containerRemove(this.client, spec.name);
		}
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

/** Force-remove helper tolerating already-gone containers. */
async function containerRemove(client: ReturnType<DockerService["getDockerClient"]>, name: string): Promise<void> {
	await client
		.getContainer(name)
		.remove({ force: true })
		.catch((error: Error & { statusCode?: number }) => {
			if (error.statusCode === 404) return;
			throw error;
		});
}
