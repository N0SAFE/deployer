/**
 * PlatformModule — product-facing platform surface (api-centric deployment).
 *
 * Re-exports the core supervisors (already global via SupervisorsModule) and
 * provides the ORPC controllers + HTML management console.
 */

import { createModuleContext } from "@deployer/nest-effect";
import { SupervisorOrchestratorService } from "@deployer/nest-supervisor-core/supervisor-orchestrator.service";
import { HostnameService } from "@deployer/shared/core/modules/platform-ingress/services/hostname.service";
import { PlatformConfigService } from "@deployer/shared/core/modules/platform-ingress/services/platform-config.service";
import { TraefikConfigRefresher } from "@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service";
import { CloudflareAppService } from "@/modules/providers/dns/cloudflare/services/cloudflare-app.service";
import { CloudflareTunnelService } from "@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service";
import { CorePlatformIngressModule } from "@deployer/shared/core/modules/platform-ingress/platform-ingress.module";
import { TraefikCoreModule } from "@deployer/shared/core/modules/traefik/traefik.module";
import { ProvidersModule } from "@/modules/providers/providers.module";
import { EnvModule, EnvService } from "@deployer/shared/config/env/env.module";
import { PlatformController } from "./controllers/platform.controller";
import { PlatformManagedWebController } from "./controllers/platform-managed-web.controller";
import { PlatformManagedWebService } from "./services/platform-managed-web.service";

import {
    CloudflareAppsPort,
    PlatformConfigPort,
    PlatformEnvPort,
    PlatformHostnamesPort,
    PlatformRefresherPort,
    SupervisorsPort,
    WebTunnelPort,
} from "./platform.ports";

/**
 * `PlatformManagedWebService` is a Layer (see `platform.layers.ts`) built by the app's Effect
 * runtime over ports for the platform services, which stay Nest providers. `PlatformController`
 * (anonymous registration behind a rate limit and Better Auth, heartbeat, instance admin) keeps
 * its Promise-based handlers: its middlewares take the app-instance store as a constructor argument.
 */
export class PlatformModule extends createModuleContext(
    {
        // `EnvService` is aliased by the env port and used by the console controllers, so the module
        // providing them must import it: the app's `EnvService` is a SUBCLASS provided by this
        // wrapper, and the package's `@Global` decorator covers only the base class.
        imports: [CorePlatformIngressModule, TraefikCoreModule, ProvidersModule, EnvModule],
        controllers: [PlatformController, PlatformManagedWebController],
        providers: [
            { provide: PlatformEnvPort, useExisting: EnvService },
            { provide: PlatformHostnamesPort, useExisting: HostnameService },
            { provide: PlatformConfigPort, useExisting: PlatformConfigService },
            { provide: SupervisorsPort, useExisting: SupervisorOrchestratorService },
            { provide: WebTunnelPort, useExisting: CloudflareTunnelService },
            { provide: CloudflareAppsPort, useExisting: CloudflareAppService },
            { provide: PlatformRefresherPort, useExisting: TraefikConfigRefresher },
        ],
    },
    PlatformManagedWebService,
) {}
