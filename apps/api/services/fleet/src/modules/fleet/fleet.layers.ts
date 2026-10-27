import { Layer } from 'effect'

import { FleetRepository } from './repositories/fleet.repository'
import { FleetService } from './services/fleet.service'

/** The fleet feature: the service over its repository, both visible to the runtime. */
export const FleetFeatureLive = FleetService.Live.pipe(
    Layer.provideMerge(FleetRepository.Live)
)
