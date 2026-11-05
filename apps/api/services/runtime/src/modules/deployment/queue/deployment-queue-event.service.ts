import { BasePooledEventService } from '@deployer/shared/core/modules/events/base/index'
import type { CoreEventStreamPoolServiceShape } from '@deployer/shared/core/modules/events/base/index'

import {
    deploymentQueueEventContracts,
    type DeploymentQueueEventContracts,
} from './deployment-queue-event.contracts'

/** The typed event bus; the deployment module builds it over the shared stream pool. */
export class DeploymentQueueEventService extends BasePooledEventService<DeploymentQueueEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolServiceShape) {
        super('deployment-queue', deploymentQueueEventContracts, streamPool)
    }
}
