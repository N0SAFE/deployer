/**
 * PlatformIngressModule — API-owned platform infrastructure helper services.
 *
 * Provides the platform helper services (hostname grammar, ingress lanes,
 * app-instance identity, route sources). The SUPERVISORS that consume
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

import { createGlobalModule } from "@deployer/nest-effect";

import { EnvModule } from "../../../config/env/env.module";
import { CoreDockerModule } from "../docker/docker.module";

import { AppInstanceService } from "./services/app-instance.service";
import { EnvHostnameService, HostnameService } from "./services/hostname.service";
import { IngressLanesService } from "./services/ingress-lanes.service";
import { PlatformConfigService } from "./services/platform-config.service";
import { PlatformRoutesSource } from "./services/platform-routes-source.service";
import { PlatformWebTargetService } from "./services/platform-web-target.service";

export const CorePlatformIngressModule = createGlobalModule({
	imports: [CoreDockerModule, EnvModule],
	providers: [
		{ provide: HostnameService, useClass: EnvHostnameService },
		IngressLanesService,
		AppInstanceService,
		PlatformConfigService,
		PlatformWebTargetService,
		PlatformRoutesSource,
	],
	exports: [
		HostnameService,
		IngressLanesService,
		AppInstanceService,
		PlatformConfigService,
		PlatformWebTargetService,
		PlatformRoutesSource,
	],
});
