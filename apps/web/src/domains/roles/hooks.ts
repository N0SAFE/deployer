'use client'

import { useMutation, useQuery } from '@tanstack/react-query'

import { roleEndpoints } from './endpoints'

export interface ManagedRole {
  id: string
  name: string
  scope: 'platform' | 'project' | 'environment' | 'service' | 'node'
  rank: number
  label: string
  description: string | null
  color: string | null
  isSystem: boolean
  permissions: string[]
}

/** Every role this deployment knows, strongest first (the API orders them). */
export function useManagedRoles(options: { enabled?: boolean } = {}) {
  return useQuery(
    roleEndpoints.list.queryOptions({
      input: { query: {} },
      enabled: options.enabled ?? true,
      staleTime: 60_000,
    }),
  )
}

export function useCreateRole() {
  return useMutation(roleEndpoints.create.mutationOptions({}))
}

export function useUpdateRole() {
  return useMutation(roleEndpoints.update.mutationOptions({}))
}

export function useDeleteRole() {
  return useMutation(roleEndpoints.remove.mutationOptions({}))
}
