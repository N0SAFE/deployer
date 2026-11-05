import { ORPCError } from '@orpc/client'
import z from 'zod/v4'

/**
 * Both codes travel in the error body, which is what a client reads: oRPC v2 derives the HTTP status from the code and
 * has no option to set one, so neither claims a status of its own.
 */

/** A replica does not hold the resource and names the one that does. The node-agent that brokered the call answers it. */
export const MESH_REDIRECT = 'MESH_REDIRECT'

/** The agent will not relay this call: here is a short-lived signed grant for a direct link to one replica. The caller's link follows it. */
export const MESH_DIRECT = 'MESH_DIRECT'

export const meshRedirectData = z.object({
    replicaId: z.string().min(1),
    reason: z.string(),
})

export const meshDirectGrantSchema = z.object({
    replicaId: z.string().min(1),
    /** Where the replica's RPC endpoint answers on the overlay network. */
    address: z.string().min(1),
    /** Signed by the agent; the replica verifies it. */
    token: z.string().min(1),
    /** Epoch ms after which the grant must not be used. */
    expiresAt: z.number(),
})

export type MeshRedirectData = z.infer<typeof meshRedirectData>
export type MeshDirectGrant = z.infer<typeof meshDirectGrantSchema>

/** What a handler throws when the resource lives on another replica: `throw redirectTo("project-3", "holds deployment 7")`. */
export function redirectTo(
    replicaId: string,
    reason: string
): ORPCError<typeof MESH_REDIRECT, MeshRedirectData> {
    return new ORPCError(MESH_REDIRECT, {
        message: reason,
        data: { replicaId, reason },
    })
}

/** What the agent answers instead of relaying a call. */
export function grantDirect(
    grant: MeshDirectGrant
): ORPCError<typeof MESH_DIRECT, MeshDirectGrant> {
    return new ORPCError(MESH_DIRECT, {
        message: 'Use the direct link',
        data: grant,
    })
}

const codeOf = (error: unknown): string | undefined =>
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string'
        ? error.code
        : undefined

const dataOf = (error: unknown): unknown =>
    typeof error === 'object' && error !== null && 'data' in error
        ? error.data
        : undefined

/** The redirect an error carries, or `undefined` when it is some other error. Reads the wire shape, so it works on a rebuilt error. */
export function readRedirect(error: unknown): MeshRedirectData | undefined {
    if (codeOf(error) !== MESH_REDIRECT) {
        return undefined
    }
    const parsed = meshRedirectData.safeParse(dataOf(error))
    return parsed.success ? parsed.data : undefined
}

/** The grant an error carries, or `undefined` when it is some other error. */
export function readDirectGrant(error: unknown): MeshDirectGrant | undefined {
    if (codeOf(error) !== MESH_DIRECT) {
        return undefined
    }
    const parsed = meshDirectGrantSchema.safeParse(dataOf(error))
    return parsed.success ? parsed.data : undefined
}
