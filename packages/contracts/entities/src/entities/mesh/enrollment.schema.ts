import z from 'zod/v4'

import {
    meshNetworkClusterSchema,
    meshSwarmJoinGrantSchema,
} from './trust.schema'

/**
 * How a node that holds a join token is taken into the fleet. The token is what authorizes the call (the fleet asks its
 * own agent whether it is the swarm's and still good), so there is no user session and no shared secret to hand over.
 */

export const meshEnrollmentDescribeInputSchema = z.object({
    token: z.string().min(1),
})
export type MeshEnrollmentDescribeInput = z.infer<
    typeof meshEnrollmentDescribeInputSchema
>

/** What a joiner needs to know before it commits: the fleet's version, and the WireGuard mesh its entry must name. */
export const meshEnrollmentDescribeResultSchema = z.object({
    version: z.string().min(1),
    meshNetwork: meshNetworkClusterSchema.nullable(),
})
export type MeshEnrollmentDescribeResult = z.infer<
    typeof meshEnrollmentDescribeResultSchema
>

export const meshEnrollmentEnrollInputSchema = z.object({
    token: z.string().min(1),
    /** The joiner's own node id: the id its agent generated on first boot. */
    nodeId: z.string().min(1),
    serverUrl: z.string().url(),
    displayName: z.string().min(1).max(255).optional(),
    /** The role the joiner asked for; the fleet decides what it grants. */
    requestedSwarmPolicy: z.enum(['auto', 'manager', 'worker']).optional(),
})
export type MeshEnrollmentEnrollInput = z.infer<
    typeof meshEnrollmentEnrollInputSchema
>

export const meshEnrollmentEnrollResultSchema = z.object({
    nodeId: z.string().min(1),
    enrolledAt: z.string(),
    /** The fleet's shared database, which the joiner points at. */
    databaseUrl: z.url(),
    /** The fleet's swarm role decision, or null when the fleet has no swarm to hand over. */
    swarmGrant: meshSwarmJoinGrantSchema.nullable(),
    /**
     * The agent join token this node was admitted with, echoed back so the joiner keeps it if it ever has to repeat the
     * join.
     */
    meshJoinToken: z.string().min(1).nullable().default(null),
})
export type MeshEnrollmentEnrollResult = z.infer<
    typeof meshEnrollmentEnrollResultSchema
>
