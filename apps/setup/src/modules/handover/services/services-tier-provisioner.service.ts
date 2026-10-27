import { AGENT_RUN_VOLUME, AGENT_SOCKET_DIR } from "@deployer/mesh-network";
import { Injectable, Logger } from "@nestjs/common";
import { DockerService } from "@deployer/nest-docker/services/docker.service";
import { toDockerServiceSpec } from "@deployer/nest-docker/services/swarm-spec.mapper";

import { EnvService } from "@/config/env/env.module";
import { SetupGateService } from "@/modules/wizard/setup-gate.service";
import type { SetupEnv } from "@/config/env/env.schema";
import { platformOverlayForPrefix } from "@deployer/nest-docker/services/docker-supervisor-runtime";

/** A configuration key this provisioner reads. */
type EnvKey = keyof SetupEnv;

/**
 * The microservices tier, as settings rather than as compose containers.
 *
 * ── WHY THIS FILE EXISTS ────────────────────────────────────────────────────
 * `API_SERVICES` in `@deployer/shared` already declares the five service names,
 * their default ports, and — through `apiServiceUrl()` — that a service's NAME is
 * its ADDRESS (`http://svc-<name>:<port>`). That is the whole routing contract, so
 * this file must not restate it. It only holds what a SERVICE cannot know about
 * itself: which workspace package to image, and which port to bind.
 *
 * ── WHY DUPLICATING THE PORT HERE IS SAFE ──────────────────────────────────
 * It is not duplicated data, it is an IMPORT: the ports come from
 * `API_SERVICES`, so a port change lands in one place. The array below is the
 * ORDER they are scheduled in (the BFF first, so `/health/ready` answers as soon
 * as possible), and an `as const` tuple is what makes the order visible.
 */
	const SERVICE_TIER = [
	{ name: "health", pkg: "@deployer/svc-health", src: "api/services/health", imageVar: "DEPLOYER_SVC_HEALTH_IMAGE" },
	{ name: "identity", pkg: "@deployer/svc-identity", src: "api/services/identity", imageVar: "DEPLOYER_SVC_IDENTITY_IMAGE" },
	{ name: "project", pkg: "@deployer/svc-project", src: "api/services/project", imageVar: "DEPLOYER_SVC_PROJECT_IMAGE" },
	{ name: "fleet", pkg: "@deployer/svc-fleet", src: "api/services/fleet", imageVar: "DEPLOYER_SVC_FLEET_IMAGE" },
	{ name: "runtime", pkg: "@deployer/svc-runtime", src: "api/services/runtime", imageVar: "DEPLOYER_SVC_RUNTIME_IMAGE" },
] as const satisfies readonly { name: string; pkg: string; src: string; imageVar: EnvKey }[];

/** One scheduled app, as setup needs to describe it. */
export interface ScheduledApp {
	/** The swarm service name, which is also the DNS name on the overlay. */
	name: string;
	/** The image tag setup schedules (built by compose, or pulled from a registry). */
	image: string;
	/** The in-container port the app binds. */
	port: number;
}

/**
 * Schedules the BFF + the five services as SWARM SERVICES.
 *
 * ── THE PROFILE THIS SERVES ─────────────────────────────────────────────────
 * `dev:supervised` for the microservices tier: compose builds the images and
 * exits, `setup` founds the cluster, and THIS schedules the whole tier onto it.
 * The alternative — letting compose own the app containers — is a different
 * product: those containers belong to no cluster, so they have no placement, no
 * restart policy across nodes, and no `docker service ls` visibility. That is
 * precisely what the supervised profile exists to exercise, so compose owning
 * them would have exercised nothing.
 *
 * ── WHY SETUP SCHEDULES THEM AND NOT THE BFF ────────────────────────────────
 * The BFF cannot schedule itself: it does not exist until it is scheduled. Setup
 * is the only process alive BEFORE the tier, so it is the only process that can
 * create it — the same reason `ApiServiceProvisioner` schedules the monolith's
 * API. Once the tier is up the BFF's own supervisors take over the stateful
 * parts (database, Redis, ingress); scheduling is a ONE-SHOT act, supervision is
 * continuous, and they are different jobs.
 *
 * ── WHY EVERY APP GETS THE SAME ENVIRONMENT ─────────────────────────────────
 * A swarm task inherits NOTHING from the compose project that created it — no
 * `environment:`, no `networks:`, no volumes. So the values below are not
 * conveniences being forwarded, they are the app's entire configuration. Sharing
 * one builder means the BFF and the five services cannot disagree about the
 * database, the auth secret or the service URLs, which is the class of bug that
 * produced the 401s and the split database described in
 * `docker-compose.config.services.yml`.
 */
@Injectable()
export class ServicesTierProvisioner {
	private readonly logger = new Logger(ServicesTierProvisioner.name);

	constructor(
		private readonly env: EnvService,
		private readonly docker: DockerService,
		private readonly gate: SetupGateService,
	) {}

	/**
	 * Schedule the tier, idempotently, and return what was scheduled.
	 *
	 * ── WHY IDEMPOTENT RATHER THAN RECREATE ─────────────────────────────────
	 * Setup must be safely re-runnable — an operator retries a failed onboarding,
	 * and a restart re-enters handover. Recreating would roll a healthy tier and
	 * turn a harmless retry into an outage. An existing service is CONVERGED
	 * instead: the spec is compared and only updated when it actually differs, so
	 * a no-op re-run stays a no-op.
	 */
	async ensureTier(): Promise<ScheduledApp[]> {
		const overlay = this.platformNetworkName();
		await this.ensureOverlay(overlay);

		const scheduled: ScheduledApp[] = [];

		// ── THE BFF FIRST, DELIBERATELY ─────────────────────────────────────
		// Every other app gates on `bff:3005/health/ready` (that is the onboarding
		// gate in the compose file this profile replaces). Creating the BFF first
		// means its readiness begins converging while the other five are still
		// being created, instead of all six waiting on the last one scheduled.
		scheduled.push(await this.ensureApp(overlay, this.bffApp()));

		for (const service of SERVICE_TIER) {
			scheduled.push(await this.ensureApp(overlay, this.serviceApp(service)));
		}

		this.logger.log(
			`Microservices tier scheduled: ${scheduled.map((a) => a.name).join(", ")}`,
		);
		return scheduled;
	}

	/** The BFF: the tier's only public HTTP surface. */
	private bffApp(): ScheduledApp {
		return {
			name: this.serviceName("bff"),
			// OPTIONAL by schema so a dev stack that never schedules the tier need not set
			// it; `ApiServiceProvisioner` refuses to hand over in prod without it. Narrowed
			// to a string here because `ensureApp` rejects an empty image by name.
			image: this.env.get("DEPLOYER_BFF_IMAGE") ?? "",
			port: this.env.get("SETUP_API_PORT"),
		};
	}

	/** One service, from the tier table above. */
	private serviceApp(service: (typeof SERVICE_TIER)[number]): ScheduledApp {
		return {
			name: this.serviceName(service.name),
			// One tag per service, so an operator can pin ONE service without
			// rebuilding the other five. OPTIONAL by schema; an empty value is
			// rejected by name in `ensureApp` rather than becoming an unpullable
			// service whose failure mentions a manifest.
			image: this.env.get(service.imageVar) ?? "",
			port: this.servicePort(service.name),
		};
	}
	/**
	 * Prefix + name, matching `apiServiceUrl()` in `@deployer/shared`.
	 *
	 * The BFF reaches a service as `http://svc-<name>:<port>`, so the SWARM
	 * SERVICE NAME must be `svc-<name>` — not `<name>`, and not
	 * `deployer-svc-<name>`. A prefix is only applied when the operator set one,
	 * and it must then ALSO reach the app's own resolution (see the env builder),
	 * or the two sides disagree and every call is `ENOTFOUND`.
	 */
	private serviceName(name: string): string {
		const prefix = this.env.get("DEPLOYER_PREFIX");
		return prefix === "" ? `svc-${name}` : `svc-${name}-${prefix}`;
	}

	/**
	 * The port a service binds.
	 *
	 * Mirrors `apiServicePort()` in `@deployer/shared`: the same defaults, and the
	 * same `API_SERVICE_PORTS` override — passed as the app's own env below, so
	 * the value the service BINDS and the value the BFF DIALS come from one
	 * source. Hardcoding the defaults here would let a service bind 3102 while
	 * the BFF dialled whatever the override said.
	 */
	private servicePort(name: string): number {
		const override = this.env.get("API_SERVICE_PORTS");
		if (override !== undefined && override !== "") {
			try {
				const parsed: unknown = JSON.parse(override);
				if (typeof parsed === "object" && parsed !== null) {
					const value = (parsed as Record<string, unknown>)[name];
					if (typeof value === "number" && Number.isInteger(value)) return value;
				}
			} catch {
				// A malformed override must not crash onboarding; the defaults below
				// are the same ones `apiServicePort()` falls back to.
			}
		}
		const defaults: Record<string, number> = {
			health: 3101,
			identity: 3102,
			project: 3103,
			fleet: 3104,
			runtime: 3105,
		};
		return defaults[name] ?? 3101;
	}

	/**
	 * Create or converge ONE app as a swarm service.
	 */
	private async ensureApp(overlay: string, app: ScheduledApp): Promise<ScheduledApp> {
		// An EMPTY image (not undefined) is the failure mode: the schema already
		// guarantees the variable is a string when present, so the operator needs
		// the name to fix it rather than a service created with `Image: ""` that
		// fails to pull with a message about a manifest.
		if (app.image.length === 0) {
			throw new Error(
				`No image configured for ${app.name}. Set the image tag for this app ` +
					`(produced by the compose build services) before onboarding.`,
			);
		}

		const spec = toDockerServiceSpec({
			name: app.name,
			image: app.image,
			mode: "replicated",
			// ONE replica per app by default. These are stateful in the sense that
			// matters here — each holds SSE streams and an in-memory event bus — so
			// more replicas would need sticky routing that does not exist yet. The
			// operator can raise it; the tier stays correct at 1.
			replicas: this.env.get("DEPLOYER_SVC_REPLICAS"),
			env: this.appEnvironment(app),
			command: [],
			args: [],
			labels: { "deployer.platform.role": "microservice" },
			containerLabels: {},
			mounts: this.appMounts(),
			networks: [{ target: overlay, aliases: [app.name] }],
			healthcheck: null,
			updateConfig: { parallelism: 1, delayMs: 0, order: "start-first", failureAction: "rollback" },
			stopGracePeriodSeconds: 10,
			// `vip`: the BFF dials one stable address per service and the swarm
			// balances across replicas. State is per-service and reached through the
			// database, never through a specific task, so no task affinity is needed.
			endpointMode: "vip",
			// NO PUBLISHED PORT. Every app is reached through the ingress, and a
			// swarm publish binds every interface of every node — which would expose
			// the internal tier on the host and, worse, let two profiles fight over
			// the same port.
			endpointPorts: [],
			placementPreferences: [],
			placementConstraints: [],
			resourcesLimits: {},
			resourcesReservations: {},
			capabilitiesAdd: [],
		});

		const existing = await this.findExistingService(app.name);
		if (existing === null) {
			this.logger.log(`Creating ${app.name} from image ${app.image} on ${overlay}`);
			await this.docker.createSwarmService(spec);
			return app;
		}

		this.logger.log(`${app.name} already exists — converging it`);
		await this.docker.updateSwarmService(app.name, existing.Version.Index, spec);
		return app;
	}

	/**
	 * The environment EVERY app in the tier receives.
	 *
	 * ── THIS IS THE APP'S ENTIRE CONFIGURATION ──────────────────────────────
	 * A swarm task inherits nothing from the compose project: no `environment:`,
	 * no network aliases, no volumes. So each value below is load-bearing, and the
	 * block comments say which failure each one prevents — every one of them was a
	 * real defect in the compose-owned profile.
	 */
	private appEnvironment(app: ScheduledApp): string[] {
		const env = [
			`NODE_ENV=production`,
			// The port the app BINDS. Each service reads `APP_PORT`; the BFF kept the
			// monolith's `API_PORT`, so both are set to the same value rather than
			// hoping the app reads the one that was set.
			`APP_PORT=${String(app.port)}`,
			`API_PORT=${String(app.port)}`,
			`NODE_LOCAL_DB_PATH=/app/data/local.db`,
		];

		// ── THE DATABASE ─────────────────────────────────────────────────────
		// `MANAGED_GLOBAL_DB_ENABLED=false` is the correct answer ON A SUPERVISED
		// STACK, and it is the opposite of the compose-owned profile. There, compose
		// ran `global-db` and every app was told to derive its URL from env. Here the
		// PLATFORM owns the database: the BFF's `GlobalDbSupervisorService` creates it
		// as a swarm service (that is what "supervised" means), and the URL comes from
		// `node_config`, which setup has just written. Pinning a compose hostname here
		// would point every app at a container that does not exist in this profile.
		env.push(`MANAGED_GLOBAL_DB_ENABLED=false`);

		// ── THE MESH AGENT'S SOCKET ──────────────────────────────────────────
		// The node's agent is a plain host-network container setup starts. Its socket
		// volume is mounted below; the PATH is what the clients dial.
		env.push(`MESH_AGENT_SOCKET=${AGENT_SOCKET_DIR}/agent.sock`);

		// ── WHERE THE INGRESS FINDS ITS ROUTES ──────────────────────────────
		// Traefik runs with its HTTP provider pointed at
		// `http://<public app>:<port>/internal/ingress/traefik-config`, and the
		// DEFAULT for that host is `deployer-api` — the monolith's service name.
		// On this tier the public app is `svc-bff`, so the default resolves to
		// nothing and the provider loops forever:
		//
		//   ERR Provider error: cannot fetch configuration data:
		//     Get "http://deployer-api:3005/internal/ingress/traefik-config":
		//     dial tcp: lookup deployer-api on 127.0.0.11:53: no such host
		//
		// An ingress with no routes answers `404 page not found` for EVERY hostname
		// while all seven services report 1/1 — the most misleading state a
		// supervised stack can be in. `DEPLOYER_API_TARGET` is the documented
		// override the supervisor reads, so naming the BFF here is what makes the
		// ingress route at all.
		env.push(`DEPLOYER_API_TARGET=${this.serviceName("bff")}`);

		// ── WHERE THE BFF FINDS ITS SERVICES ─────────────────────────────────
		// `apiServiceUrl()` derives `http://svc-<name>:<port>` by default, which is
		// exactly the alias registered above, so no override is needed — with or
		// without a prefix, because `serviceName()` is the single place that applies
		// one and both sides read it.
		const prefix = this.env.get("DEPLOYER_PREFIX");
		if (prefix !== "") env.push(`DEPLOYER_PREFIX=${prefix}`);

		// ── AUTH: ONE SECRET, ONE PARENT DOMAIN ──────────────────────────────
		// Both apps must agree or a session is valid on one host and not the other
		// (`BETTER_AUTH_SECRET` signs, the web app's middleware verifies). The parent
		// domain is what makes EVERY subdomain a valid Origin in one value; without
		// it the wizard's own sign-in fails with `Invalid origin`.
		const authSecret = this.env.get("AUTH_SECRET");
		env.push(`AUTH_SECRET=${authSecret}`);
		env.push(`BETTER_AUTH_SECRET=${authSecret}`);
		env.push(`AUTH_BASE_DOMAIN=${this.authBaseDomain(prefix)}`);
		env.push(`NEXT_PUBLIC_API_URL=${this.publicOrigin("api", prefix)}`);
		env.push(`NEXT_PUBLIC_APP_URL=${this.publicOrigin("web", prefix)}`);
		// The web app's address as seen from INSIDE the platform: the managed web app is a swarm
		// service, so it answers at its service name on the shared overlay.
		env.push(`APP_URL=${this.managedWebServiceUrl(prefix)}`);
		// Belt and braces next to the `AUTH_BASE_DOMAIN` wildcard: naming the setup origin keeps the
		// wizard's own sign-in valid even when a deployment narrows `AUTH_BASE_DOMAIN`.
		env.push(`TRUSTED_ORIGINS=${this.publicOrigin("setup", prefix)}`);

		// ── WHETHER THIS NODE BRINGS UP A WIREGUARD INTERFACE ────────────────
		// A swarm task inherits nothing, so without this the BFF falls back to its schema default
		// (`observe`) and the operator's `kernel` is discarded: the mesh silently stays down on a
		// deployment that asked for it. Never empty (the schema enum resolves unset to `observe`).
		env.push(`MESH_AGENT_DATAPLANE=${this.env.get("MESH_AGENT_DATAPLANE")}`);

		// ── THE ADMIN SEED ───────────────────────────────────────────────────
		// The BFF's boot pipeline ensures a default admin when the policy allows it.
		// Forwarded so the account the operator created in the wizard is the one that
		// exists, rather than the schema default.
		const adminKeys = ["DEFAULT_ADMIN_EMAIL", "DEFAULT_ADMIN_PASSWORD", "ADMIN_BOOTSTRAP"] as const satisfies readonly EnvKey[];
		for (const name of adminKeys) {
			// All three are optional STRINGS in this app's schema, so the only two
			// states are "set" and "absent" — an empty string is not a third.
			const value = this.env.get(name);
			if (value !== undefined && value.length > 0) env.push(`${name}=${value}`);
		}

		// ── THE IMAGE TAGS THE PLATFORM'S SUPERVISORS SCHEDULE ───────────────
		// The BFF runs the supervisors (`SupervisorsPlatformModule`), and they build
		// their service specs from THESE tags. A swarm task inherits nothing from the
		// compose project, so an unset tag falls back to the supervisor's own default
		// — which is `:latest`, and no dev producer tags that. The failure is a pull
		// rejection that looks like a private-registry problem:
		//
		//   deployer-managed-web  Rejected: "pull access denied for deployer-web,
		//                         repository does not exist or may require 'docker login'"
		//
		// The image existed as `deployer-web:dev` the whole time (built by
		// `build-web`), and the service was created asking for `deployer-web:latest`.
		// Measured on a live run: forwarding this one value took the service from
		// `Rejected` to running.
		//
		// Forwarded generically so a new supervised image needs no code change here.
		const imageKeys = [
			"MANAGED_WEB_APP_IMAGE",
			"DEPLOYER_TRAEFIK_IMAGE",
			"DEPLOYER_REDIS_IMAGE",
			"DEPLOYER_DIRECT_PROXY_IMAGE",
			"MESH_AGENT_IMAGE",
		] as const satisfies readonly EnvKey[];
		for (const name of imageKeys) {
			const value = this.env.get(name);
			if (value !== undefined && value.length > 0) env.push(`${name}=${value}`);
		}

		// ── WHETHER THE DASHBOARD IS A SUPERVISED SERVICE AT ALL ─────────────
		// Both flags travel TOGETHER, because they are two halves of one decision and
		// the BFF reads them in a fixed order:
		//
		//   EXTERNAL is checked FIRST and short-circuits: truthy → return null
		//   ENABLED  is only consulted when EXTERNAL is falsy
		//
		// Forwarding ENABLED alone therefore did nothing. The BFF's env schema defaults
		// `MANAGED_WEB_APP_EXTERNAL` to TRUE (the safe default for every other profile,
		// where compose really does own the dashboard), so a supervised run forwarded
		// `MANAGED_WEB_APP_ENABLED=true`, `resolveWebTarget()` short-circuited on the
		// unforwarded EXTERNAL default, and returned null. The supervisor still created
		// `deployer-managed-web` (it reads ENABLED, which did arrive), so the service
		// sat at 1/1 while the ingress had NO `dynamic-web.yml` and
		// `web.<host>` returned a bare 000/502.
		//
		// Measured on a live run: `docker service inspect svc-bff` showed
		// `MANAGED_WEB_APP_ENABLED=true` and no EXTERNAL entry at all.
		//
		// The operator's answer in the wizard wins over the deployment's env default: forwarding
		// only the env value would silently discard the choice made on screen. `managed` also
		// sets EXTERNAL=false, because EXTERNAL short-circuits ENABLED (above).
		const managedWeb = this.gate.managedWebEnabled();
		if (managedWeb !== null) {
			env.push(`MANAGED_WEB_APP_ENABLED=${managedWeb ? "true" : "false"}`);
			if (managedWeb) env.push("MANAGED_WEB_APP_EXTERNAL=false");
			else {
				const external = this.env.get("MANAGED_WEB_APP_EXTERNAL");
				if (external !== undefined && String(external).length > 0) env.push(`MANAGED_WEB_APP_EXTERNAL=${String(external)}`);
			}
		} else {
			for (const name of ["MANAGED_WEB_APP_ENABLED", "MANAGED_WEB_APP_EXTERNAL"] as const) {
				const value = this.env.get(name);
				if (value !== undefined && String(value).length > 0) env.push(`${name}=${String(value)}`);
			}
		}

		return env;
	}

	/**
	 * Volumes every app in the tier needs.
	 *
	 * Shared on purpose: the local SQLite file is the ONE place `node_config`
	 * lives, and every app reads it (`databaseUrl`, the swarm participation
	 * decision, the mesh identity). A per-app copy would be a different database
	 * per app — the split-brain that made `svc-identity` unable to find `session`.
	 */
	private appMounts(): {
		type: "volume" | "bind";
		source: string;
		target: string;
		readOnly: boolean;
	}[] {
		return [
			{
				type: "volume",
				source: this.env.get("NODE_LOCAL_DB_VOLUME"),
				target: "/app/data",
				readOnly: false,
			},
			{
				type: "volume",
				source: this.traefikConfigVolumeName(),
				target: "/app/traefik-configs",
				readOnly: false,
			},
			{
				type: "volume",
				source: AGENT_RUN_VOLUME,
				target: AGENT_SOCKET_DIR,
				readOnly: false,
			},
			// ── THE ENGINE SOCKET ────────────────────────────────────────────
			// `svc-runtime` owns containers, images and deployments; the BFF runs the
			// supervisors. A swarm task does NOT inherit the socket from the node it
			// lands on, so without this mount every engine call fails with
			// `connect ENOENT /var/run/docker.sock` and nothing converges.
			{
				type: "bind",
				source: "/var/run/docker.sock",
				target: "/var/run/docker.sock",
				readOnly: false,
			},
		];
	}

	/** The overlay every tier app joins — the swarm-scoped counterpart of the bridge. */
	private platformNetworkName(): string {
		return platformOverlayForPrefix(this.env.get("DEPLOYER_PREFIX"));
	}

	private async ensureOverlay(overlay: string): Promise<void> {
		await this.docker.ensureOverlayNetwork({
			name: overlay,
			driver: "overlay",
			attachable: true,
			ingress: false,
			enableIpv6: false,
			labels: { "deployer.managed": "true", "deployer.platform": "true" },
		});
	}

	private async findExistingService(name: string): Promise<{ Version: { Index: number } } | null> {
		try {
			const services = await this.docker.getDockerClient().listServices();
			const match = services.find((service) => service.Spec?.Name === name);
			return match === undefined ? null : { Version: { Index: match.Version?.Index ?? 0 } };
		} catch (error: unknown) {
			this.logger.warn(
				`Could not list swarm services while checking ${name}: ${error instanceof Error ? error.message : String(error)}`,
			);
			return null;
		}
	}

	/** Mirrors `HostnameService`: `api.deployer.localhost`, or `api.<prefix>.deployer.localhost`. */
	private publicOrigin(host: "api" | "web" | "setup", prefix: string): string {
		const suffix = prefix === "" ? "deployer.localhost" : `${prefix}.deployer.localhost`;
		return `http://${host}.${suffix}`;
	}

	/**
	 * The managed web app's address inside the platform network: the swarm service name, which is
	 * also its DNS name on the overlay (`ManagedWebSupervisorService` names it the same way).
	 */
	private managedWebServiceUrl(prefix: string): string {
		const name = prefix === "" ? "deployer-managed-web" : `deployer-managed-web-${prefix}`;
		return `http://${name}:3000`;
	}

	private authBaseDomain(prefix: string): string {
		return prefix === "" ? ".deployer.localhost" : `.${prefix}.deployer.localhost`;
	}

	/** The ingress config volume: what the API writes and Traefik reads. */
	private traefikConfigVolumeName(): string {
		// Schema default guarantees a non-empty value, so no fallback branch is
		// reachable — composing one would be dead code pretending to be defensive.
		return this.env.get("TRAEFIK_CONFIG_VOLUME");
	}
}
