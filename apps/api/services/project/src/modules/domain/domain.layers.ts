import { Layer } from 'effect'

import { DomainProjectService } from './services/domain-project.service'
import { DomainServiceService } from './services/domain-service.service'

/** The domain-assignment use cases; they read the stores of the modules below them (see `app.layers.ts`). */
export const DomainLive = Layer.mergeAll(
    DomainProjectService.Live,
    DomainServiceService.Live
)
