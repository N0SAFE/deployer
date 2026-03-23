import { Injectable } from "@nestjs/common";
import { BaseEventService } from "@/core/modules/events/base-event.service";
import {
    deploymentEventContracts,
    type DeploymentEventContracts,
} from "./deployment-event.contracts";

@Injectable()
export class DeploymentEventService extends BaseEventService<DeploymentEventContracts> {
    constructor() {
        super("deployment", deploymentEventContracts);
    }
}
