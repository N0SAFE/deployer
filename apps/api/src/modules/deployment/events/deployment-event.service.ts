import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@/core/modules/events/services/base-pooled-event.service";
import {
    deploymentEventContracts,
    type DeploymentEventContracts,
} from "./deployment-event.contracts";
import { CoreEventStreamPoolService } from "@/core/modules/events/services/core-event-stream-pool.service";

@Injectable()
export class DeploymentEventService extends BasePooledEventService<DeploymentEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("deployment", deploymentEventContracts, streamPool);
    }
}
