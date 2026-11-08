import { Context, Effect } from 'effect'

import type {
    DockerRuntimeActivityEntity,
    DockerRuntimeEvent,
} from '@deployer/contracts-entities'
import type { DbError } from '@deployer/effect-infra'
import type {
    DockerRuntimeActivityDetailQueryInput,
    DockerRuntimeActivityListInput,
} from '@deployer/runtime-contracts/modules/docker/runtime/activity'

import { DockerRuntimeActivitiesStore } from './docker-runtime-activities.store'
import { listRuntimeActivityEntities } from './runtime-activity-list'
import {
    buildRuntimeActivityRecord,
    toRuntimeActivityEntity,
} from './runtime-activity-mapping'

import type {
    RuntimeDatabasePort,
    RuntimeDb,
} from '../../../../core/database/runtime-db'

/** How many of the most recent activities a list filters, sorts and pages over. */
const RECENT_ACTIVITY_WINDOW = 5000

type DbRequirements = RuntimeDb | RuntimeDatabasePort

/** The database, and the store those reads and writes go through. */
export type DockerRuntimeActivitiesRequirements =
    DbRequirements | DockerRuntimeActivitiesStore

export type DockerRuntimeActivitiesShape = {
    /** Store the activity an event describes; one already stored with the same fingerprint is left alone. */
    readonly persist: (
        event: DockerRuntimeEvent
    ) => Effect.Effect<void, DbError, DockerRuntimeActivitiesRequirements>
    readonly list: (
        input: DockerRuntimeActivityListInput
    ) => Effect.Effect<
        ReturnType<typeof listRuntimeActivityEntities>,
        DbError,
        DockerRuntimeActivitiesRequirements
    >
    readonly getById: (
        input: DockerRuntimeActivityDetailQueryInput
    ) => Effect.Effect<
        DockerRuntimeActivityEntity | null,
        DbError,
        DockerRuntimeActivitiesRequirements
    >
}

/**
 * Persisted docker runtime activities.
 *
 * Each operation IS the logic: it yields the store where it uses it, and the store is what carries the database.
 */
export class DockerRuntimeActivities extends Context.Service<
    DockerRuntimeActivities,
    DockerRuntimeActivitiesShape
>()('runtime/DockerRuntimeActivities') {
    static readonly live = class DockerRuntimeActivitiesImpl
        implements DockerRuntimeActivitiesShape
    {
        persist(
            event: DockerRuntimeEvent
        ): ReturnType<DockerRuntimeActivitiesShape['persist']> {
            return Effect.gen(function* () {
                const store = yield* DockerRuntimeActivitiesStore
                return yield* store.insert(
                    buildRuntimeActivityRecord(event, new Date())
                )
            })
        }

        list(
            input: DockerRuntimeActivityListInput
        ): ReturnType<DockerRuntimeActivitiesShape['list']> {
            return Effect.gen(function* () {
                const store = yield* DockerRuntimeActivitiesStore
                const rows = yield* store.listRecent(RECENT_ACTIVITY_WINDOW)
                return listRuntimeActivityEntities(
                    rows.map(toRuntimeActivityEntity),
                    input
                )
            })
        }

        getById(
            input: DockerRuntimeActivityDetailQueryInput
        ): ReturnType<DockerRuntimeActivitiesShape['getById']> {
            return Effect.gen(function* () {
                const store = yield* DockerRuntimeActivitiesStore
                const row = yield* store.findById(input.id)
                return row === null ? null : toRuntimeActivityEntity(row)
            })
        }
    }
}
