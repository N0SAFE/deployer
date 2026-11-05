import { describe, expect, it, vi } from 'vitest'

import { jsonBodyLimit } from './bootstrap'

/** The minimum of an Express request the middleware reads. */
const request = (headers: Record<string, string>) => ({ headers }) as never

function response() {
    const res = {
        status: vi.fn(),
        json: vi.fn(),
    }
    res.status.mockReturnValue(res)
    return res
}

describe('jsonBodyLimit', () => {
    it('rejects a JSON body that declares more than the cap, before it is read', () => {
        const res = response()
        const next = vi.fn()

        jsonBodyLimit(1024)(
            request({
                'content-type': 'application/json',
                'content-length': '4096',
            }),
            res as never,
            next
        )

        expect(res.status).toHaveBeenCalledWith(413)
        expect(res.json).toHaveBeenCalledWith(
            expect.objectContaining({ code: 'PAYLOAD_TOO_LARGE' })
        )
        expect(next).not.toHaveBeenCalled()
    })

    it('lets a JSON body at or under the cap through', () => {
        const next = vi.fn()

        jsonBodyLimit(1024)(
            request({
                'content-type': 'application/json; charset=utf-8',
                'content-length': '1024',
            }),
            response() as never,
            next
        )

        expect(next).toHaveBeenCalled()
    })

    it('does not touch multipart uploads: `uploadBundle` is legitimately large', () => {
        const next = vi.fn()

        jsonBodyLimit(1024)(
            request({
                'content-type': 'multipart/form-data; boundary=x',
                'content-length': '50000000',
            }),
            response() as never,
            next
        )

        expect(next).toHaveBeenCalled()
    })

    it('cannot judge a chunked body, so it passes it to the route that consumes it', () => {
        const next = vi.fn()

        jsonBodyLimit(1024)(
            request({ 'content-type': 'application/json' }),
            response() as never,
            next
        )

        expect(next).toHaveBeenCalled()
    })
})
