/**
 * Provider and Builder Registry Hooks
 * 
 * Hooks for interacting with the provider and builder registry API.
 * Implements the registry pattern for dynamic provider/builder selection.
 */

import { useQuery } from '@tanstack/react-query';
import { orpc } from '@/lib/orpc';

/**
 * Fetch all available providers
 */
export function useProviders() {
  return useQuery(
    orpc.providerSchema.getAllProviders.queryOptions({
      input: {},
    })
  );
}

/**
 * Fetch all available builders
 */
export function useBuilders() {
  return useQuery(
    orpc.providerSchema.getAllBuilders.queryOptions({
      input: {},
    })
  );
}

/**
 * Fetch compatible builders for a specific provider
 */
export function useCompatibleBuilders(providerId: string | undefined) {
  return useQuery({
    ...orpc.providerSchema.getCompatibleBuilders.queryOptions({
      input: { providerId: providerId || '' },
    }),
    enabled: !!providerId,
  });
}

/**
 * Fetch compatible providers for a specific builder
 */
export function useCompatibleProviders(builderId: string | undefined) {
  return useQuery({
    ...orpc.providerSchema.getCompatibleProviders.queryOptions({
      input: { builderId: builderId || '' },
    }),
    enabled: !!builderId,
  });
}

/**
 * Fetch configuration schema for a provider
 */
export function useProviderSchema(providerId: string | undefined) {
  return useQuery({
    ...orpc.providerSchema.getProviderSchema.queryOptions({
      input: { id: providerId || '' },
    }),
    enabled: !!providerId,
  });
}

/**
 * Fetch configuration schema for a builder
 */
export function useBuilderSchema(builderId: string | undefined) {
  return useQuery({
    ...orpc.providerSchema.getBuilderSchema.queryOptions({
      input: { id: builderId || '' },
    }),
    enabled: !!builderId,
  });
}
