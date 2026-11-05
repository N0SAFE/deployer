import { Context, Effect } from 'effect'

import { serviceOver } from '@deployer/effect-core'
import type { DeploymentProgressEvent } from '@deployer/runtime-contracts/modules/deployment/stream'

import { DeploymentStreamsPort } from '../../deployment.ports'

import type { Observable } from 'rxjs'

export type OpenDeploymentStreamInput = {
    deploymentId: string
    replay: boolean
    replayLimit: number
}

export type DeploymentStreamOrchestratorServiceShape = {
    readonly openDeploymentStream: (
        input: OpenDeploymentStreamInput
    ) => Effect.Effect<
        Observable<DeploymentProgressEvent>,
        never,
        DeploymentStreamsPort
    >
}

/**
 * Opens the progress stream of a deployment.
 *
 * It is served from this node: a deployment's events are recorded and published through the shared database and event
 * bus, so every node can replay and follow any deployment without asking the node that executes it. The cross-node proxy
 * this class used to try first answered "not remote" for every deployment, so removing it changes nothing a caller can see.
 */
export class DeploymentStreamOrchestratorService extends Context.Service<
    DeploymentStreamOrchestratorService,
    DeploymentStreamOrchestratorServiceShape
>()('runtime/DeploymentStreamOrchestratorService') {
    static readonly live = serviceOver(
        Effect.all({ deployments: DeploymentStreamsPort }),
        ({ deployments }): DeploymentStreamOrchestratorServiceShape => ({
            openDeploymentStream: (input) =>
                Effect.sync(() =>
                    deployments.streamDeploymentEvents({
                        deploymentId: input.deploymentId,
                        replay: input.replay,
                        replayLimit: input.replayLimit,
                    })
                ),
        })
    )
}
