import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { clientKey, readHeader } from './client-key'
import { makeSlidingWindowLimiter } from './sliding-window'

const limiterAt = (windowMs: number, max: number) => {
    let clock = 0
    return {
        limiter: makeSlidingWindowLimiter({ windowMs, max, now: () => clock }),
        tick: (ms: number) => {
            clock += ms
        },
    }
}

describe('sliding window limiter', () => {
    it('allows up to max requests per window, then refuses with how long to wait', () => {
        const { limiter, tick } = limiterAt(1_000, 2)
        expect(limiter.consumeNow('a')).toEqual({ allowed: true, remaining: 1 })
        tick(100)
        expect(limiter.consumeNow('a')).toEqual({ allowed: true, remaining: 0 })
        tick(100)
        expect(limiter.consumeNow('a')).toEqual({
            allowed: false,
            retryAfterMs: 800,
        })
    })

    it('does not count a refused request, so waiting out the window recovers', () => {
        const { limiter, tick } = limiterAt(1_000, 1)
        limiter.consumeNow('a')
        for (let i = 0; i < 5; i++) {
            tick(100)
            expect(limiter.consumeNow('a').allowed).toBe(false)
        }
        tick(501)
        expect(limiter.consumeNow('a').allowed).toBe(true)
    })

    it('limits each key on its own', () => {
        const { limiter } = limiterAt(1_000, 1)
        expect(limiter.consumeNow('a').allowed).toBe(true)
        expect(limiter.consumeNow('b').allowed).toBe(true)
        expect(limiter.consumeNow('a').allowed).toBe(false)
    })

    it('forgets clients whose requests have all left the window', () => {
        const { limiter, tick } = limiterAt(1_000, 5)
        for (let i = 0; i < 100; i++) limiter.consumeNow(`client-${String(i)}`)
        expect(limiter.tracked()).toBe(100)
        tick(2_000)
        limiter.consumeNow('someone-new')
        expect(limiter.tracked()).toBe(1)
    })

    it('is the same decision as an Effect', async () => {
        const { limiter } = limiterAt(1_000, 1)
        expect(await Effect.runPromise(limiter.consume('a'))).toEqual({
            allowed: true,
            remaining: 0,
        })
        expect(await Effect.runPromise(limiter.consume('a'))).toMatchObject({
            allowed: false,
        })
    })
})

describe('request headers', () => {
    it('reads a header from a fetch Request, a header record, or an Express-style array', () => {
        expect(
            readHeader(
                new Request('http://x', { headers: { 'x-a': '1' } }),
                'x-a'
            )
        ).toBe('1')
        expect(readHeader({ headers: { 'x-a': '2' } }, 'x-a')).toBe('2')
        expect(readHeader({ headers: { 'x-a': ['3', '4'] } }, 'x-a')).toBe('3')
        expect(readHeader({ headers: { 'X-A': '5' } }, 'x-a')).toBeNull()
        expect(readHeader({ headers: { 'x-a': '6' } }, 'X-A')).toBe('6')
        expect(readHeader(null, 'x-a')).toBeNull()
    })

    it('keys a request on the first forwarded hop, and groups the unattributable', () => {
        expect(
            clientKey({ headers: { 'x-forwarded-for': '10.0.0.1, 10.0.0.2' } })
        ).toBe('10.0.0.1')
        expect(clientKey({ headers: {} })).toBe('unknown')
        expect(clientKey(undefined)).toBe('unknown')
    })
})
