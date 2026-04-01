/**
 * Mock Setup Hooks
 *
 * Drop-in replacements for live setup domain hooks using mock data.
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'

// ============================================================================
// QUERY KEYS
// ============================================================================

const setupKeys = {
  all: ['setup'] as const,
  status: () => [...setupKeys.all, 'status'] as const,
}

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useSetupStatus() {
  return useQuery({
    queryKey: setupKeys.status(),
    queryFn: () => {
      // Mock: setup is complete
      return Promise.resolve({
        isSetup: true,
        step: 'complete' as const,
        version: '1.0.0',
      })
    },
    staleTime: 1000 * 60 * 5,
  })
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useInitializeSetup() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      return Promise.resolve({
        success: true,
        message: 'Setup initialized (mock)',
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: setupKeys.status() })
    },
  })
}

export function useConfigureDatabase() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: () => {
      return Promise.resolve({
        success: true,
        message: 'Database configured (mock)',
      })
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: setupKeys.status() })
    },
  })
}
