import { generateKeyPairSync } from 'node:crypto'

import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
    GitHubAppConfigInvalid,
    GitHubAppNotRegistered,
    makeGitHubService,
} from './github.service'

const privateKey = generateKeyPairSync('rsa', {
    modulusLength: 2048,
    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    publicKeyEncoding: { type: 'spki', format: 'pem' },
}).privateKey

describe('GitHubService registry', () => {
    it('registers an App per organization and forgets it on unregister', async () => {
        const github = makeGitHubService()
        expect(github.hasAppForOrganization('acme')).toBe(false)
        await Effect.runPromise(
            github.registerInstallation('acme', { appId: '1', privateKey })
        )
        expect(github.hasAppForOrganization('acme')).toBe(true)
        expect(github.getRegisteredOrganizations()).toEqual(['acme'])
        github.unregisterInstallation('acme')
        expect(github.hasAppForOrganization('acme')).toBe(false)
    })

    it('fails with GitHubAppNotRegistered for an unknown organization, on every installation call', async () => {
        const github = makeGitHubService()
        for (const call of [
            github.getAppForOrganization('ghost'),
            github.listInstallations('ghost'),
            github.listInstallationRepositories('ghost', 1),
            github.getRepositoryFileContent(
                'ghost',
                1,
                'o',
                'r',
                'package.json'
            ),
        ]) {
            expect(
                await Effect.runPromise(
                    Effect.flip(call as Effect.Effect<unknown, unknown>)
                )
            ).toBeInstanceOf(GitHubAppNotRegistered)
        }
    })

    it('refuses credentials that cannot build an App', async () => {
        const error = await Effect.runPromise(
            Effect.flip(
                makeGitHubService().registerInstallation('acme', {
                    appId: '',
                    privateKey: '',
                })
            )
        )
        expect(error).toBeInstanceOf(GitHubAppConfigInvalid)
    })

    it('answers a bad webhook signature as false, never an error', async () => {
        expect(
            await Effect.runPromise(
                makeGitHubService().verifyWebhookSignature(
                    '{}',
                    'sha256=bad',
                    'secret'
                )
            )
        ).toBe(false)
    })
})
