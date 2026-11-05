import { Effect, Fiber } from 'effect'

import {
    EffectHost,
    ServiceLifecycleRunner,
    type EffectHostShape,
    type ServiceLifecycleShape,
} from '@deployer/nest-effect'
import {
    makeSupervisor,
    SupervisorOrchestrator,
    type AnySupervisor,
    type SupervisorOrchestratorShape,
    type SupervisorSpec,
} from '@deployer/supervision'

import type { SupervisorEventBusFacade } from './supervisor-event.bus'
import type { Provider } from '@nestjs/common'
import type z from 'zod/v4'

/**
 * One supervisor in a module: the Effect `Supervisor` built from its spec, and when (and whether) it
 * joins the orchestrator.
 *
 * A supervisor is one piece of platform infrastructure, written as a `SupervisorSpec` in a platform
 * package. What the app adds is the decision to register it: `activate` returns null to skip (after
 * logging why), or the background loop to run once registered. Everything else (state, health, events,
 * drift control) is the Effect framework.
 */
export type SupervisorRegistration = {
    readonly supervisor: AnySupervisor
    /** Runs once at module init. Null skips registration; otherwise the optional loop to run beside it. */
    readonly activate: Effect.Effect<
        { readonly background?: Effect.Effect<unknown, unknown> } | null,
        unknown
    >
    /** False lets boot continue while `activate` is still resolving (a connector whose provider is slow). */
    readonly blocking?: boolean
}

/** The runtime of `spec`, publishing its events on the shared bus. */
export const buildSupervisor = <
    TSchema extends z.ZodType,
    TProcess extends z.ZodType,
>(
    spec: SupervisorSpec<TSchema, TProcess>,
    bus: SupervisorEventBusFacade,
    label: string
) => makeSupervisor(spec, { bus: bus.core, label })

/**
 * Registers a module's supervisors with the orchestrator, runs their background loops, stops them on shutdown.
 *
 * Stateful (it owns the loops' fibers), so it is built once over its registrations. `onStart` activates the blocking ones
 * before the app serves; a supervisor whose activation fails is logged and skipped, never a failed boot.
 */
export type SupervisorRegistrarShape = ServiceLifecycleShape & {
    readonly onStart: () => Effect.Effect<void>
    readonly onStop: () => Effect.Effect<void>
}

export function makeSupervisorRegistrar(
    registrations: readonly SupervisorRegistration[],
    orchestrator: SupervisorOrchestratorShape
): SupervisorRegistrarShape {
    const fibers: Fiber.Fiber<unknown, unknown>[] = []

    const start = (entry: SupervisorRegistration): Effect.Effect<void> =>
        Effect.gen(function* () {
            const activation = yield* entry.activate
            if (activation === null) return
            yield* orchestrator.register(entry.supervisor)
            if (activation.background !== undefined)
                fibers.push(yield* Effect.forkDetach(activation.background))
        }).pipe(
            Effect.catch((error: unknown) =>
                Effect.logWarning(
                    `Supervisor ${entry.supervisor.id} not registered: ${error instanceof Error ? error.message : String(error)}`
                )
            )
        )

    return {
        // A non-blocking registration (a connector whose provider is slow) starts in the background and does not hold the boot.
        onStart: () =>
            Effect.gen(function* () {
                for (const entry of registrations.filter(
                    (e) => e.blocking === false
                ))
                    yield* Effect.forkDetach(start(entry))
                yield* Effect.all(
                    registrations
                        .filter((e) => e.blocking !== false)
                        .map(start),
                    { concurrency: 'unbounded' }
                )
            }),
        onStop: () =>
            Effect.forEach(
                fibers.splice(0),
                (fiber) => Fiber.interrupt(fiber),
                { concurrency: 'unbounded' }
            ).pipe(Effect.asVoid),
    }
}

/**
 * Providers for a module's supervisors: the registrations under `token`, and the lifecycle runner that activates them.
 * `inject` are the registrations' dependencies, in the order `build` takes them.
 */
export const supervisorProviders = (config: {
    readonly token: symbol
    readonly inject: (
        symbol | string | (abstract new (...args: never[]) => unknown)
    )[]
    readonly build: (...deps: never[]) => readonly SupervisorRegistration[]
}): Provider[] => [
    { provide: config.token, useFactory: config.build, inject: config.inject },
    {
        provide: Symbol(
            `SupervisorRegistrar:${config.token.description ?? 'supervisors'}`
        ),
        useFactory: (
            registrations: readonly SupervisorRegistration[],
            orchestrator: SupervisorOrchestratorShape,
            host: EffectHostShape
        ) =>
            new ServiceLifecycleRunner(
                `SupervisorRegistrar:${config.token.description ?? 'supervisors'}`,
                makeSupervisorRegistrar(registrations, orchestrator),
                host
            ),
        inject: [config.token, SupervisorOrchestrator, EffectHost],
    },
]
