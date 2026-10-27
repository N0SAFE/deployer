import { Layer } from 'effect'

import { UserRepository } from './repositories/user.repository'
import { UserService } from './services/user.service'

/** The user feature, assembled: the service over its repository, both visible to the runtime. */
export const UserLive = UserService.Live.pipe(
    Layer.provideMerge(UserRepository.Live)
)
