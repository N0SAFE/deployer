import type { SupervisorOrchestratorService } from "@deployer/nest-effect/supervision";
import type { EnvService } from '@deployer/shared/config/env/env.module'
import type { HostnameService } from '@deployer/shared/core/modules/platform-ingress/services/hostname.service'
import type { PlatformConfigService } from '@deployer/shared/core/modules/platform-ingress/services/platform-config.service'
import type { TraefikConfigRefresher } from '@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service'
import { Context } from 'effect'

import type { CloudflareAppService } from '@/modules/providers/dns/cloudflare/services/cloudflare-app.service'
import type { CloudflareTunnelService } from '@/modules/providers/dns/cloudflare/services/cloudflare-tunnel.service'

/**
 * What the managed-web service depends on, as Effect ports over Promise-based Nest providers
 * (registered in the module with `useExisting`).
 */
export class PlatformEnvPort extends Context.Service<
    PlatformEnvPort,
    EnvService
>()('fleet/PlatformEnvPort') {}
export class PlatformHostnamesPort extends Context.Service<
    PlatformHostnamesPort,
    HostnameService
>()('fleet/PlatformHostnamesPort') {}
export class PlatformConfigPort extends Context.Service<
    PlatformConfigPort,
    PlatformConfigService
>()('fleet/PlatformConfigPort') {}
export class SupervisorsPort extends Context.Service<
    SupervisorsPort,
    SupervisorOrchestratorService
>()('fleet/SupervisorsPort') {}
export class WebTunnelPort extends Context.Service<
    WebTunnelPort,
    CloudflareTunnelService
>()('fleet/WebTunnelPort') {}
export class CloudflareAppsPort extends Context.Service<
    CloudflareAppsPort,
    CloudflareAppService
>()('fleet/CloudflareAppsPort') {}
export class PlatformRefresherPort extends Context.Service<
    PlatformRefresherPort,
    TraefikConfigRefresher
>()('fleet/PlatformRefresherPort') {}
