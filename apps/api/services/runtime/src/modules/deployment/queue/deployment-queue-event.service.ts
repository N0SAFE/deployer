import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@deployer/shared/core/modules/events/base/index";
import {
    deploymentQueueEventContracts,
    type DeploymentQueueEventContracts,
} from "./deployment-queue-event.contracts";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";

@Injectable()
export class DeploymentQueueEventService extends BasePooledEventService<DeploymentQueueEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("deployment-queue", deploymentQueueEventContracts, streamPool);
    }
}
