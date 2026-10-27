import { Layer } from 'effect'

import { ProviderSchemaLive } from './modules/provider-schema/provider-schema.layers'

/**
 * Everything the fleet service's Effect runtime builds. Fleet is migrating module by module off
 * Promise-based Nest classes: a module is listed here once its service is a Layer.
 */
export const FleetLive = Layer.mergeAll(ProviderSchemaLive)
