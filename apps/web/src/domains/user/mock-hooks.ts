/**
 * Mock User Hooks - Stub
 * 
 * Placeholder for user domain mock hooks.
 */

import { useQuery } from '@tanstack/react-query'

export function useUserList() {
  return useQuery({
    queryKey: ['users', 'list'],
    queryFn: () => Promise.resolve([]),
    staleTime: 1000 * 60 * 5,
  })
}
