import {
    defineInvalidations,
    type InvalidationConfig,
} from '@/domains/shared/helpers'

import { meshEndpoints } from './endpoints'

/** Mesh domain cache invalidations. */
export const meshInvalidations: ReturnType<
    typeof defineInvalidations<
        typeof meshEndpoints,
        InvalidationConfig<typeof meshEndpoints>
    >
> = defineInvalidations(meshEndpoints, {
    updateNodeConfig: ({ keys }) => [keys.getNodeConfig(), keys.getLocalNode()],
})
