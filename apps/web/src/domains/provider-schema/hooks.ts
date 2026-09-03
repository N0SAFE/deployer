'use client'

import { useQuery } from '@tanstack/react-query'
import { providerSchemaEndpoints } from './endpoints'

/**
 * Provider Schema client hooks
 *
 * Fetch available providers, builders, and their config schemas.
 */

export function useAllProviders() {
  return useQuery(
    providerSchemaEndpoints.getAllProviders.queryOptions({ input: {} }),
  )
}

export function useAllBuilders() {
  return useQuery(
    providerSchemaEndpoints.getAllBuilders.queryOptions({ input: {} }),
  )
}

export function useProviderSchema(providerId: string) {
  return useQuery({
    ...providerSchemaEndpoints.getProviderSchema.queryOptions({ input: { params: { id: providerId } } }),
    enabled: !!providerId,
  })
}

export function useBuilderSchema(builderId: string) {
  return useQuery({
    ...providerSchemaEndpoints.getBuilderSchema.queryOptions({ input: { params: { id: builderId } } }),
    enabled: !!builderId,
  })
}

export function useCompatibleBuilders(providerId: string) {
  return useQuery({
    ...providerSchemaEndpoints.getCompatibleBuilders.queryOptions({ input: { params: { providerId } } }),
    enabled: !!providerId,
  })
}

export function useCompatibleProviders(builderId: string) {
  return useQuery({
    ...providerSchemaEndpoints.getCompatibleProviders.queryOptions({ input: { params: { builderId } } }),
    enabled: !!builderId,
  })
}
