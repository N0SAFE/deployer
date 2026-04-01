/**
 * Mock Mesh Hooks - Stub
 * 
 * Placeholder for mesh domain mock hooks.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

export function useMeshEventStreams() {
  return useQuery({
    queryKey: ['mesh', 'streams'],
    queryFn: () => Promise.resolve([]),
    staleTime: 1000 * 60 * 5,
  })
}

export function useConnectMeshPeer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { peerId: string; endpoint: string }) => {
      return { success: true }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['mesh'] })
    },
  })
}
