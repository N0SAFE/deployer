import z from 'zod/v4'

/** Shared measurement fields every supervisor payload carries. */
export const supervisorProbeMetaSchema = z.object({
    /** ISO 8601 timestamp of the probe. */
    checkedAt: z.iso.datetime(),
    /** Round-trip latency of the probe's primary check, milliseconds. */
    latencyMs: z.number().int().min(0),
})
export type SupervisorProbeMeta = z.infer<typeof supervisorProbeMetaSchema>

/** The smallest payload schema a supervisor may declare; richer ones extend it. */
export const baseSupervisorPayloadSchema = supervisorProbeMetaSchema
export type BaseSupervisorPayload = z.infer<typeof baseSupervisorPayloadSchema>
