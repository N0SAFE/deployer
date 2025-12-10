'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true'

// Mock project detail schema matching API contract expectations
export interface ProjectDetail {
  id: string
  name: string
  description: string | null
  baseDomain: string | null
  ownerId: string
  settings: Record<string, unknown> | null
  createdAt: Date
  updatedAt: Date
  _count: {
    services: number
    deployments: number
    collaborators: number
  }
  owner: {
    id: string
    name: string
    email: string
    image: string | null
  }
  services: {
    id: string
    name: string
    type: string
    status: string
    createdAt: Date
    updatedAt: Date
    _count: {
      deployments: number
    }
  }[]
  collaborators: {
    id: string
    userId: string
    role: string
    user: {
      id: string
      name: string
      email: string
      image: string | null
    }
    createdAt: Date
  }[]
  recentDeployments: {
    id: string
    status: string
    version: string | null
    environment: string
    createdAt: Date
    updatedAt: Date
    service: {
      id: string
      name: string
    }
  }[]
  environment: {
    production: { url: string | null; status: string }
    staging: { url: string | null; status: string }
    development: { url: string | null; status: string }
  }
}

const mockProjectDetail: ProjectDetail = {
  id: '11111111-1111-1111-1111-111111111111',
  name: 'Demo Platform',
  description: 'A sample multi-service platform demonstrating deployment management capabilities',
  baseDomain: 'demo.example.com',
  ownerId: 'owner-1',
  settings: {
    buildCommand: 'npm run build',
    outputDir: 'dist',
    installCommand: 'npm install',
  },
  createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
  updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
  _count: {
    services: 3,
    deployments: 18,
    collaborators: 4,
  },
  owner: {
    id: 'owner-1',
    name: 'John Doe',
    email: 'john@example.com',
    image: null,
  },
  services: [
    {
      id: 'svc-1',
      name: 'web-frontend',
      type: 'web',
      status: 'active',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
      updatedAt: new Date(Date.now() - 1000 * 60 * 30),
      _count: { deployments: 12 },
    },
    {
      id: 'svc-2',
      name: 'api-backend',
      type: 'api',
      status: 'active',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60),
      _count: { deployments: 8 },
    },
    {
      id: 'svc-3',
      name: 'worker-jobs',
      type: 'worker',
      status: 'inactive',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 2),
      _count: { deployments: 3 },
    },
  ],
  collaborators: [
    {
      id: 'collab-1',
      userId: 'owner-1',
      role: 'owner',
      user: { id: 'owner-1', name: 'John Doe', email: 'john@example.com', image: null },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 14),
    },
    {
      id: 'collab-2',
      userId: 'user-2',
      role: 'admin',
      user: { id: 'user-2', name: 'Jane Smith', email: 'jane@example.com', image: null },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 10),
    },
    {
      id: 'collab-3',
      userId: 'user-3',
      role: 'developer',
      user: { id: 'user-3', name: 'Bob Wilson', email: 'bob@example.com', image: null },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 7),
    },
    {
      id: 'collab-4',
      userId: 'user-4',
      role: 'viewer',
      user: { id: 'user-4', name: 'Alice Brown', email: 'alice@example.com', image: null },
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24 * 3),
    },
  ],
  recentDeployments: [
    {
      id: 'dpl-1',
      status: 'succeeded',
      version: 'v1.2.3',
      environment: 'production',
      createdAt: new Date(Date.now() - 1000 * 60 * 30),
      updatedAt: new Date(Date.now() - 1000 * 60 * 25),
      service: { id: 'svc-1', name: 'web-frontend' },
    },
    {
      id: 'dpl-2',
      status: 'succeeded',
      version: 'v2.0.1',
      environment: 'production',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 2),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60),
      service: { id: 'svc-2', name: 'api-backend' },
    },
    {
      id: 'dpl-3',
      status: 'building',
      version: 'v1.2.4',
      environment: 'staging',
      createdAt: new Date(Date.now() - 1000 * 60 * 5),
      updatedAt: new Date(Date.now() - 1000 * 60 * 2),
      service: { id: 'svc-1', name: 'web-frontend' },
    },
    {
      id: 'dpl-4',
      status: 'failed',
      version: 'v0.5.0',
      environment: 'development',
      createdAt: new Date(Date.now() - 1000 * 60 * 60 * 24),
      updatedAt: new Date(Date.now() - 1000 * 60 * 60 * 23),
      service: { id: 'svc-3', name: 'worker-jobs' },
    },
  ],
  environment: {
    production: { url: 'https://demo.example.com', status: 'active' },
    staging: { url: 'https://staging.demo.example.com', status: 'active' },
    development: { url: 'https://dev.demo.example.com', status: 'inactive' },
  },
}

// Second mock project for variety
const mockProject2: ProjectDetail = {
  ...mockProjectDetail,
  id: '22222222-2222-2222-2222-222222222222',
  name: 'Edge API',
  description: 'API with edge caching and workers',
  baseDomain: 'api.example.com',
  _count: { services: 2, deployments: 9, collaborators: 2 },
  services: mockProjectDetail.services.slice(0, 2),
  collaborators: mockProjectDetail.collaborators.slice(0, 2),
  recentDeployments: mockProjectDetail.recentDeployments.slice(0, 2),
  environment: {
    production: { url: 'https://api.example.com', status: 'active' },
    staging: { url: 'https://staging.api.example.com', status: 'active' },
    development: { url: null, status: 'inactive' },
  },
}

const mockProjectsMap: Record<string, ProjectDetail> = {
  '11111111-1111-1111-1111-111111111111': mockProjectDetail,
  '22222222-2222-2222-2222-222222222222': mockProject2,
}

export function useProjectDetail(projectId: string) {
  return useQuery({
    queryKey: ['project', 'detail', projectId],
    queryFn: async () => {
      if (USE_MOCKS) {
        const mock = mockProjectsMap[projectId]
        if (mock) return mock
        // Return a modified mock for unknown IDs
        return { ...mockProjectDetail, id: projectId, name: `Project ${projectId.slice(0, 8)}` }
      }

      try {
        // Attempt real API call
        const result = await orpc.project.getById.call({ id: projectId })
        return result as unknown as ProjectDetail
      } catch (error) {
        console.warn('[useProjectDetail] Falling back to mock data', error)
        const mock = mockProjectsMap[projectId]
        if (mock) return mock
        return { ...mockProjectDetail, id: projectId, name: `Project ${projectId.slice(0, 8)}` }
      }
    },
    staleTime: 1000 * 30,
    gcTime: 1000 * 60 * 5,
    retry: 0,
  })
}
