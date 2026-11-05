import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import { makePlatformWebTargetService } from './platform-web-target.service'

function target(
    env: { webTarget?: string; external?: boolean; prefix?: string },
    enabled: boolean
) {
    return makePlatformWebTargetService({
        platformConfig: {
            isManagedWebAppEnabled: () => Effect.succeed(enabled),
        },
        env: {
            webTarget: () => env.webTarget,
            managedWebExternal: () => env.external ?? false,
            prefix: () => env.prefix ?? '',
        },
    })
}
const resolve = (service: ReturnType<typeof target>) =>
    Effect.runPromise(service.resolveWebTarget())

describe('PlatformWebTargetService', () => {
    it('an explicit DEPLOYER_WEB_TARGET wins', async () => {
        expect(await resolve(target({ webTarget: ' web-dev ' }, false))).toBe(
            'web-dev'
        )
    })

    it('serves nothing when an external web is declared', async () => {
        expect(await resolve(target({ external: true }, true))).toBeNull()
    })

    it('serves nothing while the managed web app is off', async () => {
        expect(await resolve(target({}, false))).toBeNull()
    })

    it('names the managed web container, prefixed on a prefixed install', async () => {
        const plain = await resolve(target({}, true))
        expect(plain).toBe('deployer-managed-web')
        expect(await resolve(target({ prefix: 'acme' }, true))).toBe(
            'deployer-managed-web-acme'
        )
    })
})
