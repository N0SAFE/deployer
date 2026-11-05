import z from 'zod/v4'

import {
    baseSupervisorPayloadSchema,
    baseSupervisorProcessInfoSchema,
    swarmProcessInfoSchema,
} from '@deployer/supervision'

export const PLATFORM_REDIS_SUPERVISOR_ID = 'platform-redis'
export const REDIS_CONTAINER_BASE_NAME = 'deployer-redis'
export const REDIS_INTERNAL_PORT = 6379
export const REDIS_DATA_VOLUME = 'deployer-redis-data'
export const REDIS_DATA_MOUNT = '/data'
export const REDIS_SERVICE_IMAGE_DEFAULT = 'redis:7-alpine'

/** Which runtime this supervisor is CURRENTLY under. */
export const redisRuntimeSchema = z.enum([
    'managed',
    'swarm-replicated',
    'unavailable',
])
export type RedisRuntime = z.output<typeof redisRuntimeSchema>

/** Rich health payload: process (service) state + reachability. `null` marks a measurement that could not be obtained. */
export const redisSupervisorPayloadSchema = baseSupervisorPayloadSchema.extend({
    runtime: redisRuntimeSchema,
    service: z
        .object({
            id: z.string(),
            name: z.string(),
            runningTasks: z.number().int().min(0).nullable(),
            exists: z.boolean(),
        })
        .nullable(),
    host: z.string(),
    port: z.number().int().min(1),
    reachable: z.boolean(),
    ping: z.string().nullable(),
    redisVersion: z.string().nullable(),
})
export type RedisSupervisorPayload = z.output<
    typeof redisSupervisorPayloadSchema
>

/** Process info reported by the redis supervisor (a swarm service). */
export const redisProcessInfoSchema = baseSupervisorProcessInfoSchema.extend({
    process: swarmProcessInfoSchema,
})
export type RedisProcessInfo = z.output<typeof redisProcessInfoSchema>
