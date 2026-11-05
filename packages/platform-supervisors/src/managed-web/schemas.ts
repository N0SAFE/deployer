import z from 'zod/v4'

import {
    baseSupervisorPayloadSchema,
    baseSupervisorProcessInfoSchema,
    swarmProcessInfoSchema,
} from '@deployer/supervision'

export const PLATFORM_MANAGED_WEB_ROLE = 'managed-web'
export const PLATFORM_MANAGED_WEB_SUPERVISOR_ID = 'platform-managed-web'

/** Rich health payload: console service state + desired-state mode. */
export const managedWebSupervisorPayloadSchema =
    baseSupervisorPayloadSchema.extend({
        desired: z.enum(['enabled', 'disabled']),
        /** Live view of the console swarm service (null when absent). */
        service: swarmProcessInfoSchema.shape.live.nullable(),
    })
export type ManagedWebSupervisorPayload = z.output<
    typeof managedWebSupervisorPayloadSchema
>

/** Process info: the container process + the origins it serves. */
export const managedWebProcessInfoSchema =
    baseSupervisorProcessInfoSchema.extend({
        process: swarmProcessInfoSchema,
        urls: z.object({
            /** HTTP origin the managed web app serves. */
            webUrl: z.string(),
            /** HTTP origin of the API the web app talks to. */
            apiUrl: z.string(),
        }),
    })
export type ManagedWebProcessInfo = z.output<typeof managedWebProcessInfoSchema>
