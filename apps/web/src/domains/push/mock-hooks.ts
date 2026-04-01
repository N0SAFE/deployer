/**
 * Mock Push Hooks - Stub
 * 
 * Placeholder for push domain mock hooks.
 */

import { useQuery } from '@tanstack/react-query'

export function usePushStats() {
  return useQuery({
    queryKey: ['push', 'stats'],
    queryFn: () => Promise.resolve({ events: 0, lastUpdate: null }),
    staleTime: 1000 * 60 * 5,
  })
}
