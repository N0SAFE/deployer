import { ModulesContainer } from '@nestjs/core'
import { toNodeHandler } from 'better-auth/node'

import { AppError } from '@deployer/errors'
import { logger } from '@deployer/logger'

import {
    MODULE_OPTIONS_TOKEN,
    type AuthModuleOptions,
} from '../core/modules/auth/definitions/auth-module-definition'
import { SkipBodyParsingMiddleware } from '../core/modules/auth/middlewares/middlewares'

import type { INestApplication } from '@nestjs/common'
import type { RequestHandler } from 'express'

/**
 * The HTTP edge: what runs on a request BEFORE oRPC, as plain functions mounted from one place.
 *
 * Nothing here is a Nest role. There is no `NestMiddleware`, no `MiddlewareConsumer`, no `configure(consumer)` and no
 * decorator: an edge piece is a function `(req, res, next)` (or a tiny function that mounts one), named, listed in order, and
 * mounted by `mountHttpEdge` between Nest's `create()` and `init()` — so it runs before the router, exactly where Nest's own
 * middleware ran, but readable in one screen instead of scattered across modules' `configure()` methods.
 *
 * What belongs here: things that are HTTP and not procedures (Better Auth's own routes, body parsing, a credentials context for
 * the BFF's fan-out). What does NOT: who may call a procedure (`access()` + `authzGate`), input validation (the contract's
 * schema), error mapping (`domainError`) — see `docs/architecture/effect-orpc-conventions.md`.
 */
export interface HttpEdgeEntry {
    /** Shown in the boot log, so a missing or misordered piece is visible. */
    readonly name: string
    readonly mount: (app: INestApplication) => void
}

/** An edge piece for every route. */
export function edgeUse(name: string, handler: RequestHandler): HttpEdgeEntry {
    return {
        name,
        mount: (app) => {
            app.use(handler)
        },
    }
}

/** An edge piece for a path prefix: the path and everything under it. */
export function edgeAt(
    name: string,
    path: string,
    handler: RequestHandler
): HttpEdgeEntry {
    return {
        name,
        mount: (app) => {
            app.use(path, handler)
        },
    }
}

/** Mount the entries in order. Order is load-bearing: CORS answers before the auth handler, which ends the response. */
export function mountHttpEdge(
    app: INestApplication,
    entries: readonly HttpEdgeEntry[]
): void {
    for (const entry of entries) entry.mount(app)
    if (entries.length > 0) {
        logger
            .scope('http-edge')
            .debug(`mounted: ${entries.map((entry) => entry.name).join(', ')}`)
    }
}

/** `/api/auth`, normalised: a leading slash, no trailing one. */
export function betterAuthBasePath(auth: AuthModuleOptions['auth']): string {
    const configured =
        'basePath' in auth.options && typeof auth.options.basePath === 'string'
            ? auth.options.basePath
            : '/api/auth'
    const withLeadingSlash = configured.startsWith('/')
        ? configured
        : `/${configured}`
    return withLeadingSlash.endsWith('/')
        ? withLeadingSlash.slice(0, -1)
        : withLeadingSlash
}

/**
 * Better Auth's own endpoints (sign-in/out, passkey, 2FA, API keys), mounted explicitly at its `basePath`.
 *
 * There is NO authorization here and no global guard: Better Auth answers its own routes, and every authorization decision on
 * OUR endpoints is a declaration on the oRPC procedure (`requireAuth()`, `access({ permission })`). A second gate installed
 * globally could only disagree with the first.
 *
 * Three pieces, in this order: CORS for the configured trusted origins, the handler (which ends the response), and body
 * parsing for every OTHER route (Better Auth needs the raw body, so its path is skipped).
 */
export function betterAuthEdge(options: AuthModuleOptions): HttpEdgeEntry[] {
    const basePath = betterAuthBasePath(options.auth)
    const entries: HttpEdgeEntry[] = []

    const trustedOrigins =
        'trustedOrigins' in options.auth.options
            ? options.auth.options.trustedOrigins
            : null
    // A function-based `trustedOrigins` needs a web `Request` to evaluate; Express hands us a Node request.
    const isStatic = Array.isArray(trustedOrigins)

    if (!options.disableTrustedOriginsCors) {
        if (trustedOrigins && !isStatic) {
            throw new AppError(
                'Function-based trustedOrigins not supported in NestJS. Use string array or disable CORS with disableTrustedOriginsCors: true.',
                'AUTH_CONFIG_ERROR'
            )
        }
        if (trustedOrigins && isStatic) {
            entries.push({
                name: 'better-auth-cors',
                mount: (app) => {
                    app.enableCors({
                        origin: trustedOrigins,
                        methods: ['GET', 'POST', 'PUT', 'DELETE'],
                        credentials: true,
                        allowedHeaders: [
                            'Content-Type',
                            'Authorization',
                            'Cookie',
                        ],
                        exposedHeaders: ['Set-Cookie'],
                    })
                },
            })
        }
    }

    entries.push(edgeAt('better-auth', basePath, toNodeHandler(options.auth)))
    // Only when Nest's own body parser is off (every app runs `bodyParser: false`): someone has to parse the other routes.
    if (!options.disableBodyParser)
        entries.push(
            edgeUse('body-parsing', SkipBodyParsingMiddleware(basePath))
        )
    return entries
}

/**
 * The instance behind a provider token, or `undefined` when no module provides it.
 *
 * `app.get(token)` is NOT usable for "is it there?": Nest runs it in an exception zone that LOGS and calls `process.exit(1)`
 * for an unknown token, so there is nothing to catch. The modules container is a plain map: reading it cannot fail.
 */
function providerOf<T>(app: INestApplication, token: unknown): T | undefined {
    for (const module of app
        .get(ModulesContainer, { strict: false })
        .values()) {
        const wrapper = module.providers.get(token as never)
        if (wrapper?.instance !== undefined && wrapper.instance !== null)
            return wrapper.instance as T
    }
    return undefined
}

/**
 * The edge every app gets from what its container holds, so a service needs no wiring to have it: an app that imported
 * `AuthModule` gets Better Auth's routes; one that did not, gets nothing.
 */
export function containerHttpEdge(app: INestApplication): HttpEdgeEntry[] {
    const auth = providerOf<AuthModuleOptions>(app, MODULE_OPTIONS_TOKEN)
    return auth === undefined ? [] : betterAuthEdge(auth)
}
