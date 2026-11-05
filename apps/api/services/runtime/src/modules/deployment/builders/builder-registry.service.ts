import { Context, Effect } from 'effect'

import type { ServiceLifecycleShape } from '@deployer/nest-effect'

import { RuntimeInvalid } from '../../../core/runtime.errors'

import type { BuilderStrategy } from './base/builder-strategy.interface'

/**
 * Multi-provider token for builder strategies.
 *
 * Mirrors `CodeProvider` / `DNS_PROVIDERS`: an array bound under one token so the
 * registry never names a concrete strategy.
 */
export const BUILDER_STRATEGIES = Symbol('BUILDER_STRATEGIES')

/**
 * BuilderRegistry — the single public entry point for builder dispatch.
 *
 * ── THE CONTRACT ───────────────────────────────────────────────────────────
 * Callers ask for a builder kind and get either a strategy or a precise error. There
 * is no `if (builder === …)` anywhere outside a strategy itself, so adding nixpacks
 * (or a future "remote builder") means adding ONE strategy and ONE array entry in the
 * module.
 *
 * ── WHY `supportedBuilders()` EXISTS ──────────────────────────────────────
 * The catalog the web renders must come from HERE, not from a hand-written list.
 * That is the structural fix for the class of bug where the UI offered three builders
 * that always threw: a strategy that is registered but not `isAvailable()` is reported
 * as unavailable WITH its reason, so the option either disappears or is disabled
 * truthfully instead of failing at deploy time.
 */
export type BuilderRegistryShape = ServiceLifecycleShape & {
    /** Every registered builder, with availability, for the catalog / preflight. */
    readonly supportedBuilders: () => Effect.Effect<
        { builderType: string; available: boolean; reason: string | null }[]
    >
    /**
     * Resolve a strategy, or fail with the reason it cannot be used.
     *
     * Distinguishes the two failure modes deliberately: "no such builder" (a caller
     * bug or a stale client) from "the builder exists but its toolchain is missing"
     * (an environment problem the operator can fix).
     */
    readonly resolve: (
        builderType: string
    ) => Effect.Effect<BuilderStrategy, RuntimeInvalid>
    /** True when a builder is both registered AND runnable. */
    readonly isSupported: (builderType: string) => Effect.Effect<boolean>
    readonly onStart: () => Effect.Effect<void>
}

export class BuilderRegistry extends Context.Service<
    BuilderRegistry,
    BuilderRegistryShape
>()('runtime/BuilderRegistry') {}

/** The registry over its strategies; a later strategy of the same type wins, and `onStart` says so. */
export function makeBuilderRegistry(
    strategies: readonly BuilderStrategy[]
): BuilderRegistryShape {
    const byType = new Map<string, BuilderStrategy>()
    const duplicates: string[] = []
    for (const strategy of strategies) {
        const key = strategy.builderType.toLowerCase()
        if (byType.has(key)) duplicates.push(key)
        byType.set(key, strategy)
    }

    const supportedBuilders: BuilderRegistryShape['supportedBuilders'] = () =>
        Effect.sync(() =>
            [...byType.values()].map((strategy) => ({
                builderType: strategy.builderType,
                available: strategy.isAvailable(),
                reason: strategy.isAvailable()
                    ? null
                    : strategy.unavailableReason(),
            }))
        )

    return {
        supportedBuilders,
        resolve: (builderType) =>
            Effect.gen(function* () {
                const strategy = byType.get(builderType.toLowerCase())
                if (!strategy) {
                    return yield* new RuntimeInvalid({
                        reason: `Unsupported builder '${builderType}'. Supported: ${[...byType.keys()].join(', ')}`,
                    })
                }
                if (!strategy.isAvailable()) {
                    return yield* new RuntimeInvalid({
                        reason: `Builder '${builderType}' is registered but unavailable: ${strategy.unavailableReason()}`,
                    })
                }
                return strategy
            }),
        isSupported: (builderType) =>
            Effect.sync(
                () =>
                    byType.get(builderType.toLowerCase())?.isAvailable() ===
                    true
            ),
        onStart: () =>
            Effect.gen(function* () {
                for (const key of duplicates) {
                    yield* Effect.logWarning(
                        `Builder '${key}' registered twice; the later one wins`
                    )
                }
                const builders = yield* supportedBuilders()
                const available = builders
                    .filter((builder) => builder.available)
                    .map((builder) => builder.builderType)
                yield* Effect.logInfo(
                    `Builder registry: ${available.length}/${String(byType.size)} available — ${available.join(', ')}`
                )
            }),
    }
}
