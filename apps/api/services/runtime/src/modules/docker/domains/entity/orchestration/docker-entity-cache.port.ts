import { Context } from 'effect'

import type { DockerEntityCacheService } from './docker-entity-cache.service'

/** The entity cache as an Effect service: the domain yields it, so a spec substitutes a fake. */
export class DockerEntityCachePort extends Context.Service<
    DockerEntityCachePort,
    Pick<DockerEntityCacheService, 'getOrCompute' | 'invalidate'>
>()('runtime/DockerEntityCachePort') {}
