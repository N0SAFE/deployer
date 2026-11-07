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

import { createGlobalModule } from '@deployer/nest-effect'

import { EnvModule, EnvService } from '../../../config/env/env.module'
import { DatabasePort } from '../database/storage'
import { CoreDockerModule } from '../docker/docker.module'

import {
    AppInstanceService,
    makeAppInstanceService,
} from './services/app-instance.service'
import {
    EnvHostnameService,
    HostnameService,
} from './services/hostname.service'
import { IngressLanesService } from './services/ingress-lanes.service'
import { PlatformConfigService } from './services/platform-config.service'
import {
    makePlatformRoutesSource,
    PlatformRoutesSource,
} from './services/platform-routes-source.service'
import { PlatformWebTargetService } from './services/platform-web-target.service'

import type { Context } from 'effect'

export const CorePlatformIngressModule = createGlobalModule({
    imports: [CoreDockerModule, EnvModule],
    providers: [
        {
            provide: HostnameService,
            useFactory: (env: EnvService) => new EnvHostnameService(env),
            inject: [EnvService],
        },
        {
            provide: IngressLanesService,
            useFactory: (env: EnvService) =>
                new IngressLanesService.live(
                    env.get('DEPLOYER_TRAEFIK_HTTP_PORT')
                ),
            inject: [EnvService],
        },
        {
            provide: AppInstanceService,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makeAppInstanceService(database),
            inject: [DatabasePort],
        },
        {
            provide: PlatformConfigService,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>,
                env: EnvService
            ) =>
                new PlatformConfigService.live(database, () =>
                    env.get('MANAGED_WEB_APP_ENABLED')
                ),
            inject: [DatabasePort, EnvService],
        },
        {
            provide: PlatformWebTargetService,
            useFactory: (env: EnvService) =>
                new PlatformWebTargetService.live({
                    webTarget: env.get('DEPLOYER_WEB_TARGET'),
                    managedWebExternal: env.get('MANAGED_WEB_APP_EXTERNAL'),
                    prefix: env.get('DEPLOYER_PREFIX'),
                }),
            inject: [EnvService],
        },
        {
            provide: PlatformRoutesSource,
            useFactory: (
                database: Context.Service.Shape<typeof DatabasePort>
            ) => makePlatformRoutesSource(database),
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
})
