/**
 * PlatformModule — product-facing platform surface (api-centric deployment).
 *
 * Re-exports the core supervisors (already global via SupervisorsModule) and
 * provides the ORPC controllers + HTML management console.
 */

import { Module } from "@nestjs/common";
import { CorePlatformIngressModule } from "@deployer/shared/core/modules/platform-ingress/platform-ingress.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { PlatformController } from "./controllers/platform.controller";
import { PlatformManagedWebController } from "./controllers/platform-managed-web.controller";
import { PlatformManagedWebService } from "./services/platform-managed-web.service";

@Module({
    // `EnvService` is injected by `PlatformManagedWebService` and the console
    // controllers, so the module providing them must import it: the app's
    // `EnvService` is a SUBCLASS provided by this wrapper, and the package's
    // `@Global` decorator covers only the base class.
    imports: [CorePlatformIngressModule, TraefikCoreModule, ProvidersModule, EnvModule],
    controllers: [
        PlatformController,
        PlatformManagedWebController,
    ],
    providers: [PlatformManagedWebService],
})
export class PlatformModule {}
