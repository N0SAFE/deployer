import type { SupervisorState } from './state'
import type { Effect } from 'effect'
import type z from 'zod/v4'

/** What a probe observed about the supervised resource. */
export type ProbeResult<TPayload> = {
    readonly healthy: boolean
    /** What is wrong, or what is notable. */
    readonly detail?: string
    /** The measurements, validated against the supervisor's payload schema. */
    readonly payload: TPayload
}

/** A supervisor's health as the orchestrator and the health module see it. */
export type HealthSnapshot<TPayload> = {
    readonly supervisorId: string
    readonly description: string
    readonly healthy: boolean
    readonly state: SupervisorState
    readonly detail: string | null
    /** ISO 8601 timestamp of the probe. */
    readonly checkedAt: string
    /**
     * Non-fatal warnings the operator must act on ("ingress port 80 is taken; the app is running
     * headless"). The app keeps running; the web app surfaces these for remediation.
     */
    readonly warnings: string[]
    readonly payload: TPayload
}

/**
 * The description of one supervised resource: how to converge it, how to observe it, what the
 * observations look like. Everything the lifecycle needs and nothing about how it is hosted.
 */
export type SupervisorSpec<
    TPayloadSchema extends z.ZodType,
    TProcessSchema extends z.ZodType,
> = {
    /** Stable registry id; see `supervisorIdentifier`. */
    readonly id: string
    readonly description: string
    /** The single source of truth for what `probe` reports. */
    readonly payloadSchema: TPayloadSchema
    /** The single source of truth for what `processInfo` reports. */
    readonly processInfoSchema: TProcessSchema
    /** One idempotent pass towards the desired state. Fails when it could not get there. */
    readonly converge: Effect.Effect<void, unknown>
    /**
     * A real observation of the resource. Read-only: it must not converge. An unhealthy resource is
     * `healthy: false` with a payload describing it, not a failure.
     */
    readonly probe: Effect.Effect<
        ProbeResult<z.output<TPayloadSchema>>,
        unknown
    >
    /** The payload to report when `probe` itself fails (the engine is unreachable, say). Must satisfy `payloadSchema`. */
    readonly degradedPayload: (detail: string) => z.output<TPayloadSchema>
    /** The supervisor-specific part of the process info: the kind of process, its desired config, how to reach it. */
    readonly processInfo: Effect.Effect<Record<string, unknown>, unknown>
    /**
     * A precondition that makes convergence impossible right now, or null when it can proceed. It is
     * how a supervisor says "not yet" without pretending an attempt failed.
     */
    readonly blocker?: Effect.Effect<string | null, unknown>
    /** Extra warnings for a probe result. By default a degraded convergence is the only one. */
    readonly warnings?: (
        probe: ProbeResult<z.output<TPayloadSchema>>,
        state: SupervisorState,
        detail: string | null
    ) => string[]
}
