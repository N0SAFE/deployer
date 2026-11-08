import { Context, Effect, Layer, ManagedRuntime } from 'effect'
import { describe, expect, it, vi } from 'vitest'

import { ServiceLifecycleRunner, type ServiceLifecycleShape } from '@deployer/nest-effect'
import { SwarmBootstrap } from '@deployer/swarm'

import {
    SwarmParticipation,
    type SwarmParticipationShape,
} from '@deployer/swarm'

/**
 * A lifecycle hook may `yield*` a service, exactly as a handler does.
 *
 * The hook runs through `EffectHost`, whose runtime is a `ManagedRuntime` over the layer built from
 * every Effect-keyed provider (`collectEffectLayer`). So the requirement is discharged the way the
 * module declares it — the provider is registered in the module, and no `provideService` call or
 * constructor argument is needed.
 *
 * This uses the REAL `SwarmBootstrap.onBoot`: it is the case that made the distinction matter,
 * since `converge` and `onBoot` yield `SwarmParticipation` instead of taking it by constructor.
 */
const snapshot = {
    localNodeState: 'active',
    nodeCount: 1,
    managerCount: 1,
    master: null,
    localNode: { swarmRole: 'manager', availability: 'active' },
}

describe('SwarmBootstrap.onBoot through the lifecycle runner', () => {
    it('resolves SwarmParticipation from the container, with no constructor arg', async () => {
        const converge = vi.fn(() => Effect.succeed(snapshot as never))
        const participation = {
            converge,
            setupDone: () => Effect.succeed(true),
            effectiveConfig: () => Effect.succeed({ policy: 'auto' } as never),
        } as unknown as SwarmParticipationShape

        // Exactly what a module does: register the provider under its Effect key.
        const layer = Layer.mergeAll(
            Layer.succeed(SwarmParticipation, participation),
            Layer.succeed(SwarmBootstrap, new SwarmBootstrap.live(true))
        )
        const runtime = ManagedRuntime.make(layer)

        const host = {
            run: (e: never) => runtime.runPromise(e),
            runUnwrapped: async (e: never) => {
                const exit = await runtime.runPromiseExit(e)
                if (exit._tag === 'Failure') throw new Error('hook failed')
                return exit.value
            },
            fork: () => () => Promise.resolve(),
            context: () => runtime.context(),
            contextFor: () => Context.empty() as Context.Context<unknown>,
            size: () => 0,
        }

        // The shape the app declares: onModuleInit yields SwarmParticipation.
        const lifecycle: ServiceLifecycleShape<SwarmParticipation> = {
            onModuleInit: () => new SwarmBootstrap.live(true).onBoot,
        }

        const runner = new ServiceLifecycleRunner<SwarmParticipation>(
            'test/SwarmLifecycle',
            lifecycle,
            host as never
        )

        await runner.onModuleInit()
        await runtime.dispose()

        expect(converge).toHaveBeenCalledTimes(1)
    })
})
