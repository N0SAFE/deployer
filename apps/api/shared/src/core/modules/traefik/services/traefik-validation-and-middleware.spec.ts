import { Effect } from 'effect'
import { describe, expect, it } from 'vitest'

import {
    MiddlewareConfigurationInvalid,
    MiddlewareOptionsInvalid,
} from '../errors'

import { TraefikMiddlewareLibraryService } from './traefik-middleware-library.service'
import { TraefikValidationService } from './traefik-validation.service'

const library = TraefikMiddlewareLibraryService.live
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect)

describe('TraefikMiddlewareLibrary', () => {
    it('builds a rate limiter with a default burst', async () => {
        expect(
            await run(library.getRateLimiter({ name: 'rl', average: 100 }))
        ).toEqual({
            name: 'rl',
            config: { rateLimit: { average: 100, burst: 150 } },
        })
    })

    it('fails with MiddlewareOptionsInvalid when a required option is missing', async () => {
        const error = await run(
            Effect.flip(library.getRateLimiter({ name: 'rl' } as never))
        )
        expect(error).toBeInstanceOf(MiddlewareOptionsInvalid)
        expect((error as MiddlewareOptionsInvalid).missingFields).toEqual([
            'average',
        ])
    })

    it('fails with MiddlewareConfigurationInvalid for an empty user list', async () => {
        expect(
            await run(
                Effect.flip(library.getBasicAuth({ name: 'auth', users: [] }))
            )
        ).toBeInstanceOf(MiddlewareConfigurationInvalid)
    })

    it("composes a chain and propagates a member's failure", async () => {
        const chain = await run(
            library.getApiChain({
                name: 'api',
                compression: true,
                rateLimit: { average: 10 },
            })
        )
        expect(chain.middlewares.map((m) => m.name)).toEqual([
            'api-rate-limit',
            'api-compress',
        ])
        const failed = await run(
            Effect.flip(
                library.getAdminChain({
                    name: 'admin',
                    basicAuth: { users: [] },
                })
            )
        )
        expect(failed).toBeInstanceOf(MiddlewareConfigurationInvalid)
    })
})

describe('TraefikValidation', () => {
    const validate = TraefikValidationService.live.validateConfig

    it('accepts a well-formed config', () => {
        const yaml =
            'http:\n  routers:\n    r:\n      rule: Host(`a.test`)\n      service: s\n  services:\n    s:\n      loadBalancer:\n        servers:\n          - url: http://x\n'
        expect(validate(yaml)).toMatchObject({ isValid: true, errors: [] })
    })

    it('reports a router without a service and an unregistered variable', () => {
        const yaml =
            'http:\n  routers:\n    r:\n      rule: Host(`~##nope##~`)\n'
        const codes = validate(yaml).errors.map((e) => e.code)
        expect(codes).toContain('MISSING_SERVICE')
        expect(codes).toContain('UNREGISTERED_VARIABLE')
    })

    it('answers an unparsable document as an invalid result, never a throw', () => {
        expect(validate(': : :\n  - [').isValid).toBe(false)
    })
})
