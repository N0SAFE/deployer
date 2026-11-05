import z from 'zod/v4'

import { standard, standardDomainErrorContracts } from '@deployer/orpc-utils'

/** How many facts a node may publish about itself: enough for the platform's own labels, small enough to gossip. */
export const MAX_NODE_LABELS = 32

export const meshNodeLabelsSchema = z
    .record(z.string(), z.string())
    .refine((labels) => Object.keys(labels).length <= MAX_NODE_LABELS, {
        message: `a node has at most ${String(MAX_NODE_LABELS)} labels`,
    })

export const meshNodeLabelsInput = z.object({ labels: meshNodeLabelsSchema })

export type MeshNodeLabels = z.infer<typeof meshNodeLabelsSchema>

const meshNodeLabelsOps = standard.zod(meshNodeLabelsInput, 'meshNodeLabels')

/**
 * Facts about this node, published by its own services (the API writes `deployer.node-id`). They ride in the roster, so
 * peers and the dashboard see them, and a merge never clobbers a label somebody else set.
 *
 * Served only on the node door: what a node says about itself is not a peer's to write.
 */
export const meshNodeLabelsContract = meshNodeLabelsOps
    .create()
    .path('/labels')
    .input((b) => b.body(meshNodeLabelsInput))
    .output(meshNodeLabelsSchema)
    .errors((e) => [...standardDomainErrorContracts(e)])
    .build()
