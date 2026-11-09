import { Cause, Effect, Layer } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import type { NodeDoorClient } from '@deployer/mesh-client'
import { NodeConfigRepository } from '@deployer/node-state'
import type { NodeConfigRepositoryShape } from '@deployer/node-state'
import {
    SwarmBootstrap,
    SwarmCluster,
    type SwarmBootstrapShape,
    type SwarmClusterShape,
} from '@deployer/swarm'

import { RemoteInitializationService } from './remote-initialization.service'
import { SetupStepTracker } from './setup-step-tracker'

import { ApiEnvironment } from '../../../../config/env/env.module'
import type { EnvService } from '../../../../config/env/env.module'
import type { ClientContext, ClientLink } from '@orpc/client'

const noop = () => undefined

/** The `agent_join` step is the first thing the flow does, so a redeem that rejects is enough to observe the token. */
function serviceWith(
    joinWithToken: (token: string) => Promise<unknown>,
    agent?: ClientLink<ClientContext>
) {
    const service = new RemoteInitializationService.live({
        host: {
            run: (effect) => Effect.runPromise(effect as never),
            // Mirrors `runPromiseUnwrapped`: reject with the ORIGINAL failure, not a wrapper, so a
            // spec can assert on the typed error the step produced.
            runUnwrapped: async (effect) => {
                const exit = await Effect.runPromiseExit(effect as never)
                if (exit._tag === 'Failure') throw Cause.squash(exit.cause)
                return exit.value
            },
        } as never,
        nodeDoor: () => ({ joinWithToken }) as unknown as NodeDoorClient,
        agentLink: () => agent,
    })

    // The flow YIELDS its collaborators, so a spec provides them the way the module does: a Layer.
    const ports = Layer.mergeAll(
        Layer.succeed(NodeConfigRepository, {
            find: () => Effect.succeed(null),
        } as unknown as NodeConfigRepositoryShape),
        Layer.succeed(SwarmBootstrap, {} as SwarmBootstrapShape),
        Layer.succeed(SwarmCluster, {} as SwarmClusterShape),
        Layer.succeed(ApiEnvironment, { get: noop } as unknown as EnvService)
    )

    return {
        initialize: (
            ...args: Parameters<typeof service.initialize>
        ): Effect.Effect<
            Effect.Success<ReturnType<typeof service.initialize>>,
            Effect.Error<ReturnType<typeof service.initialize>>
        > => service.initialize(...args).pipe(Effect.provide(ports)),
    }
}

/** The flow's failure message, which is what the wizard shows. */
const failureOf = (
    effect: ReturnType<ReturnType<typeof serviceWith>['initialize']>
) => Effect.runPromise(Effect.flip(effect)).then((failure) => failure.message)

const input = {
    strategy: 'remote' as const,
    token: 'platform-grant',
    serverUrl: 'https://node.example.com',
}

describe('RemoteInitializationService join token', () => {
    it("redeems the agent's own token when setup received it", async () => {
        const redeem = vi.fn(() => Promise.reject(new Error('stop here')))
        const service = serviceWith(redeem)

        expect(
            await failureOf(
                service.initialize(
                    { ...input, meshJoinToken: 'agent-join-token' },
                    new SetupStepTracker(),
                    vi.fn()
                )
            )
        ).toBe('stop here')
        expect(redeem).toHaveBeenCalledWith('agent-join-token')
    })

    it('falls back to the platform token when no agent token was passed', async () => {
        const redeem = vi.fn(() => Promise.reject(new Error('stop here')))
        const service = serviceWith(redeem)

        expect(
            await failureOf(
                service.initialize(input, new SetupStepTracker(), vi.fn())
            )
        ).toBe('stop here')
        expect(redeem).toHaveBeenCalledWith('platform-grant')
    })
})
