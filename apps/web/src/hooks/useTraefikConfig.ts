'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

export type TraefikConfigInput = {
    domain?: string
    subdomain?: string
    sslEnabled?: boolean
    sslProvider?: string | null
    pathPrefix?: string
    port?: number
    middleware?: Record<string, unknown>
    healthCheck?: Record<string, unknown>
    configContent?: string
    isActive?: boolean
}

export type TraefikConfig = {
    id: string
    serviceId: string
    domain: string
    subdomain: string
    fullDomain: string
    sslEnabled: boolean
    sslProvider: string | null
    pathPrefix: string
    port: number
    middleware: Record<string, unknown>
    healthCheck: Record<string, unknown>
    isActive: boolean
    configContent: string
    lastSyncedAt: string | null
    createdAt: string
    updatedAt: string
}

export type TraefikValidationResult = {
    isValid: boolean
    errors?: Array<{
        path: string
        message: string
        code: string
    }>
    warnings?: Array<{
        path: string
        message: string
    }>
    variables?: Array<{
        name: string
        resolved: boolean
        value?: unknown
        error?: string
    }>
}

// Get Traefik config for a service
export function useTraefikConfig(serviceId: string) {
    return useQuery(
        orpc.service.getTraefikConfig.queryOptions({
            input: { id: serviceId },
            enabled: !!serviceId,
            staleTime: 1000 * 30, // 30 seconds
        })
    )
}

// Update Traefik config
export function useUpdateTraefikConfig() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.updateTraefikConfig.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate related queries
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getTraefikConfig.queryKey({
                        input: { id: variables.id },
                    }),
                })
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getById.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success('Traefik configuration updated')
            },
            onError: (error: Error) => {
                console.error('Error updating Traefik config:', error)
                toast.error('Failed to update Traefik configuration')
            },
        })
    )
}

// Sync Traefik config to file system
export function useSyncTraefikConfig() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.syncTraefikConfig.mutationOptions({
            onSuccess: (data, variables) => {
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getTraefikConfig.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success(data.message || 'Traefik configuration synced')
            },
            onError: (error: Error) => {
                console.error('Error syncing Traefik config:', error)
                toast.error('Failed to sync Traefik configuration')
            },
        })
    )
}

// Validate Traefik config
export function useValidateTraefikConfig() {
    return useMutation({
        mutationFn: async (config: {
            serviceId: string
            configContent: string
        }): Promise<TraefikValidationResult> => {
            try {
                // Call validation endpoint
                const result = await orpc.traefik.validateServiceConfig.call({
                    serviceId: config.serviceId,
                    configContent: config.configContent,
                })
                return result as TraefikValidationResult
            } catch (error) {
                console.error('Validation error:', error)
                throw error
            }
        },
        onError: (error: Error) => {
            console.error('Error validating Traefik config:', error)
            toast.error(error.message || 'Failed to validate Traefik configuration')
        },
    })
}
