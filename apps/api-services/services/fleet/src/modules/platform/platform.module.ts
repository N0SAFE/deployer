/**
 * PlatformModule — the platform surface fleet owns.
 *
 * The ORPC procedures over the managed web app (state, toggle, restart, origin,
 * tunnel) and the app-instance registration/heartbeat surface. The HTML management
 * console is NOT here: it renders React views, which belongs to the BFF — a service
 * serves no UI. Those pages read this state over the contract instead.
 */

import { Module } from "@nestjs/common";
import { CorePlatformIngressModule } from "@/core/modules/platform-ingress/platform-ingress.module";
import { TraefikCoreModule } from "@/core/modules/traefik/traefik.module";
import { ProvidersDomainModule } from "../providers/providers.module";
import { EnvModule, EnvService } from "@/config/env/env.module";
import { PlatformController } from "./controllers/platform.controller";
import { PlatformManagedWebController } from "./controllers/platform-managed-web.controller";
import { PlatformManagedWebService } from "./services/platform-managed-web.service";

@Module({
    // `EnvService` is injected by `PlatformManagedWebService`, so the module providing it
    // must import it: the app's `EnvService` is a SUBCLASS provided by this wrapper, and the
    // package's `@Global` decorator covers only the base class.
    imports: [CorePlatformIngressModule, TraefikCoreModule, ProvidersDomainModule, EnvModule],
    controllers: [
        PlatformController,
        PlatformManagedWebController,
    ],
    providers: [PlatformManagedWebService],
})
export class PlatformDomainModule {}
