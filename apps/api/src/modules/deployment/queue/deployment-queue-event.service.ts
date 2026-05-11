import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import {
    deploymentQueueEventContracts,
    type DeploymentQueueEventContracts,
} from "./deployment-queue-event.contracts";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";

@Injectable()
export class DeploymentQueueEventService extends BasePooledEventService<DeploymentQueueEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("deployment-queue", deploymentQueueEventContracts, streamPool);
    }
}
