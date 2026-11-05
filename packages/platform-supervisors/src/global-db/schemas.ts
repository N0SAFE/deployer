import z from 'zod/v4'

import {
    baseSupervisorPayloadSchema,
    baseSupervisorProcessInfoSchema,
    swarmProcessInfoSchema,
} from '@deployer/supervision'

export const GLOBAL_DB_SUPERVISOR_ID = 'global-db-postgres'

/**
 * Rich health payload, a DISCRIMINATED UNION on how the database is provisioned:
 *   - "managed": the API scheduled the database as a SWARM SERVICE: service + task state, data-volume
 *     usage, published port.
 *   - "external": an operator-provided URL: a real `SELECT 1` probe plus the table count and names
 *     (database health, not process health).
 */
export const globalDbSupervisorPayloadSchema = z.discriminatedUnion('mode', [
    baseSupervisorPayloadSchema.extend({
        mode: z.literal('managed'),
        service: swarmProcessInfoSchema.shape.live.nullable(),
        volume: z
            .object({
                name: z.string(),
                mountpoint: z.string().nullable(),
                sizeBytes: z.number().int().min(0).nullable(),
            })
            .nullable(),
        publishedPort: z.number().int().min(1).nullable(),
    }),
    baseSupervisorPayloadSchema.extend({
        mode: z.literal('external'),
        select1: z.object({
            ok: z.boolean(),
            latencyMs: z.number().int().min(0).nullable(),
        }),
        tableCount: z.number().int().min(0),
        tables: z.array(z.string()),
        database: z.string(),
    }),
])
export type GlobalDbSupervisorPayload = z.output<
    typeof globalDbSupervisorPayloadSchema
>

/**
 * Process info: the managed Postgres SWARM SERVICE plus the connection DSN consumers (or the operator)
 * need. The supervisor only registers when the database is LOCALLY MANAGED, so `process` is always the
 * swarm flavor.
 */
export const globalDbProcessInfoSchema = baseSupervisorProcessInfoSchema.extend(
    {
        process: swarmProcessInfoSchema,
        connection: z.object({
            /** Full DSN (includes credentials), for other supervised processes that must connect. */
            url: z.string(),
            /** Password-masked DSN, safe to display in tooling and the UI. */
            urlSafe: z.string(),
            host: z.string(),
            port: z.number().int().min(1).nullable(),
            database: z.string(),
            user: z.string(),
        }),
    }
)
export type GlobalDbProcessInfo = z.output<typeof globalDbProcessInfoSchema>
