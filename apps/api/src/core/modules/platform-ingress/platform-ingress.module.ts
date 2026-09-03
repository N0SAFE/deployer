/**
 * PlatformIngressModule — API-owned platform infrastructure helper services.
 *
 * Provides the platform helper services (hostname grammar, routing config,
 * app-instance identity, platform settings). The SUPERVISORS that consume
 * them (Traefik ingress, managed web) live in the supervisors module — this
 * module deliberately imports nothing from `supervisors/` (one-way dependency
 * keeps the helpers reusable and the supervisors the sole consumers).
 */

import { Global, Module } from "@nestjs/common";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { EnvHostnameService, HostnameService } from "./services/hostname.service";
import { PlatformRouteConfigService } from "./services/platform-route-config.service";
import { PlatformIngressSettingsService } from "./services/platform-ingress-settings.service";
import { AppInstanceService } from "./services/app-instance.service";
import { PlatformConfigService } from "./services/platform-config.service";
import { PlatformWebTargetService } from "./services/platform-web-target.service";
import { PlatformRoutesSource } from "./services/platform-routes-source.service";

@Global()
@Module({
	imports: [CoreDockerModule],
	providers: [
		{ provide: HostnameService, useClass: EnvHostnameService },
		PlatformRouteConfigService,
		PlatformIngressSettingsService,
		AppInstanceService,
		PlatformConfigService,
		PlatformWebTargetService,
		PlatformRoutesSource,
	],
	exports: [
		HostnameService,
		PlatformRouteConfigService,
		PlatformIngressSettingsService,
		AppInstanceService,
		PlatformConfigService,
		PlatformWebTargetService,
		PlatformRoutesSource,
	],
})
export class CorePlatformIngressModule {}
