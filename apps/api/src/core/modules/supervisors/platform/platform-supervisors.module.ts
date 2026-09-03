/**
 * SupervisorsPlatformModule — registers the PLATFORM supervisors.
 *
 * All supervisor implementations live under `supervisors/` (folder layout):
 *   - platform/traefik-supervisor.service.ts       → Traefik ingress
 *   - platform/managed-web-supervisor.service.ts   → managed web app
 *   - platform/direct-port-proxy.supervisor.service.ts → FAILOVER ingress
 *   - platform/redis-supervisor.service.ts         → Redis (API-supervised)
 *   (starts only while Traefik is failed, closes itself on recovery)
 *
 * These consume the platform HELPER services (hostname, route-config,
 * app-instance, platform-config) provided by CorePlatformIngressModule — the
 * helpers stay in platform-ingress/services (one-way dependency: platform
 * helps → supervisors use).
 */

import { Global, Module } from "@nestjs/common";

import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { TraefikSupervisorService } from "./traefik-supervisor.service";
import { ManagedWebSupervisorService } from "./managed-web-supervisor.service";
import { DirectPortProxySupervisorService } from "./direct-port-proxy.supervisor.service";
import { RedisSupervisorService } from "./redis-supervisor.service";
import { WireGuardSupervisorService } from "./wireguard-supervisor.service";

@Global()
@Module({
	imports: [CoreDockerModule, CorePlatformIngressModule],
	providers: [
		TraefikSupervisorService,
		ManagedWebSupervisorService,
		DirectPortProxySupervisorService,
		RedisSupervisorService,
		WireGuardSupervisorService,
	],
	exports: [
		TraefikSupervisorService,
		ManagedWebSupervisorService,
		DirectPortProxySupervisorService,
		RedisSupervisorService,
		WireGuardSupervisorService,
	],
})
export class SupervisorsPlatformModule {}