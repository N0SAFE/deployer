import { Context, Effect } from 'effect'

import type { ServiceLifecycleShape } from '@deployer/nest-effect'

import { RuntimeInvalid } from '../../../core/runtime.errors'

import type {
    DeploymentTriggerEvent,
    DeploymentTriggerSource,
} from './base/deployment-trigger-source.interface'
import type { TriggerServiceLinkPort } from './deployment-trigger.ports'

/** What the sources read while they run. */
export type TriggerSourceServices = TriggerServiceLinkPort

type TriggerInput = NonNullable<
    Effect.Success<ReturnType<DeploymentTriggerSource['toTriggerInput']>>
>

/**
 * The single public entry point for trigger dispatch.
 *
 * Ask it "which source owns this event?" and it answers with a source (or nothing), then
 * "what input does it produce?". Every origin — API, GitHub push, GitHub PR, a schedule —
 * is a `DeploymentTriggerSource`, so a new one is a file plus an entry in the module's list.
 *
 * ── WHY `toTriggerInput()` ANSWERS NULL INSTEAD OF FAILING ────────────────
 * "No source matched" is a NORMAL outcome for a webhook endpoint, which receives every
 * event type the provider sends (issues, stars, releases…). Failing would make a normal
 * delivery look like an error. `requireInput()` is the stricter form for callers that
 * genuinely expected a match.
 */
export type DeploymentTriggerRegistryShape = ServiceLifecycleShape & {
    /** Every registered source with its state, for the catalog / diagnostics. */
    readonly supportedSources: () => {
        sourceId: string
        enabled: boolean
        reason: string | null
    }[]
    /** The first ENABLED source that claims this event, or null. */
    readonly resolve: (
        event: DeploymentTriggerEvent
    ) => DeploymentTriggerSource<TriggerSourceServices> | null
    /**
     * Resolve and translate in one step. `null` when no source matched (a normal webhook delivery); `input` is
     * `null` when the matched source declined (a well-formed event that is not deployable, e.g. a PR from a fork).
     */
    readonly toTriggerInput: (
        event: DeploymentTriggerEvent
    ) => Effect.Effect<
        { sourceId: string; input: TriggerInput | null } | null,
        unknown,
        TriggerSourceServices
    >
    /** Strict form: fails with `RuntimeInvalid` when nothing matched. For callers that expected a match. */
    readonly requireInput: (
        event: DeploymentTriggerEvent
    ) => Effect.Effect<TriggerInput, unknown, TriggerSourceServices>
}

export class DeploymentTriggerRegistry extends Context.Service<
    DeploymentTriggerRegistry,
    DeploymentTriggerRegistryShape
>()('runtime/DeploymentTriggerRegistry') {}

/**
 * Builds the registry over its sources. A source registered twice under one id is replaced in place (the later
 * one wins) so dispatch order stays deterministic; the replacement is reported when the registry starts.
 */
export function makeDeploymentTriggerRegistry(
    sources: readonly DeploymentTriggerSource<TriggerSourceServices>[]
): DeploymentTriggerRegistryShape {
    /** Registration order, preserved so dispatch is deterministic. */
    const ordered: DeploymentTriggerSource<TriggerSourceServices>[] = []
    const byId = new Map<
        string,
        DeploymentTriggerSource<TriggerSourceServices>
    >()
    const duplicates: string[] = []
    for (const source of sources) {
        const key = source.sourceId.toLowerCase()
        const existing = byId.get(key)
        if (existing) {
            duplicates.push(
                `Trigger source '${key}' registered twice (${existing.constructor.name} → ${source.constructor.name}); the later one wins`
            )
            // Replace in place so `ordered` cannot hold two instances with one key.
            const index = ordered.indexOf(existing)
            if (index >= 0) ordered[index] = source
        } else {
            ordered.push(source)
        }
        byId.set(key, source)
    }

    const resolve: DeploymentTriggerRegistryShape['resolve'] = (event) => {
        for (const source of ordered) {
            // A disabled source must not claim an event: it would report "matched" and
            // then fail in `toTriggerInput`, which is a worse error than "no source".
            if (!source.isEnabled()) continue
            if (source.matches(event)) return source
        }
        return null
    }

    const toTriggerInput: DeploymentTriggerRegistryShape['toTriggerInput'] = (
        event
    ) =>
        Effect.gen(function* () {
            const source = resolve(event)
            if (!source) return null
            const input = yield* source.toTriggerInput(event)
            return { sourceId: source.sourceId, input }
        })

    return {
        onStart: () =>
            Effect.gen(function* () {
                for (const message of duplicates)
                    yield* Effect.logWarning(message)
                const enabled = ordered
                    .filter((source) => source.isEnabled())
                    .map((s) => s.sourceId)
                yield* Effect.logInfo(
                    `Trigger sources: ${String(enabled.length)}/${String(ordered.length)} enabled — ${enabled.join(', ')}`
                )
                for (const source of ordered) {
                    if (!source.isEnabled()) {
                        yield* Effect.logWarning(
                            `Trigger source '${source.sourceId}' is registered but disabled: ${source.disabledReason()}`
                        )
                    }
                }
            }),
        supportedSources: () =>
            ordered.map((source) => ({
                sourceId: source.sourceId,
                enabled: source.isEnabled(),
                reason: source.isEnabled() ? null : source.disabledReason(),
            })),
        resolve,
        toTriggerInput,
        requireInput: (event) =>
            Effect.gen(function* () {
                const result = yield* toTriggerInput(event)
                if (!result?.input) {
                    return yield* Effect.fail(
                        new RuntimeInvalid({
                            reason:
                                `No deployment trigger source matched event '${event.provider}/${event.eventName}'. ` +
                                `Enabled sources: ${ordered
                                    .filter((s) => s.isEnabled())
                                    .map((s) => s.sourceId)
                                    .join(', ')}`,
                        })
                    )
                }
                return result.input
            }),
    }
}
