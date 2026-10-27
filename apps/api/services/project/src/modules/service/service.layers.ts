import { Layer } from 'effect'

import { ServiceStore } from './repositories/service.repository'
import { PreviewTopologyService } from './services/preview-topology.service'
import { ServiceEventServiceLayer } from './services/service-event.service'
import { ServiceNetworkService } from './services/service-network.service'
import { ServiceService } from './services/service.service'

/** The use cases, built over the store and the service event bus. */
const ServicesLive = Layer.mergeAll(
    ServiceService.Live,
    PreviewTopologyService.Live,
    ServiceNetworkService.Live
)

/**
 * The service module, assembled. It reads `ProjectStore` (a service lives inside a project), so it
 * must be built over `ProjectLive`: see `app.layers.ts`.
 */
export const ServiceLive = ServicesLive.pipe(
    Layer.provideMerge(
        Layer.mergeAll(ServiceStore.Live, ServiceEventServiceLayer)
    )
)
