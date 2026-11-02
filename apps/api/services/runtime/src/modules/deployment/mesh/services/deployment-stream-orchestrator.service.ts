import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";

import type { DeploymentProgressEvent } from "@deployer/runtime-contracts/modules/deployment/stream";

import { DeploymentService } from "../../services/deployment.service";

export type OpenDeploymentStreamInput = {
    deploymentId: string;
    replay: boolean;
    replayLimit: number;
}

/**
 * Opens the progress stream of a deployment.
 *
 * It is served from this node: a deployment's events are recorded and published through the shared database and event
 * bus, so every node can replay and follow any deployment without asking the node that executes it. The cross-node proxy
 * this class used to try first answered "not remote" for every deployment, so removing it changes nothing a caller can see.
 */
@Injectable()
export class DeploymentStreamOrchestratorService {
    constructor(private readonly deploymentService: DeploymentService) {}

    openDeploymentStream(input: OpenDeploymentStreamInput): Observable<DeploymentProgressEvent> {
        return this.deploymentService.streamDeploymentEvents({
            deploymentId: input.deploymentId,
            replay: input.replay,
            replayLimit: input.replayLimit,
        });
    }
}
