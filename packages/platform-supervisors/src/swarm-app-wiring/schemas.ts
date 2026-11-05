import z from 'zod/v4'

import {
    baseSupervisorPayloadSchema,
    baseSupervisorProcessInfoSchema,
} from '@deployer/supervision'

export const SWARM_APP_WIRING_SUPERVISOR_ID = 'platform-app-wiring'

/** One app container's wiring status on the overlay. */
export const swarmAppWiringTargetSchema = z.object({
    /** Canonical container name (what the engine matches). */
    name: z.string().min(1),
    /** Network aliases re-declared on the overlay (how consumers address it). */
    aliases: z.array(z.string()),
    /** True when the container is attached to the overlay. */
    attached: z.boolean(),
})
export type SwarmAppWiringTarget = z.infer<typeof swarmAppWiringTargetSchema>

/**
 * Rich health payload: whether the engine is swarm-active, the overlay name, and the per-container
 * attachment status.
 *
 * A configured target that is not RUNNING is simply absent from `targets` (the wiring owns containers
 * that run, not containers this deployment does not define yet); the Docker start event re-converges
 * the moment it appears.
 */
export const swarmAppWiringPayloadSchema = baseSupervisorPayloadSchema.extend({
    swarmActive: z.boolean(),
    overlay: z.string().min(1),
    targets: z.array(swarmAppWiringTargetSchema),
})
export type SwarmAppWiringPayload = z.output<typeof swarmAppWiringPayloadSchema>

/** Process info: the overlay this supervisor joins app containers to. */
export const swarmAppWiringProcessInfoSchema =
    baseSupervisorProcessInfoSchema.extend({
        overlay: z.string().min(1),
        targets: z.array(swarmAppWiringTargetSchema),
    })
export type SwarmAppWiringProcessInfo = z.output<
    typeof swarmAppWiringProcessInfoSchema
>
