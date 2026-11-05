import { randomUUID } from 'node:crypto'

import { Logger } from '@nestjs/common'
import { ORPCError } from '@orpc/server'
import { APIError } from 'better-auth/api'

import { MeshBaseDomainError } from '../../modules/mesh/shared/domain/mesh-base-error'

import {
    getInternalErrorRequestContext,
    type InternalErrorRequestContext,
} from './internal-error-context'

import type { Request } from 'express'

export type InternalErrorInsightModule = {
    readonly id: string
    supports(error: unknown): boolean
    describe(error: unknown): Record<string, unknown>
}

export type InternalErrorCaptureOptions = {
    source: 'orpc' | 'better-auth' | 'mesh-domain' | 'unknown'
    request?: Request
}

export type InternalErrorCaptureResult = {
    traceId: string
    requestId?: string
}

export type InternalErrorInsightServiceShape = {
    /** Adds (or replaces, by id) a module that knows how to describe one family of errors. */
    readonly registerModule: (module: InternalErrorInsightModule) => void
    /** Logs the error with everything the modules know about it, and answers the trace id a client can quote. */
    readonly capture: (
        error: unknown,
        options: InternalErrorCaptureOptions
    ) => InternalErrorCaptureResult
    readonly shouldExposeDebugPayload: () => boolean
    readonly buildClientDebugPayload: (
        error: unknown
    ) => Record<string, unknown>
}

/** A registry of error describers, built by the HTTP/oRPC host that owns the request boundary (it logs through Nest's logger, a sync edge). */
export function makeInternalErrorInsightService(): InternalErrorInsightServiceShape {
    const logger = new Logger('InternalErrorInsightService')
    const modules = new Map<string, InternalErrorInsightModule>()
    const includeStackInLogs = process.env.NODE_ENV !== 'production'

    const registerModule = (module: InternalErrorInsightModule): void => {
        modules.set(module.id, module)
    }

    const capture = (
        error: unknown,
        options: InternalErrorCaptureOptions
    ): InternalErrorCaptureResult => {
        const traceId = randomUUID()
        const requestContext = options.request
            ? getInternalErrorRequestContext(options.request)
            : undefined

        const applicableModules = [...modules.values()].filter((module) =>
            module.supports(error)
        )
        const selectedModules =
            applicableModules.length > 0
                ? applicableModules
                : [createFallbackModule()]

        const insightPayload = {
            traceId,
            source: options.source,
            request: buildRequestPayload(requestContext),
            error: buildBaseErrorPayload(error),
            modules: selectedModules.map((module) => ({
                module: module.id,
                details: module.describe(error),
            })),
        }

        const stack =
            includeStackInLogs && error instanceof Error
                ? error.stack
                : undefined
        logger.error(
            `Captured internal error: ${safeStringify(insightPayload)}`,
            stack
        )

        return {
            traceId,
            requestId: requestContext?.requestId,
        }
    }

    const shouldExposeDebugPayload = (): boolean => {
        return includeStackInLogs
    }

    const buildClientDebugPayload = (
        error: unknown
    ): Record<string, unknown> => {
        return {
            name: error instanceof Error ? error.name : 'UnknownError',
            message: error instanceof Error ? error.message : 'Unknown error',
            stack:
                includeStackInLogs && error instanceof Error
                    ? error.stack
                    : undefined,
        }
    }

    registerModule(createOrpcModule())
    registerModule(createBetterAuthModule())
    registerModule(createMeshDomainModule())
    registerModule(createFallbackModule())

    return {
        registerModule,
        capture,
        shouldExposeDebugPayload,
        buildClientDebugPayload,
    }
}

function buildRequestPayload(
    context: InternalErrorRequestContext | undefined
): Record<string, unknown> | undefined {
    if (!context) {
        return undefined
    }

    return {
        requestId: context.requestId,
        method: context.method,
        path: context.path,
        ip: context.ip,
        userAgent: context.userAgent,
    }
}

function buildBaseErrorPayload(error: unknown): Record<string, unknown> {
    if (error instanceof Error) {
        return {
            name: error.name,
            message: error.message,
        }
    }

    return {
        name: 'NonErrorThrownValue',
        value: safeStringify(error),
    }
}

function safeStringify(value: unknown): string {
    try {
        return JSON.stringify(value)
    } catch {
        return '[unserializable]'
    }
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

function getStringProperty(value: unknown, key: string): string | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    const property = value[key]
    return typeof property === 'string' ? property : undefined
}

function getNumberProperty(value: unknown, key: string): number | undefined {
    if (!isRecord(value)) {
        return undefined
    }

    const property = value[key]
    return typeof property === 'number' ? property : undefined
}

function getUnknownProperty(value: unknown, key: string): unknown {
    if (!isRecord(value)) {
        return undefined
    }

    return value[key]
}

function createOrpcModule(): InternalErrorInsightModule {
    return {
        id: 'orpc',
        supports: (error: unknown) => {
            if (error instanceof ORPCError) {
                return true
            }

            if (!isRecord(error)) {
                return false
            }

            return (
                getStringProperty(error, 'code') !== undefined &&
                getNumberProperty(error, 'status') !== undefined
            )
        },
        describe: (error: unknown) => {
            const code = getStringProperty(error, 'code')
            const status = getNumberProperty(error, 'status')
            const message = getStringProperty(error, 'message')
            const cause = getUnknownProperty(error, 'cause')

            return {
                code,
                status,
                message,
                causeName: cause instanceof Error ? cause.name : undefined,
            }
        },
    }
}

function createBetterAuthModule(): InternalErrorInsightModule {
    return {
        id: 'better-auth',
        supports: (error: unknown) => error instanceof APIError,
        describe: (error: unknown) => {
            const apiError = error as APIError

            return {
                statusCode: apiError.statusCode,
                message: apiError.body?.message,
                body: apiError.body,
            }
        },
    }
}

function createMeshDomainModule(): InternalErrorInsightModule {
    // ── WHY THIS IS NOW A STATIC IMPORT ─────────────────────────────────────
    // It used to be a lazy `require("../../modules/mesh/shared/domain/mesh-base-error")`,
    // justified in a comment by a circular-import risk. Two things were wrong with
    // that, and both cost a real outage:
    //
    //  1. The path was ALIASED. Aliases — vitest's `resolve.alias` and tsconfig
    //     `paths` alike — are applied by the TRANSFORMER to `import` specifiers
    //     only. A `require("…")` argument is a runtime string nothing rewrites, so
    //     `@/core/…` was handed to Node verbatim. It worked only while `@/core`
    //     meant `./src/core`; when `src/core` moved to `shared/src/core` the app
    //     stopped compiling with `Cannot find module '../../modules/mesh/…'`.
    //
    //  2. The cycle it avoided does not exist. `mesh-base-error.ts` has ZERO
    //     imports — it is a self-contained `Error` subclass. A static import of it
    //     cannot close a cycle, because there is no edge back to this file. (The
    //     cycle the comment described is between the FILTER and the mesh module;
    //     this file only ever needed the base error CLASS.)
    //
    // A static import is therefore both correct and strictly more robust: it is
    // resolved at build time, type-checked, and renamed/relocated by tooling.
    return {
        id: 'mesh-domain',
        supports: (error: unknown) => error instanceof MeshBaseDomainError,
        describe: (error: unknown) => {
            if (error instanceof MeshBaseDomainError) {
                return {
                    code: error.code,
                    httpStatus: error.httpStatus,
                    orpcCode: error.orpcCode,
                    message: error.message,
                }
            }
            return {}
        },
    }
}

function createFallbackModule(): InternalErrorInsightModule {
    return {
        id: 'fallback',
        supports: () => true,
        describe: (error: unknown) => {
            if (error instanceof Error) {
                return {
                    name: error.name,
                    message: error.message,
                }
            }

            return {
                value: safeStringify(error),
            }
        },
    }
}
