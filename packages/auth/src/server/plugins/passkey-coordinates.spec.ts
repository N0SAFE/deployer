import { describe, expect, it } from 'vitest'

import { passkeyCoordinates } from './securityPlugins'

/**
 * WebAuthn's relying-party coordinates, which are a deployment fact and have to be derived, not guessed.
 *
 * The ceremony runs on the WEB origin while the API answers it, so the RP ID must be the parent domain: leaving the
 * plugin to infer it makes it use `api.<domain>`, and the browser then refuses every credential as "wrong RP" — the
 * failure the audit found (PASSKEY_RPID/PASSKEY_ORIGIN were in compose and read by nothing).
 */
describe('passkeyCoordinates', () => {
    it('derives the RP ID from the base domain without its leading dot', () => {
        expect(
            passkeyCoordinates({
                authBaseDomain: '.example.com',
                appUrl: 'https://web.example.com',
            })
        ).toEqual({
            rpID: 'example.com',
            origin: ['https://web.example.com'],
        })
    })

    it('accepts a base domain with no leading dot', () => {
        expect(passkeyCoordinates({ authBaseDomain: 'example.com' })).toEqual({
            rpID: 'example.com',
        })
    })

    it('lets the operator pin the RP ID and one or more origins', () => {
        expect(
            passkeyCoordinates({
                authBaseDomain: '.example.com',
                appUrl: 'https://web.example.com',
                rpIdOverride: 'deploy.example.internal',
                originOverride:
                    'https://web.example.internal, https://console.example.internal',
            })
        ).toEqual({
            rpID: 'deploy.example.internal',
            origin: [
                'https://web.example.internal',
                'https://console.example.internal',
            ],
        })
    })

    it('omits what it cannot know rather than inventing it', () => {
        expect(passkeyCoordinates({})).toEqual({})
        expect(passkeyCoordinates({ appUrl: '' })).toEqual({})
    })
})
