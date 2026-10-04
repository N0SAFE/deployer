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
import { request as httpRequest } from "node:http";

import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { AppInstanceService } from "../../platform-ingress/services/app-instance.service";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import {
	MANAGED_WEB_CONTAINER_BASE_NAME,
	platformTraefikContainerName,
} from "../../platform-ingress/services/platform-names";
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
			`API_URL=${this.apiInternalUrl()}`,
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

	/**
	 * The API's PRIVATE address, for the web app's server-side calls.
	 *
	 * ── WHY THIS IS NOT THE PUBLIC ORIGIN ───────────────────────────────────
	 * The two API variables are not interchangeable, and the web app already
	 * distinguishes them (`apps/web/src/lib/api-url.ts`):
	 *
	 *   NEXT_PUBLIC_API_URL  BROWSER  the public endpoint the operator reaches
	 *   API_URL              SERVER   the private Docker-network endpoint
	 *
	 * `API_URL` was being set to the public origin, so every SERVER-side call from
	 * the web app failed. The public hostname does not resolve inside a container
	 * at all — measured on the managed web task:
	 *
	 *   getent hosts api.deployer.localhost   -> (nothing)
	 *   getent hosts deployer-api             -> 10.0.1.4
	 *
	 * The visible symptom was the web app's own health route reporting
	 * `api: unavailable / Unable to connect` and answering 503 on a stack where the
	 * API was perfectly reachable on the overlay. It was NOT limited to health:
	 * any server-rendered page or route handler that talks to the API was broken.
	 */
	private apiInternalUrl(): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		const name = prefix === "" ? "deployer-api" : `deployer-api-${prefix}`;
		// Traefik fronts this in-network too, but dialling the API directly skips a
		// hop the web app does not need — the service name is the address.
		return `http://${name}:${String(this.env.get("API_PORT"))}`;
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

		// ── A RUNNING TASK IS NOT A SERVED SURFACE ───────────────────────────────
		// The task check above proves the CONTAINER is up. It says nothing about
		// whether `web.<host>` is ROUTED, and conflating the two made readiness
		// report green on a node where the dashboard was a 404 — observed on a
		// completed setup where the managed web ran happily while Traefik had no
		// `dynamic-web.yml` router at all.
		//
		// So the probe checks the route too — but reports a MISSING route through
		// `warnings` (see `collectWarnings`) rather than as unhealthy, and that
		// distinction is load-bearing rather than cosmetic:
		//
		//   The route can only be published ONCE the handover runs — setup releases
		//   the entry port, the API's config refresher writes `dynamic-web.yml`, and
		//   only then does the ingress have a rule. Counting "no route yet" as
		//   UNHEALTHY therefore made `/health/ready` 503, and setup waits for ready
		//   BEFORE releasing the port:
		//
		//     no route -> 503 -> port never released -> no route   (deadlock)
		//
		//   Measured on a real run: setup sat at "Still waiting for the API to
		//   report ready (100 attempts)" forever while the API reported exactly
		//   this. A warning is the honest encoding — the operator sees the state,
		//   the platform keeps making progress, and the handover remains the thing
		//   that resolves it.
		//
		// A 5xx DOES fail: the route exists and its backend is broken, which no
		// amount of waiting will fix.
		const reachability = await this.probeEntryPoint();
		this.lastReachability = reachability;
		if (!reachability.reachable && reachability.fatal) {
			return {
				healthy: false,
				detail: reachability.reason,
				payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, service: live.snapshot },
			};
		}

		return {
			healthy: true,
			detail: `serving ${this.hostnameService.webHostname()}`,
			payload: { checkedAt: new Date().toISOString(), latencyMs: Date.now() - startedAt, desired, service: live.snapshot },
		};
	}

	/** How long to wait for the ingress to answer the web hostname. */
	private static readonly REACHABILITY_TIMEOUT_MS = 3_000;

	/**
	 * The web app's own health route.
	 *
	 * ── WHY THE HEALTH ROUTE AND NOT `/` ─────────────────────────────────────
	 * `/` proves the ROUTER matched; it does not prove the app WORKS. A Next.js
	 * app answers plenty of 2xx/3xx while its server-side data layer is broken, and
	 * the dashboard's first paint depends on exactly that layer. The health route
	 * is the app's own verdict on itself, and it already returns a status code the
	 * platform can trust:
	 *
	 *   200  the web render is up AND its API dependency is reachable
	 *   503  the web is up but it cannot reach the API
	 *
	 * So probing it means the supervisor's "healthy" is the WEB's own answer about
	 * the full serving path, rather than this supervisor's inference from a status
	 * code that any static asset would also produce.
	 *
	 * Kept in sync with the route by a test: `apps/web/src/app/api/server/health`.
	 */
	private static readonly HEALTH_PATH = "/api/server/health";

	/**
	 * The last routing observation, so `collectWarnings` can report it.
	 *
	 * The probe and the warnings are two halves of one fact ("is the dashboard
	 * routed?"), and `collectWarnings` receives only the probe RESULT — which
	 * carries `healthy` and `detail` but not the distinction between "not routed
	 * yet" and "routed but broken". Keeping the observation here is what lets the
	 * warning stay specific without widening the supervisor base contract.
	 */
	private lastReachability: { reachable: boolean; reason: string; fatal?: boolean } | null = null;

	/** Port the ingress listens on INSIDE the platform network.
	 *  Traefik's `web` entrypoint is hardcoded to `:80` in its command, and the
	 *  swarm service maps the published entry port onto it — so in-network the
	 *  ingress is always `:80`, regardless of what the HOST port was set to. */
	private static readonly INGRESS_INTERNAL_PORT = 80;

	/**
	 * Surface a not-yet-published route as a WARNING.
	 *
	 * A warning is `degraded` rather than `down` in the readiness payload: the
	 * operator sees exactly what is missing, and — critically — readiness stays
	 * HTTP 200 so setup proceeds to release the entry port. That release is what
	 * lets the API's config refresher publish the route, so the warning clears
	 * itself. Reporting it as a failure instead deadlocked onboarding (see the
	 * note in `probe`).
	 */
	protected override collectWarnings(): string[] {
		const reachability = this.lastReachability;
		if (reachability === null || reachability.reachable || reachability.fatal === true) {
			return [];
		}
		return [`the dashboard is not routed yet — ${reachability.reason}`];
	}

	/**
	 * Ask the ingress whether the web hostname is ROUTED, then whether the app
	 * behind it answers.
	 *
	 * ── WHY THE INGRESS, AND NOT THE PUBLIC URL ──────────────────────────────
	 * The obvious implementation — fetch `http://web.deployer.localhost/` — does
	 * not work from inside the API task, and its failure is silent: the hostname
	 * does not resolve in the container's network at all (measured: `getent hosts
	 * web.deployer.localhost` returns nothing), so the probe would report
	 * "unreachable" even on a perfectly routed node.
	 *
	 * So the probe reproduces what a BROWSER does, against the only address
	 * reachable from here: dial the ingress by its service name on the overlay and
	 * set the `Host` header the browser would send. Measured behaviour of exactly
	 * this request on a real node:
	 *
	 *   Host: web.deployer.localhost  ->  404 Not Found (text/plain)  <- no router
	 *   Host: api.deployer.localhost  ->  200 OK                      <- routed
	 *
	 * That difference is the whole check, and it is what the container-only probe
	 * could not see: it reported the managed web healthy while `web.<host>` was a
	 * 404, because the TASK was running.
	 *
	 * `http.request` rather than `fetch` because `Host` is a forbidden header name
	 * for fetch — it would be dropped and every request would be judged against the
	 * ingress's default router instead of the web one.
	 */
	private async probeEntryPoint(): Promise<{ reachable: boolean; reason: string; fatal?: boolean }> {
		const hostname = this.hostnameService.webHostname();
		const ingress = platformTraefikContainerName(this.env.get("DEPLOYER_PREFIX"));
		const attempts = this.ingressProbeCandidates(ingress);

		// ── THE INGRESS MOVES DURING ONBOARDING, SO PROBE EVERY PLACE IT LIVES ──
		// The ingress has two incarnations (see `BootstrapIngressService`): setup's
		// plain container BEFORE the handover, and this platform's GLOBAL swarm
		// service after it. They share a NAME but not a network, and the swarm name
		// does not resolve until the service exists — which is AFTER setup releases
		// the entry port. Probing only the swarm name therefore failed during the
		// window that matters:
		//
		//   platform-managed-web: "the ingress is not reachable
		//                          (getaddrinfo ENOTFOUND deployer-traefik)"
		//
		// Trying each candidate keeps the check honest (it still verifies ROUTING)
		// without depending on which incarnation currently owns the port.
		let lastReason = "no ingress candidate was reachable";
		for (const candidate of attempts) {
			const result = await this.requestRoute(candidate, hostname);
			if (result.reachable) return result;
			lastReason = result.reason;
		}

		// Nothing answered. NOT fatal: during onboarding the ingress may simply not
		// be reachable from this task yet, and that is a state the handover clears.
		return { reachable: false, reason: lastReason, fatal: false };
	}

	/**
	 * Where the ingress can be reached from inside this task.
	 *
	 * The swarm service name — resolved on the platform overlay, which is the
	 * network both this task and (after the handover) the ingress live on. Before
	 * the handover the ingress is setup's plain container and this name does not
	 * resolve; that is EXPECTED and is reported as a warning rather than a
	 * failure, because the handover is what makes it resolve (see `probe`).
	 *
	 * The port is the ingress's INTERNAL one: Traefik's `web` entrypoint is
	 * hardcoded to `:80` in its command, and the swarm service maps the published
	 * entry port onto it — so in-network the ingress answers on `:80` regardless of
	 * the HOST port the operator configured.
	 */
	private ingressProbeCandidates(ingress: string): { host: string; port: number }[] {
		return [{ host: ingress, port: ManagedWebSupervisorService.INGRESS_INTERNAL_PORT }];
	}

	/** One routing probe against a specific ingress address. */
	private async requestRoute(
		candidate: { host: string; port: number },
		hostname: string,
	): Promise<{ reachable: boolean; reason: string; fatal?: boolean }> {
		const { host: ingress, port } = candidate;

		/* c8 ignore start -- socket plumbing; the branch logic is asserted above. */
		return await new Promise<{ reachable: boolean; reason: string; fatal?: boolean }>((resolve) => {
			let settled = false;
			const finish = (result: { reachable: boolean; reason: string; fatal?: boolean }): void => {
				if (settled) return;
				settled = true;
				resolve(result);
			};

			const request = httpRequest(
				{
					hostname: ingress,
					port,
					path: ManagedWebSupervisorService.HEALTH_PATH,
					method: "GET",
					headers: { host: hostname },
				},
				(response) => {
					const status = response.statusCode ?? 0;
					const contentType = String(response.headers["content-type"] ?? "");
					// Drain and discard: the body is irrelevant, and leaving it unread
					// keeps the socket open until the timeout fires.
					response.resume();

					// Traefik's "no router matched" answer. Its own 404 is plain text,
					// whereas the web app's are HTML — so the content type is what
					// distinguishes "the ingress has no rule for this host" (a real
					// problem) from "the app answered 404 for /" (a routed response).
					const isIngressNoRouter = status === 404 && contentType.includes("text/plain");
					if (isIngressNoRouter) {
						finish({
							reachable: false,
							reason: `the ingress has no router for ${hostname} yet — the web route has not been published`,
							fatal: false,
						});
						return;
					}

					// A 5xx means the route EXISTS and the app answered — but answered
					// that it is not serving. For the health route that is a real verdict
					// (`503` = "my API dependency is unreachable"), and it is STILL not
					// fatal here, for the same reason a missing route is not: the web app
					// reaches the API over the overlay, and during onboarding that path is
					// being assembled — the API is provisioning, the route may be seconds
					// old. Failing readiness on it would deadlock the handover that fixes
					// it (setup waits for ready before releasing the entry port).
					//
					// So it is reported as a warning too. The ENFORCEMENT lives in setup's
					// handover, which waits for the dashboard before declaring success —
					// after the port release, so it cannot deadlock. Here the job is to
					// OBSERVE and report, not to gate.
					if (status >= 500) {
						finish({
							reachable: false,
							reason: `the web health route answered ${String(status)} — the app is up but not serving (it reports its own API dependency as unreachable)`,
							fatal: false,
						});
						return;
					}

					finish({ reachable: true, reason: `${hostname} is routed (${String(status)})` });
				},
			);

			request.setTimeout(ManagedWebSupervisorService.REACHABILITY_TIMEOUT_MS, () => {
				request.destroy();
				finish({
					reachable: false,
					reason: `the ingress at ${ingress} did not answer within ${String(ManagedWebSupervisorService.REACHABILITY_TIMEOUT_MS)}ms`,
					fatal: false,
				});
			});
			request.on("error", (error: Error) => {
				finish({
					reachable: false,
					reason: `the ingress at ${ingress} is not reachable (${error.message})`,
					fatal: false,
				});
			});
			request.end();
		});
		/* c8 ignore stop */
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
