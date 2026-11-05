import { and, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { ProjectRole } from '@deployer/auth'
import type { DatabaseHandleShape } from '@deployer/database'
import { domainError } from '@deployer/effect-core'
import {
    projectCollaborators,
    projects,
} from '@deployer/nest-schema/global/project/deployment'

import type { GlobalDatabase } from '../../database/services/global-database.service'

/** The project row an access check needs: who owns it, and that it exists. */
export type ProjectAccessProject = {
    readonly id: string
    readonly ownerId: string
}

/** The query itself failed — a database that is not initialized, or a driver error. */
export class ProjectAccessQueryFailed extends domainError(
    'ProjectAccessQueryFailed',
    'dependency_missing'
)<{
    readonly message: string
    readonly cause?: unknown
}>() {
    override publicMessage() {
        return this.message
    }
}

export type ProjectAccessRepositoryShape = {
    readonly findProjectById: (
        projectId: string
    ) => Effect.Effect<ProjectAccessProject | null, ProjectAccessQueryFailed>
    readonly findCollaboratorByUserAndProject: (
        userId: string,
        projectId: string
    ) => Effect.Effect<
        { readonly role: ProjectRole } | null,
        ProjectAccessQueryFailed
    >
}

/**
 * The project ownership and collaborator lookups an access check needs.
 *
 * The connection is the constructor argument (the Effect handle, not the Nest service that owns it), so every query
 * reads the CURRENT connection: the global pool is a placeholder at boot and is initialised later, and a repository
 * that captured the driver once would answer from a closed one.
 */
export class ProjectAccessRepository extends Context.Service<
    ProjectAccessRepository,
    ProjectAccessRepositoryShape
>()('shared/ProjectAccessRepository') {
    static readonly live = class ProjectAccessRepositoryImpl implements ProjectAccessRepositoryShape {
        constructor(
            private readonly handle: DatabaseHandleShape<GlobalDatabase>
        ) {}

        findProjectById(
            projectId: string
        ): Effect.Effect<
            ProjectAccessProject | null,
            ProjectAccessQueryFailed
        > {
            const handle = this.handle
            return Effect.gen(function* () {
                const db = yield* handle.db.pipe(
                    Effect.mapError(toQueryFailure)
                )
                const rows = yield* attempt('findProjectById', () =>
                    db
                        .select({ id: projects.id, ownerId: projects.ownerId })
                        .from(projects)
                        .where(eq(projects.id, projectId))
                        .limit(1)
                )
                const [project] = rows
                return project ?? null
            })
        }

        findCollaboratorByUserAndProject(
            userId: string,
            projectId: string
        ): Effect.Effect<
            { readonly role: ProjectRole } | null,
            ProjectAccessQueryFailed
        > {
            const handle = this.handle
            return Effect.gen(function* () {
                const db = yield* handle.db.pipe(
                    Effect.mapError(toQueryFailure)
                )
                const rows = yield* attempt(
                    'findCollaboratorByUserAndProject',
                    () =>
                        db
                            .select({ role: projectCollaborators.role })
                            .from(projectCollaborators)
                            .where(
                                and(
                                    eq(projectCollaborators.userId, userId),
                                    eq(
                                        projectCollaborators.projectId,
                                        projectId
                                    )
                                )
                            )
                            .limit(1)
                )
                const [collaborator] = rows
                return collaborator
                    ? { role: collaborator.role as ProjectRole }
                    : null
            })
        }
    }
}

/** The driver reports failures as values, and a missing connection is a dependency, not a bug. */
function toQueryFailure(cause: unknown): ProjectAccessQueryFailed {
    const message =
        cause instanceof Error
            ? cause.message
            : typeof cause === 'object' && cause !== null && '_tag' in cause
              ? String(cause._tag)
              : String(cause)
    return new ProjectAccessQueryFailed({ message, cause })
}

/** One query: an empty result is an answer, a rejected query is a failure. */
function attempt<A>(
    operation: string,
    run: () => PromiseLike<A>
): Effect.Effect<A, ProjectAccessQueryFailed> {
    return Effect.tryPromise({
        try: async () => await run(),
        catch: (cause) => {
            const message =
                cause instanceof Error ? cause.message : String(cause)
            return new ProjectAccessQueryFailed({
                message: `${operation}: ${message}`,
                cause,
            })
        },
    })
}
