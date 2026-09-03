import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@repo/nest-events";
import {
    deploymentQueueEventContracts,
    type DeploymentQueueEventContracts,
} from "./deployment-queue-event.contracts";
import { CoreEventStreamPoolService } from "@repo/nest-events";

@Injectable()
export class DeploymentQueueEventService extends BasePooledEventService<DeploymentQueueEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("deployment-queue", deploymentQueueEventContracts, streamPool);
    }
}
