/**
 * Mock Invitation Hooks - Stub
 * 
 * Placeholder for invitation domain mock hooks.
 */

import { useMutation, useQueryClient } from '@tanstack/react-query'

export function useAcceptInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { invitationId: string }) => {
      return { success: true }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invitations'] })
    },
  })
}

export function useRejectInvitation() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (input: { invitationId: string }) => {
      return { success: true }
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['invitations'] })
    },
  })
}
