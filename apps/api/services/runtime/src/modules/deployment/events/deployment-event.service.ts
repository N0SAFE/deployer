import { BasePooledEventService } from '@deployer/shared/core/modules/events/base/index'
import type { CoreEventStreamPoolServiceShape } from '@deployer/shared/core/modules/events/base/index'

import {
    deploymentEventContracts,
    type DeploymentEventContracts,
} from './deployment-event.contracts'

/** The typed event bus; the deployment module builds it over the shared stream pool. */
export class DeploymentEventService extends BasePooledEventService<DeploymentEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolServiceShape) {
        super('deployment', deploymentEventContracts, streamPool)
    }
}
