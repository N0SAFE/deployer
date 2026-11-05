import { Logger } from '@nestjs/common'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { ORPCModule } from '@orpc/nest'
import { RequestCompressionHandlerPlugin } from '@orpc/server/plugins'
import { ZodToJsonSchemaConverter } from '@orpc/zod'
import { Context } from 'effect'

import { HttpRequest } from '@deployer/effect-core'
import { domainErrorInterceptor } from '@deployer/effect-orpc'
import { configureBoundary, type BoundaryOptions } from '@deployer/nest-effect'
import {
    configureAuthz,
    type AuthzMode,
    type DecisionEvent,
    type PermissionStore,
} from '@deployer/nest-effect/authz'

import { permissionsOfRole } from '../core/authz/role-catalog'
import { makeInternalErrorInsightService } from '../core/middlewares/internal-error/internal-error-insight.service'
import {
    logOrpcErrors,
    transformDomainErrorToOrpcError,
} from '../core/modules/auth/orpc/index'
import {
    AuthCoreService,
    type AuthCoreServiceShape,
} from '../core/modules/auth/services/auth-core.service'

import type { ORPCGlobalContext } from '../core/modules/auth/orpc/orpc-context'
import type { DynamicModule, ExecutionContext } from '@nestjs/common'
import type { DefaultInitialContext, Router } from '@orpc/server'

/**
 * The ONE oRPC configuration shared by the BFF and every service.
 *
 * ── WHAT AN IMPORTING APP MUST PROVIDE ──────────────────────────────────────
 * `AuthCoreService`. The factory below INJECTS it, so it must exist in the
 * importing app's graph — which means the app imports an auth module that provides
 * it. That requirement cannot be satisfied from inside this function: a NestJS
 * module may only export providers it owns, and `ORPCModule` does not own
 * `AuthCoreService`, so adding it to `exports` here throws
 * `UnknownExportException` at boot rather than helping.
 *
 * It is stated here, in the doc, because the failure is otherwise opaque — the
 * message names a Symbol (`ORPC_NEST_MODULE_CONFIG`) and an index, and says nothing
 * about which module was supposed to supply the service.
 *
 * ── WHY THE AUTH PLUGIN LIVES HERE, IN EVERY APP ────────────────────────────
 * The BFF is the only process that RECEIVES a browser session, but it is not the
 * only process that needs to know who the caller is: a service's handler reads
 * `context.auth`, and services are separate processes. The plugin resolves the
 * session from the request, and a service receives the BFF's forwarded request — so
 * binding the same plugin everywhere means `context.auth` means the same thing on
 * both sides of the boundary, with no special case in a handler.
 *
 * ── WHY `interceptors` AND NOT `sendResponseInterceptors` ───────────────────
 * oRPC v2 renamed it. The old key is silently ignored (it is not on the config type,
 * and excess-property checking does not fire on this literal), which degrades every
 * domain error to a generic 500 with no warning — the rename is load-bearing, not
 * cosmetic.
 */
/** DI tokens an app may contribute to the per-request oRPC context. */
type ExtraTokens = readonly (abstract new (...args: never[]) => unknown)[]

/**
 * The value a token provides.
 *
 * An Effect `Context.Service` class is BOTH the Nest token and a service key: Nest is handed the class, but what it
 * injects is the service SHAPE (`EffectHost` provides `EffectHostShape` — `yield* EffectHost` yields the shape, not the
 * class). `InstanceType` was the wrong reading: the class's instance type carries the tag metadata, not the shape, so
 * every `host.someMethod()` in a resolver was `any`.
 */
type ProvidedBy<T> = T extends Context.Service.Any
    ? Context.Service.Shape<T>
    : InstanceType<T & ExtraToken>

/** A plain Nest class token. */
type ExtraToken = abstract new (...args: never[]) => unknown

/** The injected instances, in the same order as `inject`. */
type ExtraInstances<D extends ExtraTokens> = {
    [K in keyof D]: ProvidedBy<D[K]>
}

type ExtraContext<D extends ExtraTokens> = {
    readonly inject: D
    readonly resolve: (
        executionContext: ExecutionContext,
        ...deps: ExtraInstances<D>
    ) => Promise<Record<string, unknown>> | Record<string, unknown>
}

/**
 * Where the gate's capabilities come from.
 *
 * PLATFORM scope reads the process snapshot (`SEC-055`), which is the `roles` TABLE — so a custom role works, and a role
 * deleted while its holders still carry the name grants nothing.
 *
 * PROJECT scope answers NOTHING on purpose (`SEC-059`): membership lives in `project_collaborators`, owned by the project
 * service, and this process cannot see it. A project-scoped declaration under `enforce` is therefore a denial — which is
 * the fail-closed direction and the reason project-scoped routes stay with their owning service, whose handlers check
 * membership against the data they actually have. Wiring a mesh call in here would put a network round-trip (and a second
 * authority) inside every request.
 */
export function roleTableStore(): PermissionStore {
    return {
        capabilities: (actor, scope) =>
            Promise.resolve(
                scope.kind === 'platform'
                    ? {
                          permissions: permissionsOfRole(actor.role),
                          sources: [`role ${actor.role}`],
                      }
                    : { permissions: [], sources: [] }
            ),
    }
}

/** `AUTHZ_MODE=off|shadow|enforce`; anything else is `off` with one warning, so a typo cannot lock the platform out. */
function authzFromEnv(): Parameters<typeof configureAuthz>[0] {
    const raw = process.env.AUTHZ_MODE?.trim().toLowerCase()
    if (raw === undefined || raw === '' || raw === 'off') return null
    if (raw !== 'shadow' && raw !== 'enforce') {
        console.warn(
            `[authz] AUTHZ_MODE="${raw}" is not off|shadow|enforce; authorization stays off`
        )
        return null
    }
    const mode: AuthzMode = raw
    return {
        store: roleTableStore(),
        mode,
        // Shadow mode is only useful if the would-denies are visible: one line per refusal, no payload.
        onDecision: (event: DecisionEvent) => {
            if (event.decision.allowed) return
            console.debug(
                `[authz] would deny ${event.decision.permission} on ${event.decision.scope.kind}` +
                    (event.decision.scope.id === undefined
                        ? ''
                        : `:${event.decision.scope.id}`) +
                    ` for ${event.actor?.id ?? 'anonymous'} (${event.decision.reason})${event.mode === 'enforce' ? '' : ' [shadow]'}`
            )
        },
    }
}

export type CreateOrpcModuleOptions<ExtraD extends ExtraTokens = []> = {
    /**
     * Extra initial-context fields resolved from DI per request.
     *
     * Used by an app that needs runtime-backed context (for example
     * `'effect/context'`). `inject` feeds `resolve`; both are opt-in, so the
     * default transport policy stays identical for every other service.
     *
     * `inject` is a tuple, so `resolve` receives the injected instances as typed
     * parameters — no cast at the call site.
     */
    extraContext?: ExtraContext<ExtraD>
    /**
     * The request boundary of this app's `.effect()` handlers: defect log prefix, whether non-domain typed failures reach
     * the host's interceptors, and where refusals are reported. Controllers wrap nothing themselves.
     */
    boundary?: BoundaryOptions
}

export function createOrpcModule<ExtraD extends ExtraTokens = []>(
    options: CreateOrpcModuleOptions<ExtraD> = {}
): DynamicModule {
    const extra = options.extraContext

    // Authorization is configured once, here, so every `.effect()` procedure in the app gets the gate from `procedure()`
    // without a controller remembering to apply it. `shadow` evaluates and logs without refusing (the rollout mode from
    // PERMISSIONS-ROADMAP.md); `enforce` refuses; unset/`off` installs nothing and leaves the app byte-identical.
    configureAuthz(authzFromEnv())
    if (options.boundary !== undefined) configureBoundary(options.boundary)

    return ORPCModule.forRootAsync({
        useFactory: (
            authCoreService: AuthCoreServiceShape,
            ...deps: ExtraInstances<ExtraD>
        ) => {
            const emptyAuthUtils = authCoreService.createEmptyAuthUtils()
            const internalErrorInsightService =
                makeInternalErrorInsightService()

            /**
             * The app owns the extra keys (e.g. `effect/context`); shared cannot
             * type them, so the assembled object is asserted once here. Apps that
             * augment `DefaultInitialContext` provide the matching `extraContext`.
             */
            /**
             * A function, not an object: `@orpc/nest` evaluates `config.context` for every request, so the
             * Effect context is read from the runtime then, over the finished container. Computed here
             * (this factory runs once, while routes are being registered) it was a snapshot taken before
             * every provider existed.
             */
            const context = async (
                executionContext: ExecutionContext
            ): Promise<DefaultInitialContext> => {
                // The live request, read from the call itself: nothing here is request-scoped, so the host is a singleton.
                const request = executionContext
                    .switchToHttp()
                    .getRequest<Request>()
                const resolved = extra
                    ? await extra.resolve(executionContext, ...deps)
                    : {}
                const effectContext = (
                    resolved as {
                        readonly 'effect/context'?: Context.Context<unknown>
                    }
                )['effect/context']

                return {
                    request,
                    auth: emptyAuthUtils,
                    ...resolved,
                    // The request itself, added to the Effect context ONCE, here (`AUTH-0xx`): every `.effect()` body can then
                    // `yield* HttpRequest` without its module providing it, and two requests cannot see each other's — the
                    // context is immutable and rebuilt per call, so nothing request-scoped is ever cached or shared.
                    ...(effectContext === undefined
                        ? {}
                        : {
                              'effect/context': Context.add(
                                  effectContext,
                                  HttpRequest,
                                  {
                                      headers: request.headers,
                                      method: request.method,
                                      url: request.url,
                                  }
                              ),
                          }),
                }
            }

            return {
                interceptors: [
                    transformDomainErrorToOrpcError(),
                    logOrpcErrors(
                        new Logger('ORPC Errors'),
                        internalErrorInsightService
                    ),
                    // Innermost, so a thrown `DomainError` (Promise-based services) is already its oRPC error
                    // by kind when the translation and logging interceptors above see it.
                    domainErrorInterceptor(),
                ],
                plugins: [
                    // Request compression is symmetric with the web app's
                    // RequestCompressionLinkPlugin; both default to a 1 KB threshold so
                    // small payloads are never inflated.
                    new RequestCompressionHandlerPlugin(),
                    // ── NO RESPONSE COMPRESSION. IT BREAKS THE SERVICE-TO-SERVICE LEG ──
                    //
                    // `ResponseCompressionHandlerPlugin({ encodings: ["gzip"] })` was here,
                    // and it made every analytics endpoint whose payload exceeded 1 KB
                    // fail through the BFF:
                    //
                    //   GET /analytics/metrics/realtime    → 200 (290 B, no compression)
                    //   GET /analytics/metrics/database    → 200 (76 B,  no compression)
                    //   GET /analytics/metrics/resources   → 500 "Output validation failed"
                    //   GET /analytics/metrics/deployments → 500 "Output validation failed"
                    //
                    // Measured, not inferred — the same response with and without gzip:
                    //
                    //   default           getResourceMetrics  STREAM
                    //   accept-encoding: identity            OBJECT keys=[data,timeRange,…]
                    //
                    //   resources    status=200 content-length=null transfer-encoding=chunked content-encoding=gzip
                    //   realtime     status=200 content-length=290  transfer-encoding=null    content-encoding=null
                    //
                    // The mechanism is `content-length`, not encoding: oRPC returns a
                    // `ReadableStream` for any response it cannot size eagerly, and the
                    // client hands that stream straight to the output schema. So
                    //
                    //   ✖ Invalid input: expected array, received undefined   → at data
                    //   ✖ Invalid input: expected string, received undefined  → at timeRange
                    //   ✖ Invalid input: expected string, received undefined  → at granularity
                    //
                    // — the schema validating a stream. `ResponseCompressionLinkPlugin` on
                    // the client does NOT help (measured: still STREAM), because the body is
                    // still chunked after decompression.
                    //
                    // The browser leg is unaffected either way (fetch decompresses and the
                    // web app never sees the stream), and these payloads are single-digit
                    // kilobytes over a local bridge — compression buys nothing worth a
                    // contract that fails validation on size.
                    new SmartCoercionHandlerPlugin<ORPCGlobalContext>({
                        converters: [new ZodToJsonSchemaConverter()],
                    }),
                ],
                // Initial context: `auth` starts anonymous; `requireAuth()` / `publicAccess()` resolve the session (an Effect, through
                // `SessionResolver`) when a procedure asks for it.
                // `extraContext` is resolved per request (e.g. the Effect runtime).
                context,
            }
        },
        inject: [AuthCoreService, ...(extra?.inject ?? [])],
    })
}

/** The router type every app's composed contract satisfies. */
export type ApiRouter = Router<ORPCGlobalContext>
