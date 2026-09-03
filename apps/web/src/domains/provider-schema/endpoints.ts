import { orpc } from '@/lib/orpc'

/**
 * Provider Schema domain endpoints
 *
 * Metadata-driven provider and builder configuration.
 */
export const providerSchemaEndpoints = {
  getAllProviders: orpc.providerSchema.getAllProviders,
  getProviderSchema: orpc.providerSchema.getProviderSchema,
  getCompatibleBuilders: orpc.providerSchema.getCompatibleBuilders,
  getAllBuilders: orpc.providerSchema.getAllBuilders,
  getBuilderSchema: orpc.providerSchema.getBuilderSchema,
  getCompatibleProviders: orpc.providerSchema.getCompatibleProviders,
  validateProviderConfig: orpc.providerSchema.validateProviderConfig,
  validateBuilderConfig: orpc.providerSchema.validateBuilderConfig,
} as const

export type ProviderSchemaEndpoints = typeof providerSchemaEndpoints
