import { Layer } from 'effect'

import { DomainLive } from './modules/domain/domain.layers'
import { ProjectLive } from './modules/project/project.layers'
import { ServiceLive } from './modules/service/service.layers'

/**
 * Everything the project service's Effect runtime builds, bottom up: the project module, the service
 * module over it, the domain module over both.
 */
export const AppLive = DomainLive.pipe(
    Layer.provideMerge(ServiceLive.pipe(Layer.provideMerge(ProjectLive)))
)
