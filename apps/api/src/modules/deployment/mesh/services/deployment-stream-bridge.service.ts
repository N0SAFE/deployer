import { Injectable } from "@nestjs/common";
import { Observable } from "rxjs";
import type { DeploymentProgressEvent } from "@repo/api-contracts/modules/deployment/stream";
import { MeshStreamRuntimeService } from "@/core/modules/mesh/services/mesh-stream-runtime.service";

@Injectable()
export class DeploymentStreamBridgeService {
    constructor(private readonly meshStreamRuntimeService: MeshStreamRuntimeService) {}

    tryProxyDeploymentStream(input: {
        deploymentId: string;
        replay: boolean;
        replayLimit: number;
        context: unknown;
    }): Observable<DeploymentProgressEvent> | null {
        return this.meshStreamRuntimeService.openInternalBridge<DeploymentProgressEvent>({
            context: input.context,
            resourceKey: `stream:deployment:${input.deploymentId}`,
            localEndpointPath: `/deployments/internal/${input.deploymentId}/stream`,
            metadata: {
                streamType: "deployment",
                streamId: input.deploymentId,
            },
            executeRemote: (client) =>
                client.deployment.streamInternal({
                    params: { id: input.deploymentId },
                    query: {
                        replay: input.replay,
                        replayLimit: input.replayLimit,
                    },
                }),
        });
    }
}
