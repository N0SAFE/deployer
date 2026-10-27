import { Injectable } from "@nestjs/common";
import { BasePooledEventService } from "@deployer/nest-events";
import {
    deploymentEventContracts,
    type DeploymentEventContracts,
} from "./deployment-event.contracts";
import { CoreEventStreamPoolService } from "@deployer/nest-events";

@Injectable()
export class DeploymentEventService extends BasePooledEventService<DeploymentEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("deployment", deploymentEventContracts, streamPool);
    }
}
