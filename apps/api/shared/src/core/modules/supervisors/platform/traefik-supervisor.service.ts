import { Injectable, type OnModuleDestroy } from "@nestjs/common";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { platformOverlayForPrefix } from "@deployer/docker";
import { NODE_DOORS_SETTING_KEY, type DoorRescueRoute } from "@deployer/mesh-network";
import { DockerService } from "@deployer/nest-effect/docker";
import { SupervisorHost } from "@deployer/nest-effect/supervision";
import { splitManagedEnv } from "@deployer/env";
import {
	makeTraefikSupervisor,
	PLATFORM_INGRESS_SUPERVISOR_ID,
	traefikProcessInfoSchema,
	traefikSupervisorPayloadSchema,
	type TraefikSupervisor,
} from "@deployer/platform-supervisors";
import { Effect, Fiber } from "effect";

import { EnvService } from "../../../../config/env/env.module";
import { EdgeProviderRegistry } from "../../edge/edge-provider.registry";
import { MeshAgentClient } from "../../mesh-agent/mesh-agent.client";
import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { buildNodeDoors } from "../../platform-ingress/services/ingress-doors";
import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import {
	deriveIngressProviderToken,
	INGRESS_TOKEN_HEADER,
	requireIngressSecret,
	TRAEFIK_CONFIG_PATH,
} from "../../platform-ingress/services/ingress-provider-token";
import { LANE_ENTRYPOINTS, TRAEFIK_ACME_RESOLVER } from "../../platform-ingress/services/lane-traefik-config";
import {
	PLATFORM_WEB_INTERNAL_PORT,
	platformApiServiceName,
	platformTraefikContainerName,
} from "../../platform-ingress/services/platform-names";
import { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";

export { PLATFORM_INGRESS_SUPERVISOR_ID };

/**
 * The Nest host of the platform ingress supervisor (one Traefik task per node, one entrypoint per lane).
 * What it does (the global swarm service, its routes polled from the API, the lanes, the inbound-edge
 * ports, the bootstrap handover, the health check) is `@deployer/platform-supervisors`; this class
 * supplies the engine, the environment, the lanes and edge plan, and the node-doors publication, decides
 * WHETHER to register (not when `MANAGED_TRAEFIK_ENABLED=true`), and runs the handover watch for the
 * life of the module.
 */
@Injectable()
export class TraefikSupervisorService
	extends SupervisorHost<typeof traefikSupervisorPayloadSchema, typeof traefikProcessInfoSchema>
	implements OnModuleDestroy
{
	static readonly identifier = PLATFORM_INGRESS_SUPERVISOR_ID;

	readonly payloadSchema = traefikSupervisorPayloadSchema;
	readonly processInfoSchema = traefikProcessInfoSchema;
	readonly description: string;

	private readonly traefik: TraefikSupervisor;
	private handoverWatch: Fiber.Fiber<never> | null = null;

	constructor(
		dockerService: DockerService,
		private readonly hostnameService: HostnameService,
		private readonly env: EnvService,
		lanesService: IngressLanesService,
		private readonly mesh: MeshAgentClient,
		private readonly webTarget: PlatformWebTargetService,
		private readonly edges: EdgeProviderRegistry,
	) {
		super();
		const prefix = () => this.env.get("DEPLOYER_PREFIX");
		const apiTarget = () => {
			const explicit = this.env.get("DEPLOYER_API_TARGET")?.trim();
			return explicit !== undefined && explicit !== "" ? explicit : platformApiServiceName(prefix());
		};
		this.traefik = makeTraefikSupervisor({
			engine: dockerService.getEngine(),
			logger: this.logger,
			config: {
				prefix,
				serviceName: () => platformTraefikContainerName(prefix()),
				image: () => this.env.get("DEPLOYER_TRAEFIK_IMAGE"),
				apiTarget,
				apiPort: () => this.env.get("API_PORT"),
				configPath: TRAEFIK_CONFIG_PATH,
				apiHostname: () => this.hostnameService.apiHostname(),
				apiOrigin: () => this.hostnameService.apiOrigin(),
				webOrigin: () => this.hostnameService.webOrigin(),
				providerToken: () => ({
					header: INGRESS_TOKEN_HEADER,
					value: deriveIngressProviderToken(requireIngressSecret(this.env.get("AUTH_SECRET"), this.env.get("BETTER_AUTH_SECRET"))),
				}),
				acmeEmail: () => this.env.get("DEPLOYER_TRAEFIK_ACME_EMAIL"),
				entrypoints: LANE_ENTRYPOINTS,
				acmeResolver: TRAEFIK_ACME_RESOLVER,
				externallyManaged: () => this.isExternallyManaged(),
				runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
				selfHostname: () => process.env.HOSTNAME,
				lanes: Effect.tryPromise(() => lanesService.getLanes()),
				edgePlan: (lanes) => this.edges.ingressPlan(lanes),
				publishNodeDoors: ({ lanes, traefikService }) =>
					Effect.tryPromise(async () => {
						const namePrefix = prefix();
						const doors = buildNodeDoors({
							lanes,
							namePrefix: namePrefix === "" ? "deployer" : `deployer-${namePrefix}`,
							network: platformOverlayForPrefix(namePrefix),
							image: this.env.get("DEPLOYER_DOOR_IMAGE"),
							traefikService,
							rescue: await this.rescueRoutes(apiTarget()),
						});
						await this.mesh.writeSetting(NODE_DOORS_SETTING_KEY, doors);
					}),
			},
		});
		this.description = this.traefik.spec.description;
	}

	protected buildSpec(): TraefikSupervisor["spec"] {
		return this.traefik.spec;
	}

	/** The HTTP provider endpoint every ingress task polls. */
	providerEndpoint(): string {
		return this.traefik.providerEndpoint();
	}

	/** `MANAGED_TRAEFIK_ENABLED=true`: compose/operator owns the ingress. */
	isExternallyManaged(): boolean {
		return splitManagedEnv(this.env).traefik.enabled;
	}

	override async onModuleInit(): Promise<void> {
		if (this.isExternallyManaged()) {
			this.logger.log("Externally-managed Traefik detected (MANAGED_TRAEFIK_ENABLED=true) — supervisor skipped (not registered)");
			return;
		}
		await runPromiseUnwrapped(this.traefik.reload);
		super.onModuleInit();
		this.handoverWatch = Effect.runFork(this.traefik.background(this.runtime.ensureDesiredState));
	}

	onModuleDestroy(): void {
		if (this.handoverWatch === null) return;
		void Effect.runPromise(Fiber.interrupt(this.handoverWatch));
		this.handoverWatch = null;
	}

	/** The console hosts the local door serves directly when Traefik does not answer. */
	private async rescueRoutes(apiTarget: string): Promise<DoorRescueRoute[]> {
		const routes: DoorRescueRoute[] = [
			{ host: this.hostnameService.apiHostname(), target: apiTarget, port: this.env.get("API_PORT") },
		];
		const web = await this.webTarget.resolveWebTarget().catch(() => null);
		if (web !== null) routes.push({ host: this.hostnameService.webHostname(), target: web, port: PLATFORM_WEB_INTERNAL_PORT });
		return routes;
	}
}
