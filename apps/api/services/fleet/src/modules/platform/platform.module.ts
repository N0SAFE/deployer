/**
 * PlatformModule — product-facing platform surface (api-centric deployment).
 *
 * Re-exports the core supervisors (already global via SupervisorsModule) and
 * provides the ORPC controllers + HTML management console.
 */

import { Module } from "@nestjs/common";
import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { PlatformController } from "./controllers/platform.controller";
import { PlatformConsoleController } from "./controllers/platform-console.controller";
import { PlatformManagedWebController } from "./controllers/platform-managed-web.controller";
import { SetupDoneController } from "./controllers/setup-done.controller";
import { PlatformManagedWebService } from "./services/platform-managed-web.service";

@Module({
    // `EnvService` is injected by `PlatformManagedWebService` and the console
    // controllers, so the module providing them must import it: the app's
    // `EnvService` is a SUBCLASS provided by this wrapper, and the package's
    // `@Global` decorator covers only the base class.
    imports: [CorePlatformIngressModule, TraefikCoreModule, ProvidersModule, EnvModule],
    controllers: [
        PlatformController,
        PlatformConsoleController,
        PlatformManagedWebController,
        // The post-handover landing page for `setup.<host>`. It lives here rather
        // than in the setup module because deciding the destination needs
        // `PlatformManagedWebService`, and one product module importing another's
        // service is the coupling this repo forbids.
        SetupDoneController,
    ],
    providers: [PlatformManagedWebService],
})
export class PlatformModule {}
