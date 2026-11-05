import { EventEmitter } from 'node:events'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import { accessLog } from './access-log.edge'
import { getInternalErrorRequestContext } from './internal-error/internal-error-context'
import { requestContext } from './internal-error/request-context.edge'
import { ssrAuthRedirect } from './ssr-auth-redirect.edge'

import type { Request, Response } from 'express'

const log = vi.hoisted(() => ({
    error: vi.fn(),
    warn: vi.fn(),
    debug: vi.fn(),
    info: vi.fn(),
}))
vi.mock('@deployer/logger', () => ({ logger: { scope: () => log } }))
vi.mock('node:os', () => ({ hostname: () => 'test-host' }))

const request = (
    over: Record<string, unknown> = {},
    headers: Record<string, string> = {}
) =>
    ({
        ip: '127.0.0.1',
        method: 'GET',
        originalUrl: '/api/things',
        headers,
        get: (name: string) => headers[name],
        ...over,
    }) as unknown as Request

function response(statusCode = 200) {
    const emitter = new EventEmitter()
    const res = Object.assign(emitter, {
        statusCode,
        statusMessage: 'OK',
        get: () => '1024',
        setHeader: vi.fn(),
        redirect: vi.fn(),
    })
    return {
        res: res as unknown as Response,
        close: () => emitter.emit('close'),
        raw: res,
    }
}

beforeEach(() => {
    vi.clearAllMocks()
})

describe('accessLog', () => {
    it('calls next at once and logs when the response closes', () => {
        const next = vi.fn()
        const { res, close } = response(200)
        accessLog()(request({}, { 'user-agent': 'ua' }), res, next)

        expect(next).toHaveBeenCalledOnce()
        expect(log.debug).not.toHaveBeenCalled()
        close()
        expect(log.debug).toHaveBeenCalledOnce()
        expect(String(log.debug.mock.calls[0]?.[0])).toContain('test-host')
    })

    it('maps 5xx to error, 4xx to warn', () => {
        for (const [status, level] of [
            [500, log.error],
            [404, log.warn],
        ] as const) {
            const { res, close } = response(status)
            accessLog()(request(), res, vi.fn())
            close()
            expect(level).toHaveBeenCalled()
        }
    })

    it('never logs probes', () => {
        const { res, close } = response(200)
        accessLog()(request({ originalUrl: '/health/ready' }), res, vi.fn())
        close()
        expect(log.debug).not.toHaveBeenCalled()
    })
})

describe('requestContext', () => {
    it("keeps the caller's x-request-id and echoes it", () => {
        const req = request({}, { 'x-request-id': 'abc' })
        const { raw, res } = response()
        requestContext()(req, res, vi.fn())

        expect(raw.setHeader).toHaveBeenCalledWith('x-request-id', 'abc')
        expect(getInternalErrorRequestContext(req)).toMatchObject({
            requestId: 'abc',
            method: 'GET',
            path: '/api/things',
        })
    })

    it('generates an id when none (or a blank one) was sent', () => {
        const req = request({}, { 'x-request-id': '  ' })
        const { raw, res } = response()
        requestContext()(req, res, vi.fn())

        const id = raw.setHeader.mock.calls[0]?.[1] as string
        expect(id).toMatch(/^[0-9a-f-]{36}$/)
    })
})

describe('ssrAuthRedirect', () => {
    const auth = (impl: () => Promise<{ user?: unknown } | null>) => ({
        api: { getSession: impl },
    })

    it('lets a signed-in request through', async () => {
        const next = vi.fn()
        const { res, raw } = response()
        await ssrAuthRedirect(
            auth(() => Promise.resolve({ user: { id: 'u' } }))
        )(request({ originalUrl: '/manage/x' }), res, next)
        expect(next).toHaveBeenCalledOnce()
        expect(raw.redirect).not.toHaveBeenCalled()
    })

    it('redirects an anonymous request, and one whose session lookup throws', async () => {
        for (const lookup of [
            () => Promise.resolve(null),
            () => Promise.reject(new Error('bad cookie')),
        ]) {
            const next = vi.fn()
            const { res, raw } = response()
            await ssrAuthRedirect(auth(lookup))(
                request({ originalUrl: '/manage/x' }),
                res,
                next
            )
            expect(raw.redirect).toHaveBeenCalledWith('/manage/login')
            expect(next).not.toHaveBeenCalled()
        }
    })

    it('exempts the login page itself, even with a query string', async () => {
        const next = vi.fn()
        const lookup = vi.fn()
        await ssrAuthRedirect(auth(lookup))(
            request({ originalUrl: '/manage/login?next=/manage' }),
            response().res,
            next
        )
        expect(next).toHaveBeenCalledOnce()
        expect(lookup).not.toHaveBeenCalled()
    })
})
