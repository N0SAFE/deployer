import { Effect } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { provideTo, run } from '../../../runners/testing'
import { DeploymentStreamsPort } from '../../deployment.ports'

import { DeploymentStreamOrchestratorService } from './deployment-stream-orchestrator.service'

describe('DeploymentStreamOrchestratorService', () => {
    it("opens the deployment's stream from this node, with the replay the caller asked for", async () => {
        const stream = { subscribe: vi.fn() }
        const streamDeploymentEvents = vi.fn().mockReturnValue(stream)

        const service = provideTo(
            new DeploymentStreamOrchestratorService.live(),
            (effect) =>
                effect.pipe(
                    Effect.provideService(DeploymentStreamsPort, {
                        streamDeploymentEvents,
                    } as never)
                )
        )

        const result = await run(
            service.openDeploymentStream({
                deploymentId: 'dep-1',
                replay: true,
                replayLimit: 25,
            })
        )

        expect(result).toBe(stream)
        expect(streamDeploymentEvents).toHaveBeenCalledWith({
            deploymentId: 'dep-1',
            replay: true,
            replayLimit: 25,
        })
    })
})
