import z from 'zod/v4'

import {
    baseSupervisorPayloadSchema,
    baseSupervisorProcessInfoSchema,
    swarmProcessInfoSchema,
} from '@deployer/supervision'

export const DATABASE_SERVICE_SUPERVISOR_ID = 'database-service'

/** Internal Postgres port. */
export const DATABASE_POSTGRES_PORT = 5432
/** Instance service name prefix: `deployer-database-<instance>`. */
export const DATABASE_INSTANCE_PREFIX = 'deployer-database'
/** Ownership marker: cleanup and inspection tooling keys off this label. */
export const DATABASE_ROLE = 'platform-database'

export const databaseInstancePayloadSchema = baseSupervisorPayloadSchema.extend(
    {
        instance: z.string(),
        /** Live view of the instance's swarm service (null when absent). */
        service: swarmProcessInfoSchema.shape.live.nullable(),
        urlSafe: z.string(),
    }
)
export type DatabaseInstancePayload = z.output<
    typeof databaseInstancePayloadSchema
>

export const databaseServicePayloadSchema = baseSupervisorPayloadSchema.extend({
    instances: z.array(z.string()),
    children: z.array(databaseInstancePayloadSchema),
})
export type DatabaseServicePayload = z.output<
    typeof databaseServicePayloadSchema
>

export const databaseInstanceProcessInfoSchema =
    baseSupervisorProcessInfoSchema.extend({
        process: swarmProcessInfoSchema,
        name: z.string(),
        urlSafe: z.string(),
    })
export type DatabaseInstanceProcessInfo = z.output<
    typeof databaseInstanceProcessInfoSchema
>

export const databaseServiceProcessInfoSchema =
    baseSupervisorProcessInfoSchema.extend({
        instances: z.array(z.string()),
        children: z.array(databaseInstanceProcessInfoSchema),
    })
export type DatabaseServiceProcessInfo = z.output<
    typeof databaseServiceProcessInfoSchema
>
