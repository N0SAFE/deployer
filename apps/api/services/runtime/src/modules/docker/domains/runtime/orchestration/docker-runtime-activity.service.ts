import { Context, Effect } from 'effect'

import type {
    DockerRuntimeActivityEntity,
} from '@deployer/contracts-entities'
import type {
    DockerRuntimeActivityDetailQueryInput,
    DockerRuntimeActivityListInput,
} from '@deployer/runtime-contracts/modules/docker/runtime/activity'

import {
    DockerCatalog,
    type DockerCatalogPorts,
} from '../../../catalog/docker-catalog'
import {
    DockerRuntimeActivities,
    type DockerRuntimeActivitiesRequirements,
} from '../../../repositories/runtime/docker-runtime-activities'

/** The catalog, plus the ports behind it. */
type SnapshotRequirements = DockerCatalog | DockerCatalogPorts

/** The activity store, plus the database behind it. */
type ActivityRequirements =
    | DockerRuntimeActivities
    | DockerRuntimeActivitiesRequirements

/** The three reads this service exposes: the mesh catalog snapshot and the persisted activity rows. */
type DockerRuntimeActivityReads = {
    readonly snapshot: () => Effect.Effect<
        Effect.Success<ReturnType<DockerCatalog['Service']['resolve']>>,
        unknown,
        SnapshotRequirements
    >
    readonly list: (
        input: DockerRuntimeActivityListInput
    ) => Effect.Effect<
        Effect.Success<
            ReturnType<DockerRuntimeActivities['Service']['list']>
        >,
        unknown,
        ActivityRequirements
    >
    readonly getById: (
        input: DockerRuntimeActivityDetailQueryInput
    ) => Effect.Effect<
        DockerRuntimeActivityEntity | null,
        unknown,
        ActivityRequirements
    >
}

type DockerRuntimeActivityCollaborators =
    | DockerCatalog
    | DockerRuntimeActivities

export type DockerRuntimeActivityShape = DockerRuntimeActivityReads

/** Everything a caller must be able to see for these reads to run. */
export type DockerRuntimeActivityPorts =
    | DockerCatalogPorts
    | DockerRuntimeActivitiesRequirements
    | DockerRuntimeActivityCollaborators

/**
 * The runtime's own reads: the mesh catalog snapshot and the persisted activity rows.
 *
 * An Effect service, not a Nest class holding `EffectRuntime`: each operation yields the collaborator that serves it
 * where it uses it, so the controller's handler declares them in its `R` and the requirement gate audits them like any
 * other.
 *
 * Streams are NOT here: they stay RxJS in `DockerRuntimeActivityDomainService`, which is the documented boundary.
 */
export class DockerRuntimeActivity extends Context.Service<
    DockerRuntimeActivity,
    DockerRuntimeActivityShape
>()('runtime/DockerRuntimeActivity') {
    /**
     * Collaborators are yielded per call, so this is a class the module provides with `useClass`.
     */
    static readonly live = class DockerRuntimeActivityImpl
        implements DockerRuntimeActivityShape
    {
        snapshot(): ReturnType<DockerRuntimeActivityShape['snapshot']> {
            return Effect.gen(function* () {
                const catalog = yield* DockerCatalog
                return yield* catalog.resolve()
            })
        }

        list(
            input: DockerRuntimeActivityListInput
        ): ReturnType<DockerRuntimeActivityShape['list']> {
            return Effect.gen(function* () {
                const activities = yield* DockerRuntimeActivities
                return yield* activities.list(input)
            })
        }

        getById(
            input: DockerRuntimeActivityDetailQueryInput
        ): ReturnType<DockerRuntimeActivityShape['getById']> {
            return Effect.gen(function* () {
                const activities = yield* DockerRuntimeActivities
                return yield* activities.getById(input)
            })
        }
    }
}
