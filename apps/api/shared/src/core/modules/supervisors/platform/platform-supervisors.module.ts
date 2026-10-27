/**
 * SupervisorsPlatformModule — registers the PLATFORM supervisors.
 *
 * All supervisor implementations live under `supervisors/` (folder layout):
 *   - platform/traefik-supervisor.service.ts       → Traefik ingress (every node)
 *   - platform/edge-connector-supervisor.service.ts → the public edge's connector (any tunnel provider)
 *   - platform/managed-web-supervisor.service.ts   → managed web app
 *   - platform/redis-supervisor.service.ts         → Redis (API-supervised)
 *
 * There is no failover proxy and no WireGuard sidecar any more: the node's mesh
 * agent owns the loopback door (which falls back to the API/web when Traefik does
 * not answer) and the WireGuard interface — see docs/edge-mesh-architecture.md.
 *
 * These consume the platform HELPER services (hostname, ingress lanes,
 * app-instance, platform-config) provided by CorePlatformIngressModule — the
 * helpers stay in platform-ingress/services (one-way dependency: platform
 * helps → supervisors use).
 */

import { Global, Module } from "@nestjs/common";

import { CoreDockerModule } from "../../docker/docker.module";
import { CorePlatformIngressModule } from "../../platform-ingress/platform-ingress.module";
import { CoreEdgeModule } from "../../edge/edge.module";
import { CoreReachabilityModule } from "../../reachability/core-reachability.module";
import { TraefikSupervisorService } from "./traefik-supervisor.service";
import { ManagedWebSupervisorService } from "./managed-web-supervisor.service";
import { RedisSupervisorService } from "./redis-supervisor.service";
import { SwarmAppWiringSupervisorService } from "./swarm-app-wiring.supervisor.service";
import { EdgeConnectorSupervisorService } from "./edge-connector-supervisor.service";
import { EnvModule } from "../../../../config/env/env.module";

@Global()
@Module({
	imports: [CoreDockerModule, CorePlatformIngressModule, CoreEdgeModule, CoreReachabilityModule, EnvModule],
	providers: [
		TraefikSupervisorService,
		ManagedWebSupervisorService,
		RedisSupervisorService,
		SwarmAppWiringSupervisorService,
		EdgeConnectorSupervisorService,
	],
	exports: [
		TraefikSupervisorService,
		ManagedWebSupervisorService,
		RedisSupervisorService,
		SwarmAppWiringSupervisorService,
		EdgeConnectorSupervisorService,
	],
})
export class SupervisorsPlatformModule {}