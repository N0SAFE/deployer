export type LeaseReason =
    'heavy-procedure' | 'caller-request' | 'agent-overloaded' | 'hot-pair'

/** What the agent knows when it decides whether to relay a call or hand the caller a direct link. */
export type LeaseInput = {
    /** The procedure is marked `heavy` in its contract (a stream, an upload, a big read). */
    readonly heavy: boolean
    /** The caller asked for `{ mode: "direct" }`. */
    readonly callerWantsDirect: boolean
    readonly agent: {
        readonly eventLoopLagMs: number
        readonly bytesPerSecond: number
        readonly openStreams: number
    }
    /** Recent calls per second between this caller and this target. */
    readonly pairCallsPerSecond: number
}

export type LeaseThresholds = {
    readonly maxEventLoopLagMs: number
    readonly maxBytesPerSecond: number
    readonly maxOpenStreams: number
    readonly hotPairCallsPerSecond: number
}

/** Starting points only: the load test of the relay sets the real values. */
export const defaultLeaseThresholds: LeaseThresholds = {
    maxEventLoopLagMs: 50,
    maxBytesPerSecond: 64 * 1024 * 1024,
    maxOpenStreams: 512,
    hotPairCallsPerSecond: 200,
}

/** `undefined` means the agent brokers the call itself. */
export function leaseReason(
    input: LeaseInput,
    thresholds: LeaseThresholds = defaultLeaseThresholds
): LeaseReason | undefined {
    if (input.heavy) {
        return 'heavy-procedure'
    }
    if (input.callerWantsDirect) {
        return 'caller-request'
    }
    if (
        input.agent.eventLoopLagMs > thresholds.maxEventLoopLagMs ||
        input.agent.bytesPerSecond > thresholds.maxBytesPerSecond ||
        input.agent.openStreams > thresholds.maxOpenStreams
    ) {
        return 'agent-overloaded'
    }
    if (input.pairCallsPerSecond > thresholds.hotPairCallsPerSecond) {
        return 'hot-pair'
    }
    return undefined
}
