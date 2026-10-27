import { createServe } from '@deployer/effect-orpc'

/** The fleet service's request boundary; see `createServe`. */
export const { serve } = createServe({ service: 'svc-fleet' })
