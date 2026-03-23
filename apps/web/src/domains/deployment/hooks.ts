"use client";

/**
 * Deployment Domain - Client Hooks
 *
 * React hooks for deployment management with automatic cache invalidation.
 */

import { useQuery, useMutation } from '@tanstack/react-query'
import { deploymentEndpoints } from './endpoints'
import { deploymentInvalidations } from './invalidations'
import { wrapWithInvalidations } from '../shared/helpers'

const enhancedDeployment = wrapWithInvalidations(deploymentEndpoints, deploymentInvalidations)

// ============================================================================
// QUERY HOOKS
// ============================================================================

export function useDeploymentList(
  input: Parameters<typeof deploymentEndpoints.list.call>[0],
) {
  return useQuery(deploymentEndpoints.list.queryOptions({ input }))
}

export function useDeployment(deploymentId: string) {
  return useQuery(
    deploymentEndpoints.findById.queryOptions({ input: { params: { id: deploymentId } } }),
  )
}

export function useDeploymentLogs(
  deploymentId: string,
  query?: Parameters<typeof deploymentEndpoints.getLogs.call>[0] extends { params: unknown; query?: infer Q } ? Q : never,
) {
  return useQuery(
    deploymentEndpoints.getLogs.queryOptions({
      input: { params: { id: deploymentId }, query: query ?? {} },
    }),
  )
}

export function useDeploymentRollbackHistory(deploymentId: string) {
  return useQuery(
    deploymentEndpoints.getRollbackHistory.queryOptions({
      input: { params: { id: deploymentId } },
    }),
  )
}

// ============================================================================
// MUTATION HOOKS
// ============================================================================

export function useTriggerDeployment() {
  return useMutation(
    deploymentEndpoints.trigger.mutationOptions({
      onSuccess: enhancedDeployment.trigger.withInvalidationOnSuccess(),
    }),
  )
}

export function useCancelDeployment() {
  return useMutation(
    deploymentEndpoints.cancel.mutationOptions({
      onSuccess: enhancedDeployment.cancel.withInvalidationOnSuccess(),
    }),
  )
}

export function useRollbackDeployment() {
  return useMutation(
    deploymentEndpoints.rollback.mutationOptions({
      onSuccess: enhancedDeployment.rollback.withInvalidationOnSuccess(),
    }),
  )
}

export function useRetryDeployment() {
  return useMutation(
    deploymentEndpoints.retry.mutationOptions({
      onSuccess: enhancedDeployment.retry.withInvalidationOnSuccess(),
    }),
  )
}

export function useDeleteDeployment() {
  return useMutation(
    deploymentEndpoints.delete.mutationOptions({
      onSuccess: enhancedDeployment.delete.withInvalidationOnSuccess(),
    }),
  )
}
