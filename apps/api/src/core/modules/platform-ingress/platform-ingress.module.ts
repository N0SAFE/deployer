/**
 * PlatformIngressModule — API-owned platform infrastructure helper services.
 *
 * Provides the platform helper services (hostname grammar, routing config,
 * app-instance identity, platform settings). The SUPERVISORS that consume
 * them (Traefik ingress, managed web) live in the supervisors module — this
 * module deliberately imports nothing from `supervisors/` (one-way dependency
 * keeps the helpers reusable and the supervisors the sole consumers).
 *
 * `EnvModule` IS IMPORTED EXPLICITLY. `EnvHostnameService` (bound to
 * `HostnameService` below) injects `EnvService`, so it must be resolvable from
 * THIS module's scope. Relying on `EnvModule` being registered globally
 * elsewhere means the module cannot be assembled on its own — the hidden
 * coupling the `AppModule` graph check surfaces.
 */

import { Global, Module } from "@nestjs/common";
import { CoreDockerModule } from "@/core/modules/docker/docker.module";
import { EnvModule } from "@/config/env/env.module";
import { EnvHostnameService, HostnameService } from "./services/hostname.service";
import { PlatformRouteConfigService } from "./services/platform-route-config.service";
import { PlatformIngressSettingsService } from "./services/platform-ingress-settings.service";
import { LocalIngressForwarderService } from "./services/local-ingress-forwarder.service";
import { AppInstanceService } from "./services/app-instance.service";
import { PlatformConfigService } from "./services/platform-config.service";
import { PlatformWebTargetService } from "./services/platform-web-target.service";
import { PlatformRoutesSource } from "./services/platform-routes-source.service";

@Global()
@Module({
	imports: [CoreDockerModule, EnvModule],
	providers: [
		{ provide: HostnameService, useClass: EnvHostnameService },
		PlatformRouteConfigService,
		PlatformIngressSettingsService,
		LocalIngressForwarderService,
		AppInstanceService,
		PlatformConfigService,
		PlatformWebTargetService,
		PlatformRoutesSource,
	],
	exports: [
		HostnameService,
		PlatformRouteConfigService,
		PlatformIngressSettingsService,
		LocalIngressForwarderService,
		AppInstanceService,
		PlatformConfigService,
		PlatformWebTargetService,
		PlatformRoutesSource,
	],
})
export class CorePlatformIngressModule {}
