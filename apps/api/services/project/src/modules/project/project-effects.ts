import { HttpException } from '@nestjs/common'
import { Effect } from 'effect'
import { ZodError } from 'zod/v4'

import {
    BadRequestError,
    ForbiddenError,
    ValidationError,
} from '@deployer/errors'
import type { RuntimeConfigurationInvalid } from '@deployer/shared/core/modules/configuration/configuration.errors'
import {
    DomainAlreadyExistsError,
    DomainNotVerifiedError,
    InvalidBasePathFormatError,
    InvalidSubdomainFormatError,
    ProjectDomainNotFoundError,
    ServiceDomainMappingNotFoundError,
    ServiceMappingMismatchError,
    SubdomainConflictError,
    SubdomainNotAllowedError,
} from '@deployer/shared/core/modules/domain/errors/index'

import {
    ProjectConflict,
    ProjectForbidden,
    ProjectInvalid,
    ResourceMissing,
} from './domain/project.errors'
import { ProjectInfraFailure } from './project.failures'

/** What a promise-shaped collaborator can refuse with, in domain terms. */
export type AttemptFailure =
    | ProjectInfraFailure
    | ResourceMissing
    | ProjectForbidden
    | ProjectInvalid
    | ProjectConflict

/**
 * Lift a Promise-returning call.
 *
 * Shared platform services are still promise-shaped and refuse with Nest exceptions or their own domain error classes (`ProjectAccessService`
 * throws `NotFoundException` for a missing project): the four statuses a client can act on become the matching
 * domain failure. Any other rejection is an infrastructure failure.
 */
export function attempt<A>(
    run: () => Promise<A>
): Effect.Effect<A, AttemptFailure> {
    return Effect.tryPromise({
        try: run,
        catch: (cause): AttemptFailure => toFailure(cause),
    })
}

/** Lift an Effect from a shared service: its tagged failures become this service's domain failures. */
export function refuse<A, E, R>(
    effect: Effect.Effect<A, E, R>
): Effect.Effect<A, AttemptFailure, R> {
    return Effect.mapError(effect, (cause): AttemptFailure => toFailure(cause))
}

/**
 * Translate a refusal from a promise-shaped collaborator (a Nest exception, or one of the shared
 * domain error classes) into this service's domain failure; anything else is infrastructure.
 */
export function toFailure(cause: unknown): AttemptFailure {
    // The shared domain services refuse with their own error classes.
    if (
        cause instanceof ProjectDomainNotFoundError ||
        cause instanceof ServiceDomainMappingNotFoundError
    ) {
        return new ResourceMissing({ reason: cause.message })
    }
    if (
        cause instanceof DomainAlreadyExistsError ||
        cause instanceof SubdomainConflictError
    ) {
        return new ProjectConflict({ reason: cause.message })
    }
    if (
        cause instanceof DomainNotVerifiedError ||
        cause instanceof ServiceMappingMismatchError ||
        cause instanceof SubdomainNotAllowedError ||
        cause instanceof InvalidSubdomainFormatError ||
        cause instanceof InvalidBasePathFormatError
    ) {
        return new ProjectInvalid({ reason: cause.message })
    }
    if (cause instanceof HttpException) {
        const reason = cause.message
        switch (cause.getStatus()) {
            case 400:
                return new ProjectInvalid({ reason })
            case 403:
                return new ProjectForbidden({ reason })
            case 404:
                return new ResourceMissing({ reason })
            case 409:
                return new ProjectConflict({ reason })
        }
    }
    return new ProjectInfraFailure({ cause })
}

/**
 * Lift a synchronous rule or parse into the Effect error channel.
 *
 * The rules throw `@deployer/errors` classes and the parsers throw `ZodError`: the known refusals
 * become the project domain's tagged failures, anything else is a defect (a bug, not a refusal).
 */
export function rule<A>(
    run: () => A
): Effect.Effect<A, ProjectForbidden | ProjectInvalid> {
    return Effect.suspend(
        (): Effect.Effect<A, ProjectForbidden | ProjectInvalid> => {
            try {
                return Effect.succeed(run())
            } catch (error) {
                if (error instanceof ForbiddenError)
                    return Effect.fail(
                        new ProjectForbidden({ reason: error.message })
                    )
                if (
                    error instanceof ValidationError ||
                    error instanceof BadRequestError ||
                    error instanceof ZodError
                ) {
                    return Effect.fail(
                        new ProjectInvalid({ reason: error.message })
                    )
                }
                return Effect.die(error)
            }
        }
    )
}

/** A runtime configuration that does not resolve is the caller's invalid input: the project domain's refusal. */
export function configurationRule<A>(
    resolution: Effect.Effect<A, RuntimeConfigurationInvalid>
): Effect.Effect<A, ProjectInvalid> {
    return resolution.pipe(
        Effect.mapError(
            (error) => new ProjectInvalid({ reason: error.publicMessage() })
        )
    )
}
