import {
    defineInvalidations,
    type InvalidationConfig,
} from '@/domains/shared/helpers'

import { secretsEndpoints } from './endpoints'

/** Secrets domain cache invalidations: any change to a secret makes the inventory stale. */
export const secretsInvalidations: ReturnType<
    typeof defineInvalidations<
        typeof secretsEndpoints,
        InvalidationConfig<typeof secretsEndpoints>
    >
> = defineInvalidations(secretsEndpoints, {
    rotate: ({ keys }) => [keys.inventory()],
    retire: ({ keys }) => [keys.inventory()],
})
