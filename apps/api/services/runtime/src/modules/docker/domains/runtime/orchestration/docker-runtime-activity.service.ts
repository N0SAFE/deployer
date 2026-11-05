import { Context, Effect } from 'effect'

import { serviceOver, type Over } from '@deployer/effect-core'

import {
    DockerCatalog,
    type DockerCatalogPorts,
    type DockerCatalogShape,
} from '../../../catalog/docker-catalog'
import {
    DockerRuntimeActivities,
    type DockerRuntimeActivitiesRequirements,
    type DockerRuntimeActivitiesShape,
} from '../../../repositories/runtime/docker-runtime-activities'

/**
 * The runtime's own reads: the mesh catalog snapshot and the persisted activity rows.
 *
 * An Effect service, not a Nest class holding `EffectRuntime`: the collaborators (`DockerCatalog`, `DockerRuntimeActivities`)
 * are yielded when a method runs, so the controller's handler declares them in its `R` and the requirement gate audits
 * them like any other. The previous shape ran the same Effects on the app-wide runtime, which made those collaborators
 * invisible to the gate — a handler could have lost one and nothing would have failed the build.
 *
 * Streams are NOT here: they stay RxJS in `DockerRuntimeActivityDomainService`, which is the documented boundary.
 */
type DockerRuntimeActivityReads = {
    readonly snapshot: DockerCatalogShape['resolve']
    readonly list: DockerRuntimeActivitiesShape['list']
    readonly getById: DockerRuntimeActivitiesShape['getById']
}

type DockerRuntimeActivityCollaborators =
    DockerCatalog | DockerRuntimeActivities

export type DockerRuntimeActivityShape = Over<
    DockerRuntimeActivityReads,
    DockerRuntimeActivityCollaborators
>

/** Everything a caller must be able to see for these reads to run. */
export type DockerRuntimeActivityPorts =
    | DockerCatalogPorts
    | DockerRuntimeActivitiesRequirements
    | DockerRuntimeActivityCollaborators

export class DockerRuntimeActivity extends Context.Service<
    DockerRuntimeActivity,
    DockerRuntimeActivityShape
>()('runtime/DockerRuntimeActivity') {
    /** Stateless: `serviceOver` reads the collaborators from the context on every call. */
    static readonly live: DockerRuntimeActivityShape = serviceOver(
        Effect.all({
            catalog: DockerCatalog,
            activities: DockerRuntimeActivities,
        }),
        ({ catalog, activities }): DockerRuntimeActivityReads => ({
            snapshot: () => catalog.resolve(),
            list: (input) => activities.list(input),
            getById: (input) => activities.getById(input),
        })
    )
}
