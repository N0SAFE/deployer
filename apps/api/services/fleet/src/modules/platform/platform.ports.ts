import { Context } from 'effect'

import type { EnvService } from '@deployer/shared/config/env/env.module'
import type { HostnameService } from '@deployer/shared/core/modules/platform-ingress/services/hostname.service'
import type { PlatformConfigServiceShape } from '@deployer/shared/core/modules/platform-ingress/services/platform-config.service'
import type { TraefikConfigRefresherShape } from '@deployer/shared/core/modules/traefik/services/traefik-config-refresher.service'
import type { SupervisorOrchestratorShape } from '@deployer/supervision'

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
    PlatformConfigServiceShape
>()('fleet/PlatformConfigPort') {}
export class SupervisorsPort extends Context.Service<
    SupervisorsPort,
    SupervisorOrchestratorShape
>()('fleet/SupervisorsPort') {}
export class PlatformRefresherPort extends Context.Service<
    PlatformRefresherPort,
    TraefikConfigRefresherShape
>()('fleet/PlatformRefresherPort') {}
