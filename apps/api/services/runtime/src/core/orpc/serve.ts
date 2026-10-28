import { createServe } from '@deployer/effect-orpc'

/**
 * The runtime service's request boundary; see `createServe`. Failures a Promise-based collaborator
 * refuses with (Nest exceptions, platform errors) pass through unchanged for the host to translate,
 * until the module behind them is on Effect.
 */
export const { serve } = createServe({
    service: 'svc-runtime',
    passThroughFailures: true,
})
