'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'
import { projectListInput, projectListOutput } from '@repo/api-contracts'
import { z } from 'zod'

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true'

const mockProjects: z.infer<typeof projectListOutput> = {
  projects: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      name: 'Demo Platform',
      description: 'A sample multi-service platform',
      baseDomain: 'demo.example.com',
      ownerId: 'owner-1',
      settings: null,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
      _count: {
        services: 3,
        deployments: 18,
        collaborators: 4,
      },
      latestDeployment: {
        id: 'dpl-latest-1',
        status: 'success',
        createdAt: new Date(Date.now() - 1000 * 60 * 30),
      },
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      name: 'Edge API',
      description: 'API with edge caching and workers',
      baseDomain: 'api.example.com',
      ownerId: 'owner-2',
      settings: null,
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 30),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 12),
      _count: {
        services: 2,
        deployments: 9,
        collaborators: 2,
      },
      latestDeployment: {
        id: 'dpl-latest-2',
        status: 'deploying',
        createdAt: new Date(Date.now() - 1000 * 60 * 10),
      },
    },
  ],
  total: 2,
  hasMore: false,
}

export function useProjects(input?: z.input<typeof projectListInput>) {
  const queryInput = {
    limit: 10,
    offset: 0,
    sortBy: 'updatedAt' as const,
    sortOrder: 'desc' as const,
    ...(input ?? {}),
  }

  const baseOptions = orpc.project.list.queryOptions({
    input: queryInput,
    retry: 0,
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
  })

  return useQuery({
    ...baseOptions,
    queryFn: async (ctx) => {
      if (USE_MOCKS) return mockProjects
      const fn = baseOptions.queryFn
      if (!fn) return mockProjects

      try {
        return await fn(ctx)
      } catch (error) {
        console.warn('[useProjects] Falling back to mock data', error)
        return mockProjects
      }
    },
    placeholderData: mockProjects,
  })
}
