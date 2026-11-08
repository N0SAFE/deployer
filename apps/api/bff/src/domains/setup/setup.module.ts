import { createModuleContext } from '@deployer/nest-effect'

import { EnvModule, EnvService } from '@/config/env/env.module'
import { HostnameService } from '@/core/modules/platform-ingress/services/hostname.service'
import { PlatformConfigService } from '@/core/modules/platform-ingress/services/platform-config.service'
import { CoreReachabilityModule } from '@/core/modules/reachability/core-reachability.module'
import { CoreInitializationModule } from '@/core/modules/setup/initialization.module'

import { SetupController } from './controllers/setup.controller'
import { PostSetupDestinationService } from './services/post-setup-destination.service'
import {
    nodeTransport,
    PostSetupVerificationService,
} from './services/post-setup-verification.service'
import {
    SetupEnvPort,
    SetupHostnamePort,
    SetupPlatformConfigPort,
    SetupTransportPort,
} from './setup.ports'

/**
 * Public Setup Module
 *
 * Wires the HTTP/ORPC surface for the setup wizard:
 *   - `SetupController` — plain NestJS REST controller exposing setup
 *     endpoints (state, probes, trigger, SSE stream) on the main
 *     Express server BEFORE ORPC is loaded.
 *   - `CoreInitializationModule` (the underlying `InitializationService`
 *     and the local/remote bootstrap services that `SetupController`
 *     delegates to).
 *   - `CoreReachabilityModule` (the `ReachabilityService` that
 *     `SetupController.probeMesh` delegates to).
 *
 * IMPORTANT: This module uses plain NestJS decorators (@Get, @Post, @Sse)
 * instead of ORPC's @Implement. This is intentional — ORPC is lazy-loaded
 * after AuthModule initializes, but the setup wizard must be available
 * upfront so the web UI can configure the database before AuthModule
 * and ORPCModule ever load.
 */
export class SetupDomainModule extends createModuleContext({
    // `EnvModule` IS IMPORTED EXPLICITLY: `PostSetupDestinationService` injects
    // `EnvService`, and `EnvModule` is NOT global — relying on it being
    // registered elsewhere threw `UnknownDependenciesException` at boot:
    //
    //   Nest can't resolve dependencies of the PostSetupDestinationService (?,
    //   HostnameService, PlatformConfigService) — the argument EnvService at
    //   index [0] is available in the SetupModule module?
    //
    // (`HostnameService`/`PlatformConfigService` resolved fine because
    // `CorePlatformIngressModule` IS `@Global()`.)
    imports: [CoreInitializationModule, CoreReachabilityModule, EnvModule],
    controllers: [SetupController],
    // Each port is bound to the Promise provider that owns it (`HostnameService`/`PlatformConfigService` come from the
    // @Global `CorePlatformIngressModule`); the two services are stateless constants over those ports.
    providers: [
        { provide: SetupEnvPort, useExisting: EnvService },
        { provide: SetupHostnamePort, useExisting: HostnameService },
        {
            provide: SetupPlatformConfigPort,
            useExisting: PlatformConfigService,
        },
        { provide: SetupTransportPort, useValue: nodeTransport },
        {
            provide: PostSetupDestinationService,
            useClass: PostSetupDestinationService.live,
        },
        {
            provide: PostSetupVerificationService,
            useClass: PostSetupVerificationService.live,
        },
    ],
    exports: [
        CoreInitializationModule,
        PostSetupDestinationService,
        PostSetupVerificationService,
    ],
}) {}
