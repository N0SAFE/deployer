import { describe, expect, it } from 'vitest'

import { runWithServiceAuth, serviceAuthHeaders } from './service-auth-context'

/**
 * What travels on a BFF fan-out leg.
 *
 * Only the caller's credentials — never the browser's full header set: relaying `accept-encoding`, `user-agent` or
 * `content-length` onto an internal JSON call makes the service wait for bytes that are not coming. The API key is
 * listed explicitly because the services' key plugin reads `x-api-key`, and a key minted for the CLI has to keep working
 * when the call goes through the BFF.
 */
describe('serviceAuthHeaders', () => {
    it('forwards the session cookie', () => {
        const headers = runWithServiceAuth(
            { cookie: 'session=abc' },
            serviceAuthHeaders
        )

        expect(headers).toEqual({ cookie: 'session=abc' })
    })

    it('forwards a bearer authorization', () => {
        const headers = runWithServiceAuth(
            { authorization: 'Bearer token' },
            serviceAuthHeaders
        )

        expect(headers).toEqual({ authorization: 'Bearer token' })
    })

    it('forwards an API key as x-api-key, which is the header the key plugin reads', () => {
        const headers = runWithServiceAuth(
            { apiKey: 'dk_abc' },
            serviceAuthHeaders
        )

        expect(headers).toEqual({ 'x-api-key': 'dk_abc' })
    })

    it('sends nothing outside a request', () => {
        expect(serviceAuthHeaders()).toEqual({})
    })

    it('does not invent headers for a caller with no credentials', () => {
        expect(runWithServiceAuth({}, serviceAuthHeaders)).toEqual({})
    })
})
