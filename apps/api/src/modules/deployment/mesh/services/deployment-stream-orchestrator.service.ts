import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import type { DeploymentProgressEvent } from "@repo/api-contracts/modules/deployment/stream";
import { DeploymentService } from "../../services/deployment.service";
import { DeploymentStreamBridgeService } from "./deployment-stream-bridge.service";

export interface OpenDeploymentStreamInput {
    deploymentId: string;
    replay: boolean;
    replayLimit: number;
    context: unknown;
}

@Injectable()
export class DeploymentStreamOrchestratorService {
    constructor(
        private readonly deploymentService: DeploymentService,
        private readonly deploymentStreamBridgeService: DeploymentStreamBridgeService,
    ) {}

    openDeploymentStream(input: OpenDeploymentStreamInput): Observable<DeploymentProgressEvent> {
        const proxied = this.deploymentStreamBridgeService.tryProxyDeploymentStream({
            deploymentId: input.deploymentId,
            replay: input.replay,
            replayLimit: input.replayLimit,
            context: input.context,
        });

        if (proxied) {
            return proxied;
        }

        return this.deploymentService.streamDeploymentEvents({
            deploymentId: input.deploymentId,
            replay: input.replay,
            replayLimit: input.replayLimit,
        });
    }
}