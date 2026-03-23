import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/core/modules/events/base-event.service";
import {
    deploymentQueueEventContracts,
    type DeploymentQueueEventContracts,
} from "./deployment-queue-event.contracts";

@Injectable()
export class DeploymentQueueEventService extends BaseEventService<DeploymentQueueEventContracts> {
    constructor() {
        super("deployment-queue", deploymentQueueEventContracts);
    }
}
