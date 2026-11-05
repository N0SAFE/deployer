import { describe, expect, it } from 'vitest'

import {
    type LeaseInput,
    defaultLeaseThresholds,
    leaseReason,
} from './lease-policy'

const calm: LeaseInput = {
    heavy: false,
    callerWantsDirect: false,
    agent: { eventLoopLagMs: 1, bytesPerSecond: 1_000, openStreams: 3 },
    pairCallsPerSecond: 2,
}

describe('leaseReason', () => {
    it('brokers an ordinary call on a calm agent', () => {
        expect(leaseReason(calm)).toBeUndefined()
    })

    it('leases a heavy procedure by default', () => {
        expect(leaseReason({ ...calm, heavy: true })).toBe('heavy-procedure')
    })

    it('leases when the caller asks for a direct link', () => {
        expect(leaseReason({ ...calm, callerWantsDirect: true })).toBe(
            'caller-request'
        )
    })

    it.each([
        [
            'event loop lag',
            { eventLoopLagMs: defaultLeaseThresholds.maxEventLoopLagMs + 1 },
        ],
        [
            'bytes per second',
            { bytesPerSecond: defaultLeaseThresholds.maxBytesPerSecond + 1 },
        ],
        [
            'open streams',
            { openStreams: defaultLeaseThresholds.maxOpenStreams + 1 },
        ],
    ])('leases when the agent is overloaded on %s', (_name, agent) => {
        expect(
            leaseReason({ ...calm, agent: { ...calm.agent, ...agent } })
        ).toBe('agent-overloaded')
    })

    it('leases a hot caller and target pair', () => {
        expect(
            leaseReason({
                ...calm,
                pairCallsPerSecond:
                    defaultLeaseThresholds.hotPairCallsPerSecond + 1,
            })
        ).toBe('hot-pair')
    })

    it('does not lease exactly at the threshold', () => {
        expect(
            leaseReason({
                ...calm,
                pairCallsPerSecond:
                    defaultLeaseThresholds.hotPairCallsPerSecond,
            })
        ).toBeUndefined()
    })

    it('uses the thresholds it is given', () => {
        const strict = { ...defaultLeaseThresholds, hotPairCallsPerSecond: 1 }

        expect(leaseReason(calm, strict)).toBe('hot-pair')
    })
})
