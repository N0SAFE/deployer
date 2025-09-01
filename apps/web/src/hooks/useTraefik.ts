'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Traefik Instance hooks
export function useTraefikInstances() {
  return useQuery(orpc.traefik.listInstances.queryOptions({
    input: {},
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useTraefikInstance(instanceId: string) {
  return useQuery(orpc.traefik.getInstance.queryOptions({
    input: { instanceId },
    enabled: !!instanceId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useCreateTraefikInstance() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.createInstance.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.traefik.listInstances.queryKey({ input: {} }) })
      toast.success('Traefik instance created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create Traefik instance: ${error.message}`)
    },
  }))
}

export function useStartTraefikInstance() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.startInstance.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.traefik.listInstances.queryKey({ input: {} }) })
      toast.success('Traefik instance started successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to start Traefik instance: ${error.message}`)
    },
  }))
}

export function useStopTraefikInstance() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.stopInstance.mutationOptions({
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: orpc.traefik.listInstances.queryKey({ input: {} }) })
      toast.success('Traefik instance stopped successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to stop Traefik instance: ${error.message}`)
    },
  }))
}

export function useTraefikInstanceHealth(instanceId: string) {
  return useQuery(orpc.traefik.healthCheckInstance.queryOptions({
    input: { instanceId },
    enabled: !!instanceId,
    refetchInterval: 30000, // Poll every 30 seconds
    staleTime: 1000 * 15, // 15 seconds
  }))
}

// Traefik Domain hooks
export function useTraefikDomains(instanceId: string) {
  return useQuery(orpc.traefik.listDomainConfigs.queryOptions({
    input: { instanceId },
    enabled: !!instanceId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useCreateTraefikDomain() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.createDomainConfig.mutationOptions({
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.traefik.listDomainConfigs.queryKey({ 
          input: { instanceId: variables.instanceId } 
        }) 
      })
      toast.success('Domain configuration created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create domain configuration: ${error.message}`)
    },
  }))
}

// Traefik Route hooks
export function useTraefikRoutes(domainConfigId: string) {
  return useQuery(orpc.traefik.listRouteConfigs.queryOptions({
    input: { domainConfigId },
    enabled: !!domainConfigId,
    staleTime: 1000 * 30, // 30 seconds
  }))
}

export function useCreateTraefikRoute() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.createRouteConfig.mutationOptions({
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ 
        queryKey: orpc.traefik.listRouteConfigs.queryKey({ 
          input: { domainConfigId: variables.domainConfigId } 
        }) 
      })
      toast.success('Route configuration created successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to create route configuration: ${error.message}`)
    },
  }))
}

export function useDeleteTraefikRoute() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.deleteRouteConfig.mutationOptions({
    onSuccess: () => {
      // Invalidate all route queries since we don't have domainConfigId context
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'listRouteConfigs'
      })
      toast.success('Route configuration deleted successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to delete route configuration: ${error.message}`)
    },
  }))
}

// Traefik Deployment Registration hooks
export function useRegisterTraefikDeployment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.registerDeployment.mutationOptions({
    onSuccess: () => {
      // Invalidate all route queries since registration may create new routes
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'listRouteConfigs'
      })
      toast.success('Deployment registered with Traefik successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to register deployment with Traefik: ${error.message}`)
    },
  }))
}

export function useUnregisterTraefikDeployment() {
  const queryClient = useQueryClient()
  
  return useMutation(orpc.traefik.unregisterDeployment.mutationOptions({
    onSuccess: () => {
      // Invalidate all route queries since unregistration may remove routes
      queryClient.invalidateQueries({ 
        predicate: (query) => query.queryKey[0] === 'traefik' && query.queryKey[1] === 'listRouteConfigs'
      })
      toast.success('Deployment unregistered from Traefik successfully')
    },
    onError: (error: Error) => {
      toast.error(`Failed to unregister deployment from Traefik: ${error.message}`)
    },
  }))
}

// Utility hooks for Traefik actions
export function useTraefikActions() {
  const createInstance = useCreateTraefikInstance()
  const startInstance = useStartTraefikInstance()
  const stopInstance = useStopTraefikInstance()
  const createDomain = useCreateTraefikDomain()
  const createRoute = useCreateTraefikRoute()
  const deleteRoute = useDeleteTraefikRoute()
  const registerDeployment = useRegisterTraefikDeployment()
  const unregisterDeployment = useUnregisterTraefikDeployment()

  return {
    createInstance: createInstance.mutate,
    startInstance: startInstance.mutate,
    stopInstance: stopInstance.mutate,
    createDomain: createDomain.mutate,
    createRoute: createRoute.mutate,
    deleteRoute: deleteRoute.mutate,
    registerDeployment: registerDeployment.mutate,
    unregisterDeployment: unregisterDeployment.mutate,
    isLoading: {
      createInstance: createInstance.isPending,
      startInstance: startInstance.isPending,
      stopInstance: stopInstance.isPending,
      createDomain: createDomain.isPending,
      createRoute: createRoute.isPending,
      deleteRoute: deleteRoute.isPending,
      registerDeployment: registerDeployment.isPending,
      unregisterDeployment: unregisterDeployment.isPending,
    }
  }
}