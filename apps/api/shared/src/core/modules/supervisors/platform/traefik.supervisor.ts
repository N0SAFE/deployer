import { Logger } from "@nestjs/common";
import { runPromiseUnwrapped } from "@deployer/effect-core";
import { platformOverlayForPrefix } from "@deployer/docker";
import { NODE_DOORS_SETTING_KEY, type DoorRescueRoute } from "@deployer/mesh-network";
import type { DockerEngineShape } from "@deployer/docker";
import { buildSupervisor, type SupervisorEventBus, type SupervisorRegistration } from "../../supervision/index";
import { splitManagedEnv } from "@deployer/env";
import {
	makeTraefikSupervisor,
	PLATFORM_INGRESS_SUPERVISOR_ID,
	traefikProcessInfoSchema,
	traefikSupervisorPayloadSchema,
	type TraefikSupervisor,
} from "@deployer/platform-supervisors";
import { Effect } from "effect";

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

export type TraefikSupervisorDeps = {
	readonly engine: DockerEngineShape;
	readonly hostnameService: HostnameService;
	readonly env: EnvService;
	readonly lanes: IngressLanesService;
	readonly mesh: MeshAgentClient;
	readonly webTarget: PlatformWebTargetService;
	readonly edges: EdgeProviderRegistry;
	readonly bus: SupervisorEventBus;
};

/**
 * The ingress supervisor. What it does (the global swarm service, its routes polled from the API, the
 * lanes, the inbound-edge plan, the node doors) is `@deployer/platform-supervisors`; this supplies the
 * engine, the environment, the hostnames, the lanes, the mesh agent and the edge registry, and decides
 * WHETHER to register: not when compose/operator owns the ingress (`MANAGED_TRAEFIK_ENABLED=true`).
 */
export function makeTraefikRegistration(deps: TraefikSupervisorDeps): {
	readonly registration: SupervisorRegistration;
	readonly traefik: TraefikSupervisor;
} {
	const { engine, hostnameService, env, lanes: lanesService, mesh, webTarget, edges, bus } = deps;
	const logger = new Logger("TraefikSupervisor");
	const prefix = () => env.get("DEPLOYER_PREFIX");
	const apiTarget = () => {
		const explicit = env.get("DEPLOYER_API_TARGET")?.trim();
		return explicit !== undefined && explicit !== "" ? explicit : platformApiServiceName(prefix());
	};

	/** The console hosts the local door serves directly when Traefik does not answer. */
	const rescueRoutes = async (target: string): Promise<DoorRescueRoute[]> => {
		const routes: DoorRescueRoute[] = [{ host: hostnameService.apiHostname(), target, port: env.get("API_PORT") }];
		const web = await webTarget.resolveWebTarget().catch(() => null);
		if (web !== null) routes.push({ host: hostnameService.webHostname(), target: web, port: PLATFORM_WEB_INTERNAL_PORT });
		return routes;
	};

	const isExternallyManaged = () => splitManagedEnv(env).traefik.enabled;

	const traefik = makeTraefikSupervisor({
		engine,
		logger,
		config: {
			prefix,
			serviceName: () => platformTraefikContainerName(prefix()),
			image: () => env.get("DEPLOYER_TRAEFIK_IMAGE"),
			apiTarget,
			apiPort: () => env.get("API_PORT"),
			configPath: TRAEFIK_CONFIG_PATH,
			apiHostname: () => hostnameService.apiHostname(),
			apiOrigin: () => hostnameService.apiOrigin(),
			webOrigin: () => hostnameService.webOrigin(),
			providerToken: () => ({
				header: INGRESS_TOKEN_HEADER,
				value: deriveIngressProviderToken(requireIngressSecret(env.get("AUTH_SECRET"), env.get("BETTER_AUTH_SECRET"))),
			}),
			acmeEmail: () => env.get("DEPLOYER_TRAEFIK_ACME_EMAIL"),
			entrypoints: LANE_ENTRYPOINTS,
			acmeResolver: TRAEFIK_ACME_RESOLVER,
			externallyManaged: isExternallyManaged,
			runtimeOverride: () => process.env.SUPERVISOR_RUNTIME,
			selfHostname: () => process.env.HOSTNAME,
			lanes: Effect.tryPromise(() => lanesService.getLanes()),
			edgePlan: (lanes) => edges.ingressPlan(lanes),
			publishNodeDoors: ({ lanes, traefikService }) =>
				Effect.tryPromise(async () => {
					const namePrefix = prefix();
					const doors = buildNodeDoors({
						lanes,
						namePrefix: namePrefix === "" ? "deployer" : `deployer-${namePrefix}`,
						network: platformOverlayForPrefix(namePrefix),
						image: env.get("DEPLOYER_DOOR_IMAGE"),
						traefikService,
						rescue: await rescueRoutes(apiTarget()),
					});
					await mesh.writeSetting(NODE_DOORS_SETTING_KEY, doors);
				}),
		},
	});
	const supervisor = buildSupervisor(traefik.spec, bus, "TraefikSupervisor");
	return {
		traefik,
		registration: {
			supervisor,
			activate: Effect.suspend(() => {
				if (isExternallyManaged()) {
					logger.log("Externally-managed Traefik detected (MANAGED_TRAEFIK_ENABLED=true) — supervisor skipped (not registered)");
					return Effect.succeed(null);
				}
				return traefik.reload.pipe(Effect.as({ background: traefik.background(supervisor.ensureDesiredState) }));
			}),
		},
	};
}
