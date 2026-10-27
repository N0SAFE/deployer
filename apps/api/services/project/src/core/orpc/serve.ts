import { createServe } from '@deployer/effect-orpc'

/** The project service's request boundary; see `createServe`. */
export const { serve } = createServe({ service: 'svc-project' })
