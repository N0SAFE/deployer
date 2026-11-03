'use client'

import { useQuery } from '@tanstack/react-query'

import { roleEndpoints } from './endpoints'

export type RoleScope = 'platform' | 'project' | 'environment' | 'service' | 'node'

/** One role as the server stores it: the name `user.role` holds, its label, rank and granted permissions. */
export interface RoleOption {
  id: string
  name: string
  scope: RoleScope
  rank: number
  label: string
  description: string | null
  color: string | null
  isSystem: boolean
  permissions: string[]
}

/**
 * The roles of one scope, strongest first.
 *
 * Cached for five minutes: the catalogue changes when the seed changes, which is a deploy, not a page interaction.
 */
export function useRoles(scope: RoleScope = 'platform') {
  return useQuery(
    roleEndpoints.list.queryOptions({
      input: { query: { scope } },
      staleTime: 5 * 60_000,
    }),
  )
}

/** The platform roles, ready for a picker. Empty until the catalogue loads, never a hardcoded fallback. */
export function usePlatformRoles(): { roles: RoleOption[]; isLoading: boolean } {
  const query = useRoles('platform')
  return { roles: (query.data?.data ?? []), isLoading: query.isLoading }
}
