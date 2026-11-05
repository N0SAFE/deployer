import { Logger } from '@nestjs/common'
import { SmartCoercionHandlerPlugin } from '@orpc/json-schema'
import { ORPCModule } from '@orpc/nest'
import { ORPCError, type DefaultInitialContext } from '@orpc/server'
import { RequestCompressionHandlerPlugin } from '@orpc/server/plugins'
import { ZodToJsonSchemaConverter } from '@orpc/zod'

import { domainErrorInterceptor } from '@deployer/effect-orpc'

import { makeInternalErrorInsightService } from '../core/middlewares/internal-error/internal-error-insight.service'
import {
    logOrpcErrors,
    transformDomainErrorToOrpcError,
} from '../core/modules/auth/orpc/index'

import type { ORPCGlobalContext } from '../core/modules/auth/orpc/orpc-context'
import type { ORPCAuthContext } from '../core/modules/auth/orpc/types'
import type { DynamicModule, ExecutionContext } from '@nestjs/common'
import type { StandardHandlerInterceptor } from '@orpc/server/standard'

/** The header a mesh peer (a service, or another agent) presents. */
export const MESH_CREDENTIAL_HEADER = 'x-mesh-credential'

/** DI token for the function that decides whether a request comes from a mesh peer. */
export const MESH_CREDENTIAL_VERIFIER = Symbol('node-agent:credential-verifier')

/** `true` when the credential proves the caller is a mesh peer. Never throws: a bad credential is an answer. */
export type MeshCredentialVerifier = (credential: string | undefined) => boolean

/**
 * A mesh request has no user session: it is authenticated by the credential, not by Better Auth, so the agent needs
 * neither the auth module nor a database. `context.auth` still exists because the shared context type has it, and it
 * is permanently anonymous, so a handler that asks for a user is refused rather than given a default.
 */
const meshAuthContext: ORPCAuthContext<false> = {
    isLoggedIn: false,
    session: null,
    user: null,
    requireAuth(): never {
        throw new ORPCError('UNAUTHORIZED', {
            message: 'A mesh peer has no user session',
        })
    },
}

type HeaderBag = { get?: (name: string) => string | null } & Record<
    string,
    unknown
>

function readCredential(headers: HeaderBag): string | undefined {
    if (typeof headers.get === 'function') {
        return headers.get(MESH_CREDENTIAL_HEADER) ?? undefined
    }
    const value = headers[MESH_CREDENTIAL_HEADER]
    return typeof value === 'string' ? value : undefined
}

/** Refuses every request that does not carry a valid mesh credential, before any handler runs. */
export function meshCredentialInterceptor(
    verify: MeshCredentialVerifier
): StandardHandlerInterceptor<DefaultInitialContext> {
    return (options) => {
        if (!verify(readCredential(options.request.headers))) {
            throw new ORPCError('UNAUTHORIZED', {
                message: 'A valid mesh credential is required',
            })
        }
        return options.next()
    }
}

type ExtraTokens = readonly (abstract new (...args: never[]) => unknown)[]
type ExtraInstances<D extends ExtraTokens> = {
    [K in keyof D]: InstanceType<D[K]>
}

export type CreateMeshOrpcModuleOptions<ExtraD extends ExtraTokens = []> = {
    /** Extra initial-context fields resolved from DI per request (the Effect context, as for every service). */
    extraContext?: {
        readonly inject: ExtraD
        readonly resolve: (
            executionContext: ExecutionContext,
            ...deps: ExtraInstances<ExtraD>
        ) => Promise<Record<string, unknown>> | Record<string, unknown>
    }
}

/**
 * The oRPC host of the node-agent: the shared transport policy of `createOrpcModule`, with the mesh credential in
 * place of Better Auth.
 *
 * ── WHAT AN IMPORTING APP MUST PROVIDE ──────────────────────────────────────
 * `MESH_CREDENTIAL_VERIFIER`. Nothing else: no `AuthModule`, no database. An agent runs on every node, including
 * before the swarm and its database exist, so its transport cannot depend on either.
 */
export function createMeshOrpcModule<ExtraD extends ExtraTokens = []>(
    options: CreateMeshOrpcModuleOptions<ExtraD> = {}
): DynamicModule {
    const extra = options.extraContext

    return ORPCModule.forRootAsync({
        useFactory: (
            verify: MeshCredentialVerifier,
            ...deps: ExtraInstances<ExtraD>
        ) => {
            const insight = makeInternalErrorInsightService()

            const context = async (
                executionContext: ExecutionContext
            ): Promise<DefaultInitialContext> => ({
                // The live request, read from the call itself: nothing here is request-scoped.
                request: executionContext.switchToHttp().getRequest<Request>(),
                auth: meshAuthContext,
                ...(extra
                    ? await extra.resolve(executionContext, ...deps)
                    : {}),
            })

            return {
                interceptors: [
                    // Outermost, so an unauthenticated request is refused before anything is parsed or logged as an error.
                    meshCredentialInterceptor(verify),
                    transformDomainErrorToOrpcError(),
                    logOrpcErrors(new Logger('ORPC Errors'), insight),
                    domainErrorInterceptor(),
                ],
                plugins: [
                    new RequestCompressionHandlerPlugin(),
                    new SmartCoercionHandlerPlugin<ORPCGlobalContext>({
                        converters: [new ZodToJsonSchemaConverter()],
                    }),
                ],
                context,
            }
        },
        inject: [MESH_CREDENTIAL_VERIFIER, ...(extra?.inject ?? [])],
    })
}
