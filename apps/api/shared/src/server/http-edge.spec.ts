import express from 'express'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppError } from '@deployer/errors'

import { MODULE_OPTIONS_TOKEN } from '../core/modules/auth/definitions/auth-module-definition'

import {
    betterAuthBasePath,
    betterAuthEdge,
    containerHttpEdge,
    mountHttpEdge,
} from './http-edge'

import type { AuthModuleOptions } from '../core/modules/auth/definitions/auth-module-definition'
import type { INestApplication } from '@nestjs/common'
import type { AddressInfo } from 'node:net'

/**
 * The HTTP edge, through a real Express server and Better Auth's REAL Node adapter (`better-auth/node`), with a fake
 * Better Auth that echoes the path it was asked for. What these pin is the mount semantics that used to be Nest's
 * `forRoutes`: the handler owns its `basePath` AND everything under it, the other routes get body parsing, and the order is
 * CORS → handler → body parsing.
 */
const fakeAuth = (options: Record<string, unknown>) =>
    ({
        handler: (request: Request) =>
            Promise.resolve(
                Response.json({ path: new URL(request.url).pathname })
            ),
        options,
    }) as unknown as AuthModuleOptions['auth']

const optionsOf = (
    auth: AuthModuleOptions['auth'],
    extra: Partial<AuthModuleOptions> = {}
): AuthModuleOptions => ({ auth, ...extra })

const servers: { close: () => void }[] = []
afterEach(() => {
    servers.splice(0).forEach((server) => {
        server.close()
    })
})

async function serve(entries: ReturnType<typeof betterAuthEdge>) {
    const app = express()
    const enableCors = vi.fn()
    const nest = {
        use: (...args: Parameters<typeof app.use>) => app.use(...args),
        enableCors,
    } as unknown as INestApplication

    mountHttpEdge(nest, entries)
    app.post('/echo', (req, res) => {
        res.json({ body: req.body as unknown })
    })
    app.get('/other', (_req, res) => {
        res.json({ ok: true })
    })

    const server = app.listen(0)
    servers.push(server)
    await new Promise<void>((listening) => {
        server.once('listening', () => {
            listening()
        })
    })
    const { port } = server.address() as AddressInfo
    return {
        url: (path: string) => `http://127.0.0.1:${String(port)}${path}`,
        enableCors,
    }
}

describe('betterAuthBasePath', () => {
    it('defaults to /api/auth and normalises slashes', () => {
        expect(betterAuthBasePath(fakeAuth({}))).toBe('/api/auth')
        expect(betterAuthBasePath(fakeAuth({ basePath: 'auth/' }))).toBe(
            '/auth'
        )
        expect(betterAuthBasePath(fakeAuth({ basePath: '/x/y' }))).toBe('/x/y')
    })
})

describe('betterAuthEdge', () => {
    it('lists its pieces in order: CORS, handler, body parsing', () => {
        const entries = betterAuthEdge(
            optionsOf(fakeAuth({ trustedOrigins: ['https://app.test'] }))
        )
        expect(entries.map((entry) => entry.name)).toEqual([
            'better-auth-cors',
            'better-auth',
            'body-parsing',
        ])
    })

    it("omits CORS without trusted origins, and body parsing when Nest's own is on", () => {
        expect(
            betterAuthEdge(optionsOf(fakeAuth({}))).map((entry) => entry.name)
        ).toEqual(['better-auth', 'body-parsing'])
        expect(
            betterAuthEdge(
                optionsOf(fakeAuth({ trustedOrigins: ['x'] }), {
                    disableTrustedOriginsCors: true,
                    disableBodyParser: true,
                })
            ).map((entry) => entry.name)
        ).toEqual(['better-auth'])
    })

    it('refuses function-based trustedOrigins at boot, with the config error', () => {
        const build = () =>
            betterAuthEdge(optionsOf(fakeAuth({ trustedOrigins: () => ['x'] })))
        expect(build).toThrow(AppError)
        expect(build).toThrow(/Function-based trustedOrigins/)
    })

    it('accepts function-based trustedOrigins when CORS is disabled', () => {
        expect(() =>
            betterAuthEdge(
                optionsOf(fakeAuth({ trustedOrigins: () => ['x'] }), {
                    disableTrustedOriginsCors: true,
                })
            )
        ).not.toThrow()
    })

    it('hands the handler its basePath AND everything under it, with the full path', async () => {
        const { url } = await serve(
            betterAuthEdge(optionsOf(fakeAuth({ basePath: '/api/auth' })))
        )

        expect(
            await (await fetch(url('/api/auth/sign-in/email'))).json()
        ).toEqual({ path: '/api/auth/sign-in/email' })
        expect(await (await fetch(url('/api/auth'))).json()).toEqual({
            path: '/api/auth',
        })
    })

    it('leaves other routes to the app, and parses their body', async () => {
        const { url } = await serve(betterAuthEdge(optionsOf(fakeAuth({}))))

        expect(await (await fetch(url('/other'))).json()).toEqual({ ok: true })
        const echoed = await fetch(url('/echo'), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ a: 1 }),
        })
        expect(await echoed.json()).toEqual({ body: { a: 1 } })
    })

    it('configures CORS for the trusted origins through the app', async () => {
        const { enableCors } = await serve(
            betterAuthEdge(
                optionsOf(fakeAuth({ trustedOrigins: ['https://app.test'] }))
            )
        )
        expect(enableCors).toHaveBeenCalledWith(
            expect.objectContaining({
                origin: ['https://app.test'],
                credentials: true,
            })
        )
    })
})

describe('containerHttpEdge', () => {
    /** A container as `ModulesContainer` shows it: modules → providers → wrappers. */
    const appWith = (providers: [unknown, unknown][]) => {
        const module = {
            providers: new Map(
                providers.map(([token, instance]) => [token, { instance }])
            ),
        }
        return {
            get: () => new Map([['m', module]]),
        } as unknown as INestApplication
    }

    it('mounts Better Auth when the container holds the auth options', () => {
        const entries = containerHttpEdge(
            appWith([[MODULE_OPTIONS_TOKEN, optionsOf(fakeAuth({}))]])
        )
        expect(entries.map((entry) => entry.name)).toContain('better-auth')
    })

    it('is empty for an app that never imported AuthModule — and does not touch `app.get(token)`', () => {
        expect(containerHttpEdge(appWith([['something-else', {}]]))).toEqual([])
    })

    it('ignores a provider that exists but has no instance yet', () => {
        expect(
            containerHttpEdge(appWith([[MODULE_OPTIONS_TOKEN, undefined]]))
        ).toEqual([])
    })
})
