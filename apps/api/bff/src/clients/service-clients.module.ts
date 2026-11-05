import { createGlobalModule } from '@deployer/nest-effect'

import { FleetClient } from './fleet/fleet.client'
import { AnalyticsClient } from './identity/analytics.client'
import { IdentityClient } from './identity/identity.client'
import { ProjectClient } from './project/project.client'
import { RuntimeClient } from './runtime/runtime.client'
import { ServiceClientRegistry } from './service-registry'

/** A client is a plain class over the registry, so the module builds it; no decorator, no constructor metadata. */
function clientOf(Client: new (registry: ServiceClientRegistry) => object) {
    return {
        provide: Client,
        useFactory: (registry: ServiceClientRegistry) => new Client(registry),
        inject: [ServiceClientRegistry],
    }
}

/**
 * Every typed service client, provided once for the whole application.
 *
 * ── WHY `@Global()` ─────────────────────────────────────────────────────────
 * A module that composes a screen needs whichever clients that screen touches, and
 * importing this module in each of them is a line that adds nothing and is easy to
 * forget. It still has to be imported ONCE, by the root module — which is also where
 * the registry that backs them is configured.
 *
 * ── WHY THE CLIENTS ARE DECLARED HERE AND NOT IN EACH MODULE ────────────────
 * A client is stateless: it holds a contract and a bound transport, nothing about the
 * feature using it. Declaring one per consumer would create a second instance for the
 * same service, and two instances of a client is two places a future change (a cache,
 * a retry policy) has to be applied. One declaration, injected everywhere.
 */
export const ServiceClientsModule = createGlobalModule({
    providers: [
        clientOf(IdentityClient),
        clientOf(AnalyticsClient),
        clientOf(ProjectClient),
        clientOf(RuntimeClient),
        clientOf(FleetClient),
    ],
    exports: [
        IdentityClient,
        AnalyticsClient,
        ProjectClient,
        RuntimeClient,
        FleetClient,
    ],
})
