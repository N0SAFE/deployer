import { Layer } from 'effect'

import { ProjectLive } from './modules/project/project.layers'
import { ServiceLive } from './modules/service/service.layers'

/** Everything the project service's Effect runtime builds: the service module over the project module. */
export const AppLive = ServiceLive.pipe(Layer.provideMerge(ProjectLive))
