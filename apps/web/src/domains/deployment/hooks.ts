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

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Only fetch when the id is a real UUID — never a `:id` route-template placeholder. */
function isIdUsable(id: string | undefined | null): id is string {
  return typeof id === 'string' && UUID_RE.test(id)
}

export function useDeploymentList(
  input: Parameters<typeof deploymentEndpoints.list.call>[0],
) {
  return useQuery(deploymentEndpoints.list.queryOptions({ input }))
}

/** Preview environments read model for a service (preview_environments table). */
export function useServicePreviews(serviceId: string) {
  return useQuery({
    ...deploymentEndpoints.listServicePreviews.queryOptions({ input: { params: { serviceId } } }),
    enabled: isIdUsable(serviceId),
  })
}

export function useDeployment(deploymentId: string) {
  return useQuery({
    ...deploymentEndpoints.findById.queryOptions({ input: { params: { id: deploymentId } } }),
    enabled: isIdUsable(deploymentId),
  })
}

export function useDeploymentLogs(
  deploymentId: string,
  query?: Parameters<typeof deploymentEndpoints.getLogs.call>[0] extends { params: unknown; query?: infer Q } ? Q : never,
) {
  return useQuery({
    ...deploymentEndpoints.getLogs.queryOptions({
      input: { params: { id: deploymentId }, query: query ?? {} },
    }),
    enabled: isIdUsable(deploymentId),
  })
}

export function useDeploymentRollbackHistory(deploymentId: string) {
  return useQuery({
    ...deploymentEndpoints.getRollbackHistory.queryOptions({
      input: { params: { id: deploymentId } },
    }),
    enabled: isIdUsable(deploymentId),
  })
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

export function usePromoteServicePreview() {
  return useMutation(
    deploymentEndpoints.promoteServicePreview.mutationOptions({
      onSuccess: enhancedDeployment.promoteServicePreview.withInvalidationOnSuccess(),
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
