/**
 * Mock Admin Hooks - Stub
 * 
 * Placeholder for admin domain mock hooks.
 */

import { useQuery } from '@tanstack/react-query'

export function useAdminListUsers() {
  return useQuery({
    queryKey: ['admin', 'users'],
    queryFn: () => Promise.resolve([]),
    staleTime: 1000 * 60 * 5,
  })
}

export function useAdminActions() {
  return {
    deleteUser: { mutate: () => {} },
    updateUserRole: { mutate: () => {} },
  }
}
