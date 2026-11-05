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

import type { Context } from "effect";

import { createGlobalModule } from "@deployer/nest-effect";

import { EnvModule, EnvService } from "../../../config/env/env.module";
import { DatabasePort } from "../database/storage";
import { CoreDockerModule } from "../docker/docker.module";
import { ClusterSettings, type ClusterSettingsShape } from "../mesh-node/cluster-settings";

import { AppInstanceService, makeAppInstanceService } from "./services/app-instance.service";
import { EnvHostnameService, HostnameService } from "./services/hostname.service";
import { IngressLanesService, makeIngressLanesService } from "./services/ingress-lanes.service";
import { makePlatformConfigService, PlatformConfigService, type PlatformConfigServiceShape } from "./services/platform-config.service";
import { makePlatformRoutesSource, PlatformRoutesSource } from "./services/platform-routes-source.service";
import { makePlatformWebTargetService, PlatformWebTargetService } from "./services/platform-web-target.service";

export const CorePlatformIngressModule = createGlobalModule({
	imports: [CoreDockerModule, EnvModule],
	providers: [
		{ provide: HostnameService, useFactory: (env: EnvService) => new EnvHostnameService(env), inject: [EnvService] },
		{
			provide: IngressLanesService,
			useFactory: (settings: ClusterSettingsShape, env: EnvService) =>
				makeIngressLanesService({ settings, entryPort: () => env.get("DEPLOYER_TRAEFIK_HTTP_PORT") }),
			inject: [ClusterSettings, EnvService],
		},
		{
			provide: AppInstanceService,
			useFactory: (database: Context.Service.Shape<typeof DatabasePort>) => makeAppInstanceService(database),
			inject: [DatabasePort],
		},
		{
			provide: PlatformConfigService,
			useFactory: (database: Context.Service.Shape<typeof DatabasePort>, env: EnvService) =>
				makePlatformConfigService({ database, managedWebSeed: () => env.get("MANAGED_WEB_APP_ENABLED") }),
			inject: [DatabasePort, EnvService],
		},
		{
			provide: PlatformWebTargetService,
			useFactory: (platformConfig: PlatformConfigServiceShape, env: EnvService) =>
				makePlatformWebTargetService({
					platformConfig,
					env: {
						webTarget: () => env.get("DEPLOYER_WEB_TARGET"),
						managedWebExternal: () => env.get("MANAGED_WEB_APP_EXTERNAL"),
						prefix: () => env.get("DEPLOYER_PREFIX"),
					},
				}),
			inject: [PlatformConfigService, EnvService],
		},
		{
			provide: PlatformRoutesSource,
			useFactory: (database: Context.Service.Shape<typeof DatabasePort>) => makePlatformRoutesSource(database),
			inject: [DatabasePort],
		},
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
