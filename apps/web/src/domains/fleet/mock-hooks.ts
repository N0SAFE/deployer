/**
 * Mock Fleet Hooks - Stub
 * 
 * Placeholder for fleet domain mock hooks.
 */

import { useQuery } from '@tanstack/react-query'

export function useFleetServers() {
  return useQuery({
    queryKey: ['fleet', 'servers'],
    queryFn: () => Promise.resolve([]),
    staleTime: 1000 * 60 * 5,
  })
}
