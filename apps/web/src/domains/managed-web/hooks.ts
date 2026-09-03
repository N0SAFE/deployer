'use client'

import { useQuery, useMutation } from '@tanstack/react-query'
import { managedWebEndpoints, managedWebEndpointOperations } from './endpoints'
import { wrapWithInvalidations } from '../shared/helpers'
import { managedWebInvalidations } from './invalidations'

const enhancedManagedWeb = wrapWithInvalidations(
  managedWebEndpointOperations,
  managedWebInvalidations as never,
)

/** Full managed-web console state (enabled flag, public surface, tunnel, health). */
export function useManagedWebState() {
  return useQuery(
    managedWebEndpoints.getState.queryOptions({ input: {} }),
  )
}

export function useToggleManagedWeb() {
  return useMutation(
    managedWebEndpoints.toggle.mutationOptions({
      onSuccess: enhancedManagedWeb.toggle.withInvalidationOnSuccess(),
    }),
  )
}

export function useRestartManagedWeb() {
  return useMutation(
    managedWebEndpoints.restart.mutationOptions({
      onSuccess: enhancedManagedWeb.restart.withInvalidationOnSuccess(),
    }),
  )
}

export function useSetManagedWebOrigin() {
  return useMutation(
    managedWebEndpoints.setOrigin.mutationOptions({
      onSuccess: enhancedManagedWeb.setOrigin.withInvalidationOnSuccess(),
    }),
  )
}

export function useEnableManagedWebTunnel() {
  return useMutation(
    managedWebEndpoints.enableTunnel.mutationOptions({
      onSuccess: enhancedManagedWeb.enableTunnel.withInvalidationOnSuccess(),
    }),
  )
}

export function useDisableManagedWebTunnel() {
  return useMutation(
    managedWebEndpoints.disableTunnel.mutationOptions({
      onSuccess: enhancedManagedWeb.disableTunnel.withInvalidationOnSuccess(),
    }),
  )
}