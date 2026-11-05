import { Context } from 'effect'

import type { DomainRoutingServiceShape } from '@deployer/shared/core/modules/domain/services/domain-routing.service'

/** Effect view of domain routing: what the preview lifecycle reads and writes. */
export type DomainRoutingShape = Pick<
    DomainRoutingServiceShape,
    'resolveServiceUrls' | 'addPreviewRoute' | 'removePreviewRoute'
>

export class DomainRouting extends Context.Service<
    DomainRouting,
    DomainRoutingShape
>()('fleet/DomainRouting') {}
