import { describe, expect, it } from 'vitest'

import { API_KEY_PREFIX, apiKeyFromHeaders } from './index'

/**
 * Which header an API key may arrive in.
 *
 * The plugin's own default reads `x-api-key` only, while every client this platform ships (ORPC link, CLI, devtools)
 * sends `Authorization: Bearer dk_…`. That mismatch is why minted keys authenticated nowhere — the audit's "keys are
 * unusable" finding — so this reader is the compatibility point and is tested on its own.
 */
const headersOf = (init: Record<string, string>): Headers => new Headers(init)

describe('apiKeyFromHeaders', () => {
    it("reads the plugin's own header", () => {
        expect(
            apiKeyFromHeaders(
                headersOf({ 'x-api-key': `${API_KEY_PREFIX}_abc` })
            )
        ).toBe(`${API_KEY_PREFIX}_abc`)
    })

    it('reads a bearer key', () => {
        expect(
            apiKeyFromHeaders(
                headersOf({ authorization: `Bearer ${API_KEY_PREFIX}_abc` })
            )
        ).toBe(`${API_KEY_PREFIX}_abc`)
    })

    it('accepts a lowercase scheme and extra spaces', () => {
        expect(
            apiKeyFromHeaders(
                headersOf({ authorization: `bearer   ${API_KEY_PREFIX}_abc  ` })
            )
        ).toBe(`${API_KEY_PREFIX}_abc`)
    })

    it('prefers the dedicated header when both are present', () => {
        expect(
            apiKeyFromHeaders(
                headersOf({
                    'x-api-key': `${API_KEY_PREFIX}_direct`,
                    authorization: `Bearer ${API_KEY_PREFIX}_bearer`,
                })
            )
        ).toBe(`${API_KEY_PREFIX}_direct`)
    })

    it('does not treat a session token as an API key', () => {
        // A signed-in browser sends `Authorization: Bearer <session>`; reading that as a key would fail the key lookup on
        // every normal request.
        expect(
            apiKeyFromHeaders(
                headersOf({
                    authorization: 'Bearer eyJhbGciOiJIUzI1NiJ9.session',
                })
            )
        ).toBeNull()
    })

    it('ignores other schemes and empty headers', () => {
        expect(
            apiKeyFromHeaders(headersOf({ authorization: 'Basic abc' }))
        ).toBeNull()
        expect(
            apiKeyFromHeaders(headersOf({ authorization: 'Bearer' }))
        ).toBeNull()
        expect(apiKeyFromHeaders(headersOf({ 'x-api-key': '' }))).toBeNull()
        expect(apiKeyFromHeaders(headersOf({}))).toBeNull()
        expect(apiKeyFromHeaders(undefined)).toBeNull()
    })
})
