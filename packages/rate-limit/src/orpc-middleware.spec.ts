import { os } from '@orpc/server'
import { call } from '@orpc/server'
import { describe, expect, it } from 'vitest'

import { rateLimit } from './orpc-middleware'

import type { RequestContext } from './orpc-middleware'

/** The middleware is proved through a real procedure: what a caller experiences is the contract's `TOO_MANY_REQUESTS`. */
const requestFrom = (ip: string | null): RequestContext => ({
    request: new Request(
        'http://deployer.localhost',
        ip === null ? {} : { headers: { 'x-forwarded-for': ip } }
    ),
})

const guarded = (options: Parameters<typeof rateLimit>[0]) =>
    os
        .$context<RequestContext>()
        .use(rateLimit(options))
        .handler(() => 'ok' as const)

describe('rateLimit middleware', () => {
    it('lets a client through up to `max` requests, then refuses with TOO_MANY_REQUESTS (statusCode 429)', async () => {
        const procedure = guarded({ windowMs: 60_000, max: 2 })
        const context = requestFrom('203.0.113.7')
        await expect(call(procedure, undefined, { context })).resolves.toBe('ok')
        await expect(call(procedure, undefined, { context })).resolves.toBe('ok')
        await expect(call(procedure, undefined, { context })).rejects.toMatchObject({
            code: 'TOO_MANY_REQUESTS',
            data: expect.objectContaining({ statusCode: 429 }),
        })
    })

    it('counts each client on its own', async () => {
        const procedure = guarded({ windowMs: 60_000, max: 1 })
        await expect(call(procedure, undefined, { context: requestFrom('198.51.100.1') })).resolves.toBe('ok')
        await expect(call(procedure, undefined, { context: requestFrom('198.51.100.2') })).resolves.toBe('ok')
        await expect(call(procedure, undefined, { context: requestFrom('198.51.100.1') })).rejects.toMatchObject({
            code: 'TOO_MANY_REQUESTS',
        })
    })

    it('says what the operator asked it to say', async () => {
        const procedure = guarded({ windowMs: 60_000, max: 0, message: 'slow down' })
        await expect(call(procedure, undefined, { context: requestFrom(null) })).rejects.toMatchObject({
            message: 'slow down',
        })
    })
})
