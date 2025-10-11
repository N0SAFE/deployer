'use client'

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { toast } from 'sonner'

// Provider and Builder config types
export type ProviderConfig = {
    // GitHub/GitLab/Bitbucket/Gitea
    repositoryUrl?: string
    branch?: string
    accessToken?: string
    deployKey?: string
    // Docker Registry
    registryUrl?: string
    imageName?: string
    tag?: string
    username?: string
    password?: string
    // S3 Bucket
    bucketName?: string
    region?: string
    accessKeyId?: string
    secretAccessKey?: string
    objectKey?: string
    // Manual
    instructions?: string
    deploymentScript?: string
    [key: string]: unknown
}

export type BuilderConfig = {
    // Dockerfile
    dockerfilePath?: string
    buildContext?: string
    buildArgs?: Record<string, string>
    // Nixpack/Railpack/Buildpack
    buildCommand?: string
    startCommand?: string
    installCommand?: string
    // Static
    outputDirectory?: string
    // Docker Compose
    composeFilePath?: string
    serviceName?: string
    [key: string]: unknown
}

export type TraefikConfig = {
    [key: string]: unknown
}

export type HealthCheckConfig = {
    enabled?: boolean
    path?: string
    interval?: number
    timeout?: number
    retries?: number
    [key: string]: unknown
}

// Service types matching the API contracts
export type Service = {
    id: string
    projectId: string
    name: string
    type: string
    provider: 'github' | 'gitlab' | 'bitbucket' | 'docker_registry' | 'gitea' | 's3_bucket' | 'manual'
    builder: 'dockerfile' | 'nixpack' | 'railpack' | 'buildpack' | 'static' | 'docker_compose'
    providerConfig: ProviderConfig | null
    builderConfig: BuilderConfig | null
    dockerfilePath: string
    buildContext: string
    port: number | null
    healthCheckPath: string
    environmentVariables: Record<string, string> | null
    buildArguments: Record<string, string> | null
    resourceLimits: {
        memory?: string
        cpu?: string
        storage?: string
    } | null
    traefikConfig: TraefikConfig | null
    healthCheckConfig: HealthCheckConfig | null
    isActive: boolean
    createdAt: Date
    updatedAt: Date
}

export type ServiceWithStats = Service & {
    _count: {
        deployments: number
        dependencies: number
    }
    latestDeployment: {
        id: string
        status: 'pending' | 'queued' | 'building' | 'deploying' | 'success' | 'failed' | 'cancelled'
        environment: 'production' | 'staging' | 'preview' | 'development'
        createdAt: Date
        domainUrl: string | null
    } | null
    project: {
        id: string
        name: string
        baseDomain: string | null
    }
}

export type ServiceDependency = {
    id: string
    serviceId: string
    dependsOnServiceId: string
    isRequired: boolean
    createdAt: Date
    dependsOnService: {
        id: string
        name: string
        type: string
    }
}

// Service hooks
export function useServices(
    projectId: string,
    options?: {
        limit?: number
        offset?: number
        search?: string
        type?: string
        isActive?: boolean
    }
) {
    const params = {
        projectId,
        limit: options?.limit || 20,
        offset: options?.offset || 0,
        ...(options?.search && { search: options.search }),
        ...(options?.type && { type: options.type }),
        ...(options?.isActive !== undefined && { isActive: options.isActive }),
    }

    return useQuery(
        orpc.service.listByProject.queryOptions({
            input: params,
            enabled: !!projectId,
            staleTime: 1000 * 30, // 30 seconds
        })
    )
}

export function useService(serviceId: string) {
    return useQuery(
        orpc.service.getById.queryOptions({
            input: { id: serviceId },
            enabled: !!serviceId,
            staleTime: 1000 * 30, // 30 seconds
        })
    )
}

export function useServiceDependencies(serviceId: string) {
    return useQuery(
        orpc.service.getDependencies.queryOptions({
            input: { id: serviceId },
            enabled: !!serviceId,
            staleTime: 1000 * 60, // 1 minute
        })
    )
}

export function useServiceDeployments(
    serviceId: string,
    options?: {
        limit?: number
        offset?: number
        environment?: 'production' | 'staging' | 'preview' | 'development'
        status?:
            | 'pending'
            | 'queued'
            | 'building'
            | 'deploying'
            | 'success'
            | 'failed'
            | 'cancelled'
    }
) {
    const params = {
        id: serviceId,
        limit: options?.limit || 20,
        offset: options?.offset || 0,
        ...(options?.environment && { environment: options.environment }),
        ...(options?.status && { status: options.status }),
    }

    return useQuery(
        orpc.service.getDeployments.queryOptions({
            input: params,
            enabled: !!serviceId,
            staleTime: 1000 * 30, // 30 seconds
        })
    )
}

// Service mutations
export function useCreateService() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.create.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate and refetch services for the project
                queryClient.invalidateQueries({
                    queryKey: orpc.service.listByProject.queryKey({
                        input: { projectId: variables.projectId },
                    }),
                })
                toast.success('Service created successfully')
            },
            onError: (error: Error) => {
                console.error('Error creating service:', error)
                toast.error('Failed to create service')
            },
        })
    )
}

export function useUpdateService() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.update.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate related queries
                queryClient.invalidateQueries({
                    queryKey: orpc.service.listByProject.queryKey({
                        input: { projectId: data.projectId },
                    }),
                })
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getById.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success('Service updated successfully')
            },
            onError: (error: Error) => {
                console.error('Error updating service:', error)
                toast.error('Failed to update service')
            },
        })
    )
}

export function useDeleteService() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.delete.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate services list for all projects
                queryClient.invalidateQueries({
                    queryKey: ['service', 'listByProject'],
                })
                queryClient.removeQueries({
                    queryKey: orpc.service.getById.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success('Service deleted successfully')
            },
            onError: (error: Error) => {
                console.error('Error deleting service:', error)
                toast.error('Failed to delete service')
            },
        })
    )
}

export function useToggleServiceActive() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.toggleActive.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate related queries
                queryClient.invalidateQueries({
                    queryKey: orpc.service.listByProject.queryKey({
                        input: { projectId: data.projectId },
                    }),
                })
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getById.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success(
                    `Service ${data.isActive ? 'activated' : 'deactivated'}`
                )
            },
            onError: (error: Error) => {
                console.error('Error toggling service:', error)
                toast.error('Failed to toggle service status')
            },
        })
    )
}

export function useAddServiceDependency() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.addDependency.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate service dependencies
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getDependencies.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success('Service dependency added')
            },
            onError: (error: Error) => {
                console.error('Error adding service dependency:', error)
                toast.error('Failed to add service dependency')
            },
        })
    )
}

export function useRemoveServiceDependency() {
    const queryClient = useQueryClient()

    return useMutation(
        orpc.service.removeDependency.mutationOptions({
            onSuccess: (data, variables) => {
                // Invalidate service dependencies
                queryClient.invalidateQueries({
                    queryKey: orpc.service.getDependencies.queryKey({
                        input: { id: variables.id },
                    }),
                })
                toast.success('Service dependency removed')
            },
            onError: (error: Error) => {
                console.error('Error removing service dependency:', error)
                toast.error('Failed to remove service dependency')
            },
        })
    )
}

// Service logs hooks
export function useServiceLogs(
    serviceId: string,
    options?: {
        limit?: number
        offset?: number
        level?: 'info' | 'warn' | 'error' | 'debug'
        since?: Date
        until?: Date
        follow?: boolean
    }
) {
    const params = {
        id: serviceId,
        limit: options?.limit || 100,
        offset: options?.offset || 0,
        ...(options?.level && { level: options.level }),
        ...(options?.since && { since: options.since }),
        ...(options?.until && { until: options.until }),
    }

    return useQuery(
        orpc.service.getLogs.queryOptions({
            input: params,
            enabled: !!serviceId && !options?.follow, // Disable for streaming logs
            staleTime: 1000 * 10, // 10 seconds for logs
            refetchInterval: options?.follow ? 5000 : false, // Auto-refresh for streaming
        })
    )
}

// Service metrics hook
export function useServiceMetrics(
    serviceId: string,
    options?: {
        timeRange?: '1h' | '6h' | '1d' | '7d' | '30d'
        interval?: '1m' | '5m' | '15m' | '1h' | '1d'
    }
) {
    const params = {
        id: serviceId,
        timeRange: options?.timeRange || '1h',
        interval: options?.interval || '5m',
    }

    return useQuery(
        orpc.service.getMetrics.queryOptions({
            input: params,
            enabled: !!serviceId,
            staleTime: 1000 * 30, // 30 seconds
            refetchInterval: 30000, // Auto-refresh every 30 seconds
        })
    )
}

// Service health hook
export function useServiceHealth(serviceId: string) {
    return useQuery(
        orpc.service.getHealth.queryOptions({
            input: { id: serviceId },
            enabled: !!serviceId,
            staleTime: 1000 * 15, // 15 seconds
            refetchInterval: 15000, // Auto-refresh every 15 seconds
        })
    )
}

// Custom hook for real-time logs using WebSocket (placeholder for future implementation)
export function useServiceLogsStream(
    serviceId: string,
    options?: {
        level?: 'info' | 'warn' | 'error' | 'debug'
        onLog?: (log: {
            serviceId: string
            timestamp: string
            level: 'info' | 'warn' | 'error' | 'debug'
            message: string
            source?: 'container' | 'system' | 'proxy' | 'health_check'
            containerId?: string
            metadata?: Record<string, unknown>
        }) => void
    }
) {
    // TODO: Implement WebSocket connection for real-time logs
    // For now, return a placeholder that uses regular polling
    console.log(
        'Service logs stream requested for:',
        serviceId,
        'with options:',
        options
    )

    return {
        isConnected: false,
        error: null,
        connect: () => console.log('WebSocket connection not yet implemented'),
        disconnect: () =>
            console.log('WebSocket disconnection not yet implemented'),
        logs: [] as Array<{
            id: string
            timestamp: Date
            level: 'info' | 'warn' | 'error' | 'debug'
            message: string
            source?: 'container' | 'system' | 'proxy' | 'health_check'
            containerId?: string
            metadata?: Record<string, unknown>
        }>,
    }
}

// Custom hook for real-time metrics using WebSocket (placeholder for future implementation)
export function useServiceMetricsStream(
    serviceId: string,
    options?: {
        interval?: '1m' | '5m' | '15m'
        onMetrics?: (metrics: {
            serviceId: string
            timestamp: string
            metrics: {
                cpu: number
                memory: { used: number; total: number }
                network: { bytesIn: number; bytesOut: number }
                requests?: { count: number; responseTime: number }
            }
        }) => void
    }
) {
    // TODO: Implement WebSocket connection for real-time metrics
    console.log(
        'Service metrics stream requested for:',
        serviceId,
        'with options:',
        options
    )

    return {
        isConnected: false,
        error: null,
        connect: () => console.log('WebSocket connection not yet implemented'),
        disconnect: () =>
            console.log('WebSocket disconnection not yet implemented'),
        metrics: null as {
            cpu: number
            memory: { used: number; total: number }
            network: { bytesIn: number; bytesOut: number }
            requests?: { count: number; responseTime: number }
        } | null,
    }
}

// Custom hook for real-time health updates using WebSocket (placeholder for future implementation)
export function useServiceHealthStream(
    serviceId: string,
    options?: {
        onHealthUpdate?: (health: {
            serviceId: string
            timestamp: string
            status: 'healthy' | 'unhealthy' | 'unknown' | 'starting'
            checks: Array<{
                name: string
                status: 'pass' | 'fail' | 'warn'
                message?: string
                timestamp: Date
            }>
            containerStatus?:
                | 'running'
                | 'stopped'
                | 'restarting'
                | 'paused'
                | 'exited'
        }) => void
    }
) {
    // TODO: Implement WebSocket connection for real-time health updates
    console.log(
        'Service health stream requested for:',
        serviceId,
        'with options:',
        options
    )

    return {
        isConnected: false,
        error: null,
        connect: () => console.log('WebSocket connection not yet implemented'),
        disconnect: () =>
            console.log('WebSocket disconnection not yet implemented'),
        health: null as {
            status: 'healthy' | 'unhealthy' | 'unknown' | 'starting'
            lastCheck?: Date
            checks: Array<{
                name: string
                status: 'pass' | 'fail' | 'warn'
                message?: string
                timestamp: Date
            }>
            uptime?: number
            containerStatus?:
                | 'running'
                | 'stopped'
                | 'restarting'
                | 'paused'
                | 'exited'
        } | null,
    }
}

// Project dependency graph hook
export function useProjectDependencyGraph(projectId: string) {
    return useQuery(
        orpc.service.getProjectDependencyGraph.queryOptions({
            input: { projectId },
            enabled: !!projectId,
            staleTime: 1000 * 60, // 1 minute
            refetchInterval: 30000, // Auto-refresh every 30 seconds
        })
    )
}
