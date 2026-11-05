import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/**
 * Rotating the swarm's credential without dropping the swarm.
 *
 * Called with no secret it mints one, broadcasts it to every known agent and then installs it locally. Called with a
 * secret (the broadcast a peer receives) it adopts the rotation the originator already minted, so every agent ends up
 * on the same secret. The secret a rotation replaces stays valid until `validUntil`, which is the window that lets a
 * peer that missed the broadcast keep connecting until gossip catches it up.
 */
export const meshRotateInput = z.object({
    /** The secret the originator minted. Absent asks this agent to mint and broadcast one itself. */
    secret: z.string().min(32).optional(),
    /** Epoch ms until which the secret being replaced is still accepted. */
    validUntil: z.number().int().positive().optional(),
    /** The originator's install time. Carried so every receiver adopts the SAME epoch and a duplicate is a no-op. */
    epoch: z.number().int().positive().optional(),
})

export const meshRotateOutput = z.object({
    /** Whether the credential changed; an adoption of a stale rotation leaves it as it was. */
    rotated: z.boolean(),
    /** Epoch ms until which the previous secret is accepted. */
    validUntil: z.number(),
    /** When the current secret was installed: a later rotation has a higher epoch and wins. */
    epoch: z.number(),
})

export type MeshRotateInput = z.infer<typeof meshRotateInput>

const meshRotateOps = standard.zod(meshRotateOutput, 'meshRotate')

export const meshRotateContract = meshRotateOps
    .create()
    .path('/rotate')
    .input((b) => b.body(meshRotateInput))
    .output(meshRotateOutput)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
