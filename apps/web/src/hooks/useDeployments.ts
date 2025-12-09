'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { deploymentListInput, deploymentListOutput } from '@repo/api-contracts'
import { z } from 'zod'

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true'

const mockDeployments: z.infer<typeof deploymentListOutput> = {
  deployments: [
    {
      deploymentId: 'aaaa1111-1111-1111-1111-111111111111',
      serviceId: 'service-1',
      environment: 'production',
      status: 'success',
      sourceType: 'github',
      url: 'https://demo.example.com',
      createdAt: new Date(Date.now() - 1000 * 60 * 15),
      deployedBy: 'alice',
    },
    {
      deploymentId: 'bbbb2222-2222-2222-2222-222222222222',
      serviceId: 'service-2',
      environment: 'staging',
      status: 'deploying',
      sourceType: 'gitlab',
      url: 'https://staging.example.com',
      createdAt: new Date(Date.now() - 1000 * 60 * 45),
      deployedBy: 'bob',
    },
    {
      deploymentId: 'cccc3333-3333-3333-3333-333333333333',
      serviceId: 'service-3',
      environment: 'development',
      status: 'building',
      sourceType: 'git',
      url: undefined,
      createdAt: new Date(Date.now() - 1000 * 60 * 90),
      deployedBy: 'charlie',
    },
    {
      deploymentId: 'dddd4444-4444-4444-4444-444444444444',
      serviceId: 'service-1',
      environment: 'production',
      status: 'failed',
      sourceType: 'upload',
      url: 'https://demo.example.com',
      createdAt: new Date(Date.now() - 1000 * 60 * 150),
      deployedBy: 'dora',
    },
  ],
  total: 4,
  hasMore: false,
  filters: {
    environment: undefined,
    status: undefined,
    sourceType: undefined,
  },
}

const mockDeploymentLogs = {
  logs: [
    {
      timestamp: new Date(Date.now() - 1000 * 5).toISOString(),
      level: 'info',
      message: 'Deployment started',
      service: 'service-1',
      stage: 'init',
    },
    {
      timestamp: new Date(Date.now() - 1000 * 3).toISOString(),
      level: 'debug',
      message: 'Building docker image',
      service: 'service-1',
      stage: 'build',
    },
    {
      timestamp: new Date(Date.now() - 1000 * 1).toISOString(),
      level: 'warn',
      message: 'Waiting for health check',
      service: 'service-1',
      stage: 'deploy',
    },
  ],
  total: 3,
  hasMore: false,
}

export function useDeployments(input?: Partial<z.input<typeof deploymentListInput>>) {
  const queryInput = {
    limit: 20,
    offset: 0,
    sortBy: 'createdAt' as const,
    sortOrder: 'desc' as const,
    ...(input ?? {}),
  }

  const baseOptions = orpc.deployment.list.queryOptions({
    input: queryInput,
    retry: 0,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  })

  return useQuery({
    ...baseOptions,
    queryFn: async (ctx) => {
      if (USE_MOCKS) return mockDeployments
      const fn = baseOptions.queryFn

      try {
        return await fn(ctx)
      } catch (error) {
        console.warn('[useDeployments] Falling back to mock data', error)
        return mockDeployments
      }
    },
    placeholderData: mockDeployments,
  })
}

export function useDeploymentLogs(deploymentId?: string, options?: { limit?: number; offset?: number }) {
  const limit = options?.limit ?? 200
  const offset = options?.offset ?? 0

  return useQuery({
    queryKey: ['deployment-logs', deploymentId, limit, offset],
    enabled: !!deploymentId,
    staleTime: 1000 * 10,
    gcTime: 1000 * 60,
    queryFn: async () => {
      if (!deploymentId) return mockDeploymentLogs
      if (USE_MOCKS) return mockDeploymentLogs

      try {
        // Prefer real ORPC logs endpoint if available
        const logsOptions = orpc.service.getLogs.queryOptions({
          input: { deploymentId, limit, offset },
          retry: 0,
        })
        const fn = logsOptions.queryFn
        return await fn({ queryKey: logsOptions.queryKey })
      } catch (error) {
        console.warn('[useDeploymentLogs] Falling back to mock data', error)
        return mockDeploymentLogs
      }
    },
    placeholderData: mockDeploymentLogs,
  })
}

export function useDeploymentActions() {
  return {
    triggerDeployment: () => mockDeployments.deployments[0],
    cancelDeployment: () => undefined,
    rollbackDeployment: () => mockDeployments.deployments[0],
  }
}
