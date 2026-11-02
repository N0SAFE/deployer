import { Injectable } from "@nestjs/common";

import { BasePooledEventService } from "@deployer/shared/core/modules/events/base/index";
import { CoreEventStreamPoolService } from "@deployer/shared/core/modules/events/base/index";

import {
    deploymentEventContracts,
    type DeploymentEventContracts,
} from "./deployment-event.contracts";

@Injectable()
export class DeploymentEventService extends BasePooledEventService<DeploymentEventContracts> {
    constructor(streamPool?: CoreEventStreamPoolService) {
        super("deployment", deploymentEventContracts, streamPool);
    }
}
