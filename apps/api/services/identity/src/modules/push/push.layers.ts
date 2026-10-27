import { Layer } from 'effect'

import { PushRepository } from './repositories/push.repository'
import { PushService } from './services/push.service'

/** The push feature, assembled: the service over its repository, both visible to the runtime. */
export const PushLive = PushService.Live.pipe(
    Layer.provideMerge(PushRepository.Live)
)
