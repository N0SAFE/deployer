/**
 * SupervisorsPlatformModule — registers the PLATFORM supervisors.
 *
 * All supervisor definitions live under `supervisors/` (folder layout); each is a `make…Registration`
 * function that builds the Effect `Supervisor` from its spec and decides whether it registers:
 *   - platform/traefik.supervisor.ts          → Traefik ingress (every node)
 *   - platform/edge-connector.supervisor.ts   → the public edge's connector (any tunnel provider)
 *   - platform/managed-web.supervisor.ts      → managed web app
 *   - platform/redis.supervisor.ts            → Redis (API-supervised)
 *   - platform/swarm-app-wiring.supervisor.ts → keeps this container on the swarm overlay
 *   - node-agent/node-agent.supervisor.ts     → the node's mesh agent as a swarm GLOBAL service (opt-in,
 *                                               `NODE_AGENT_SWARM_MODE=true`; default is the host container)
 *
 * There is no failover proxy and no WireGuard sidecar any more: the node's mesh agent owns the loopback
 * door (which falls back to the API/web when Traefik does not answer) and the WireGuard interface — see
 * docs/edge-mesh-architecture.md.
 *
 * These consume the platform HELPER services (hostname, ingress lanes, app-instance, platform-config)
 * provided by CorePlatformIngressModule — the helpers stay in platform-ingress/services (one-way
 * dependency: platform helps → supervisors use).
 */

import { DockerEngine, type DockerEngineShape } from "@deployer/docker";
import { createGlobalModule } from "@deployer/nest-effect";

import { EnvModule, EnvService } from "../../../../config/env/env.module";
import { CoreDockerModule } from "../../docker/docker.module";
import { EdgeProviderRegistry, type EdgeProviderRegistryShape } from "../../edge/edge-provider.registry";
import { CoreEdgeModule } from "../../edge/edge.module";
import { ClusterSettings } from "../../mesh-node/cluster-settings";
import { CorePlatformIngressModule } from "../../platform-ingress/platform-ingress.module";
import { AppInstanceService } from "../../platform-ingress/services/app-instance.service";
import { HostnameService } from "../../platform-ingress/services/hostname.service";
import { IngressLanesService } from "../../platform-ingress/services/ingress-lanes.service";
import { PlatformConfigService } from "../../platform-ingress/services/platform-config.service";
import { PlatformWebTargetService } from "../../platform-ingress/services/platform-web-target.service";
import { CoreReachabilityModule } from "../../reachability/core-reachability.module";
import { PublicEdgeService } from "../../reachability/services/public-edge.service";
import { supervisorProviders, SupervisorEventBus } from "../../supervision/index";
import { makeNodeAgentSwarmRegistration } from "../node-agent/node-agent.supervisor";

import { makeEdgeConnectorRegistration } from "./edge-connector.supervisor";
import { makeManagedWebRegistration } from "./managed-web.supervisor";
import { makeRedisRegistration } from "./redis.supervisor";
import { makeSwarmAppWiringRegistration } from "./swarm-app-wiring.supervisor";
import { makeTraefikRegistration } from "./traefik.supervisor";

const PLATFORM_SUPERVISORS = Symbol("PLATFORM_SUPERVISORS");

export const SupervisorsPlatformModule = createGlobalModule({
	imports: [CoreDockerModule, CorePlatformIngressModule, CoreEdgeModule, CoreReachabilityModule, EnvModule],
	providers: supervisorProviders({
		token: PLATFORM_SUPERVISORS,
		inject: [
			DockerEngine,
			EnvService,
			SupervisorEventBus,
			HostnameService,
			IngressLanesService,
			ClusterSettings,
			PlatformWebTargetService,
			EdgeProviderRegistry,
			PlatformConfigService,
			AppInstanceService,
			PublicEdgeService,
		],
		build: (
			engine: DockerEngineShape,
			env: EnvService,
			bus: SupervisorEventBus,
			hostnameService: HostnameService,
			lanes: IngressLanesService,
			settings: ClusterSettings,
			webTarget: PlatformWebTargetService,
			edges: EdgeProviderRegistryShape,
			platformConfig: PlatformConfigService,
			appInstances: AppInstanceService,
			edge: PublicEdgeService,
		) => [
			makeTraefikRegistration({ engine, hostnameService, env, lanes, settings, webTarget, edges, bus }).registration,
			makeManagedWebRegistration({ engine, env, hostnameService, platformConfig, appInstances, bus }),
			makeRedisRegistration({ engine, env, bus }).registration,
			makeSwarmAppWiringRegistration({ engine, env, bus }),
			makeEdgeConnectorRegistration({ engine, env, lanes, edge, bus }),
			makeNodeAgentSwarmRegistration({ engine, env, bus }).registration,
		],
	}),
});
