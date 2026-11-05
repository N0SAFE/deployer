import { desc, eq } from 'drizzle-orm'
import { Context, Effect } from 'effect'

import type { DbError } from '@deployer/effect-infra'
import { dockerRuntimeActivities } from '@deployer/nest-schema/global/runtime/docker-runtime-activity'

import {
    RuntimeDatabasePort,
    RuntimeDb,
} from '../../../../core/database/runtime-db'

import type {
    RuntimeActivityRow,
    buildRuntimeActivityRecord,
} from './runtime-activity-mapping'

type DbRequirements = RuntimeDb | RuntimeDatabasePort

export type DockerRuntimeActivitiesStoreShape = {
    /** Store an activity; one with the same fingerprint is already there and is left alone. */
    readonly insert: (
        record: ReturnType<typeof buildRuntimeActivityRecord>
    ) => Effect.Effect<void, DbError, DbRequirements>
    /** The most recent activities, newest first. */
    readonly listRecent: (
        limit: number
    ) => Effect.Effect<RuntimeActivityRow[], DbError, DbRequirements>
    readonly findById: (
        id: string
    ) => Effect.Effect<RuntimeActivityRow | null, DbError, DbRequirements>
}

/** Persisted docker runtime activities; a constant that reads the database from the Effect context when it runs. */
export class DockerRuntimeActivitiesStore extends Context.Service<
    DockerRuntimeActivitiesStore,
    DockerRuntimeActivitiesStoreShape
>()('runtime/DockerRuntimeActivitiesStore') {
    static readonly live = class DockerRuntimeActivitiesStoreImpl implements DockerRuntimeActivitiesStoreShape {
        insert = (record) =>
            Effect.flatMap(RuntimeDb, (database) =>
                database.use(async (db) => {
                    await db
                        .insert(dockerRuntimeActivities)
                        .values(record)
                        .onConflictDoNothing({
                            target: [dockerRuntimeActivities.eventFingerprint],
                        })
                })
            )

        listRecent = (limit) =>
            Effect.flatMap(RuntimeDb, (database) =>
                database.use((db) =>
                    db
                        .select()
                        .from(dockerRuntimeActivities)
                        .orderBy(desc(dockerRuntimeActivities.occurredAt))
                        .limit(limit)
                )
            )

        findById = (id) =>
            Effect.flatMap(RuntimeDb, (database) =>
                database.use((db) =>
                    db
                        .select()
                        .from(dockerRuntimeActivities)
                        .where(eq(dockerRuntimeActivities.id, id))
                        .limit(1)
                        .then((rows) => rows[0] ?? null)
                )
            )
    }
}
