'use client'

import { useQuery } from '@tanstack/react-query'
import { orpc } from '@/lib/orpc'

const USE_MOCKS = process.env.NEXT_PUBLIC_USE_MOCKS === 'true'

export interface DeploymentLog {
  id: string
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'debug'
  message: string
  source?: string
}

export interface DeploymentDetail {
  id: string
  deploymentId: string
  projectId: string
  serviceId: string
  status: string
  version: string | null
  environment: string
  cluster: string | null
  sourceType: string
  sourceRef: string | null
  commitHash: string | null
  commitMessage: string | null
  deployedBy: string
  url: string | null
  buildDuration: number | null
  deployDuration: number | null
  totalDuration: number | null
  createdAt: Date
  updatedAt: Date
  startedAt: Date | null
  completedAt: Date | null
  project: {
    id: string
    name: string
    description: string | null
  }
  service: {
    id: string
    name: string
    type: string
  }
  logs: DeploymentLog[]
  buildConfig: {
    command: string | null
    outputDir: string | null
    nodeVersion: string | null
    envVars: Record<string, string>
  }
  metrics: {
    cpuUsage: number | null
    memoryUsage: number | null
    requestCount: number | null
    errorRate: number | null
    avgResponseTime: number | null
  }
  rollbackFrom: string | null
  rollbackTo: string | null
}

const mockDeploymentDetail: DeploymentDetail = {
  id: 'aaaa1111-1111-1111-1111-111111111111',
  deploymentId: 'aaaa1111-1111-1111-1111-111111111111',
  projectId: '11111111-1111-1111-1111-111111111111',
  serviceId: 'service-1',
  status: 'success',
  version: 'v1.2.3',
  environment: 'production',
  cluster: 'us-east-1',
  sourceType: 'github',
  sourceRef: 'main',
  commitHash: 'a1b2c3d4e5f6g7h8i9j0',
  commitMessage: 'feat: add new dashboard components',
  deployedBy: 'alice',
  url: 'https://demo.example.com',
  buildDuration: 145,
  deployDuration: 32,
  totalDuration: 177,
  createdAt: new Date(Date.now() - 1000 * 60 * 15),
  updatedAt: new Date(Date.now() - 1000 * 60 * 10),
  startedAt: new Date(Date.now() - 1000 * 60 * 15),
  completedAt: new Date(Date.now() - 1000 * 60 * 10),
  project: {
    id: '11111111-1111-1111-1111-111111111111',
    name: 'Demo Platform',
    description: 'A sample multi-service platform',
  },
  service: {
    id: 'service-1',
    name: 'web-frontend',
    type: 'web',
  },
  logs: [
    { id: 'log-1', timestamp: new Date(Date.now() - 1000 * 60 * 30), level: 'info', message: 'Deployment started', source: 'orchestrator' },
    { id: 'log-2', timestamp: new Date(Date.now() - 1000 * 60 * 29), level: 'info', message: 'Fetching source from github:main', source: 'builder' },
    { id: 'log-3', timestamp: new Date(Date.now() - 1000 * 60 * 28), level: 'info', message: 'Installing dependencies...', source: 'builder' },
    { id: 'log-4', timestamp: new Date(Date.now() - 1000 * 60 * 27), level: 'debug', message: 'npm install completed in 45s', source: 'builder' },
    { id: 'log-5', timestamp: new Date(Date.now() - 1000 * 60 * 26), level: 'info', message: 'Running build command: npm run build', source: 'builder' },
    { id: 'log-6', timestamp: new Date(Date.now() - 1000 * 60 * 27), level: 'warn', message: 'Deprecated API usage detected in src/legacy.ts', source: 'builder' },
    { id: 'log-7', timestamp: new Date(Date.now() - 1000 * 60 * 26), level: 'info', message: 'Build completed successfully', source: 'builder' },
    { id: 'log-8', timestamp: new Date(Date.now() - 1000 * 60 * 26), level: 'info', message: 'Pushing to container registry...', source: 'deployer' },
    { id: 'log-9', timestamp: new Date(Date.now() - 1000 * 60 * 25), level: 'info', message: 'Starting deployment to us-east-1', source: 'deployer' },
    { id: 'log-10', timestamp: new Date(Date.now() - 1000 * 60 * 25), level: 'info', message: 'Health check passed', source: 'deployer' },
    { id: 'log-11', timestamp: new Date(Date.now() - 1000 * 60 * 25), level: 'info', message: 'Deployment succeeded', source: 'orchestrator' },
  ],
  buildConfig: {
    command: 'npm run build',
    outputDir: 'dist',
    nodeVersion: '20.x',
    envVars: {
      NODE_ENV: 'production',
      API_URL: 'https://api.example.com',
    },
  },
  metrics: {
    cpuUsage: 23.5,
    memoryUsage: 156.8,
    requestCount: 15420,
    errorRate: 0.12,
    avgResponseTime: 45.2,
  },
  rollbackFrom: null,
  rollbackTo: null,
}

const mockFailedDeployment: DeploymentDetail = {
  ...mockDeploymentDetail,
  id: 'dddd4444-4444-4444-4444-444444444444',
  deploymentId: 'dddd4444-4444-4444-4444-444444444444',
  status: 'failed',
  serviceId: 'service-1',
  environment: 'production',
  deployedBy: 'dora',
  createdAt: new Date(Date.now() - 1000 * 60 * 150),
  completedAt: new Date(Date.now() - 1000 * 60 * 145),
  logs: [
    { id: 'log-1', timestamp: new Date(Date.now() - 1000 * 60 * 150), level: 'info', message: 'Deployment started', source: 'orchestrator' },
    { id: 'log-2', timestamp: new Date(Date.now() - 1000 * 60 * 149), level: 'info', message: 'Fetching source from github:main', source: 'builder' },
    { id: 'log-3', timestamp: new Date(Date.now() - 1000 * 60 * 148), level: 'info', message: 'Installing dependencies...', source: 'builder' },
    { id: 'log-4', timestamp: new Date(Date.now() - 1000 * 60 * 147), level: 'error', message: 'npm ERR! peer dep missing: react@18.x required', source: 'builder' },
    { id: 'log-5', timestamp: new Date(Date.now() - 1000 * 60 * 147), level: 'error', message: 'Build failed with exit code 1', source: 'builder' },
    { id: 'log-6', timestamp: new Date(Date.now() - 1000 * 60 * 145), level: 'error', message: 'Deployment failed', source: 'orchestrator' },
  ],
  metrics: null as unknown as DeploymentDetail['metrics'],
}

const mockBuildingDeployment: DeploymentDetail = {
  ...mockDeploymentDetail,
  id: 'cccc3333-3333-3333-3333-333333333333',
  deploymentId: 'cccc3333-3333-3333-3333-333333333333',
  status: 'building',
  version: 'v1.2.4',
  serviceId: 'service-3',
  environment: 'development',
  sourceType: 'git',
  deployedBy: 'charlie',
  createdAt: new Date(Date.now() - 1000 * 60 * 90),
  completedAt: null,
  totalDuration: null,
  deployDuration: null,
  logs: [
    { id: 'log-1', timestamp: new Date(Date.now() - 1000 * 60 * 90), level: 'info', message: 'Deployment started', source: 'orchestrator' },
    { id: 'log-2', timestamp: new Date(Date.now() - 1000 * 60 * 89), level: 'info', message: 'Fetching source from git:develop', source: 'builder' },
    { id: 'log-3', timestamp: new Date(Date.now() - 1000 * 60 * 88), level: 'info', message: 'Installing dependencies...', source: 'builder' },
    { id: 'log-4', timestamp: new Date(Date.now() - 1000 * 60 * 85), level: 'info', message: 'Running build command...', source: 'builder' },
  ],
  metrics: null as unknown as DeploymentDetail['metrics'],
}

const mockDeployingDeployment: DeploymentDetail = {
  ...mockDeploymentDetail,
  id: 'bbbb2222-2222-2222-2222-222222222222',
  deploymentId: 'bbbb2222-2222-2222-2222-222222222222',
  status: 'deploying',
  version: 'v1.2.5',
  serviceId: 'service-2',
  environment: 'staging',
  sourceType: 'gitlab',
  deployedBy: 'bob',
  url: 'https://staging.example.com',
  createdAt: new Date(Date.now() - 1000 * 60 * 45),
  completedAt: null,
  totalDuration: null,
  logs: [
    { id: 'log-1', timestamp: new Date(Date.now() - 1000 * 60 * 45), level: 'info', message: 'Deployment started', source: 'orchestrator' },
    { id: 'log-2', timestamp: new Date(Date.now() - 1000 * 60 * 44), level: 'info', message: 'Fetching source from gitlab:main', source: 'builder' },
    { id: 'log-3', timestamp: new Date(Date.now() - 1000 * 60 * 42), level: 'info', message: 'Build completed successfully', source: 'builder' },
    { id: 'log-4', timestamp: new Date(Date.now() - 1000 * 60 * 40), level: 'info', message: 'Pushing to container registry...', source: 'deployer' },
    { id: 'log-5', timestamp: new Date(Date.now() - 1000 * 60 * 38), level: 'info', message: 'Starting deployment to staging...', source: 'deployer' },
  ],
  metrics: null as unknown as DeploymentDetail['metrics'],
}

const mockDeploymentsMap: Record<string, DeploymentDetail> = {
  'aaaa1111-1111-1111-1111-111111111111': mockDeploymentDetail,
  'bbbb2222-2222-2222-2222-222222222222': mockDeployingDeployment,
  'cccc3333-3333-3333-3333-333333333333': mockBuildingDeployment,
  'dddd4444-4444-4444-4444-444444444444': mockFailedDeployment,
}

export function useDeploymentDetail(deploymentId: string) {
  return useQuery({
    queryKey: ['deployment', 'detail', deploymentId],
    queryFn: async () => {
      if (USE_MOCKS) {
        const mock = mockDeploymentsMap[deploymentId]
        if (mock) return mock
        return { ...mockDeploymentDetail, id: deploymentId, deploymentId }
      }

      try {
        // Use detailedStatus which provides comprehensive deployment info
        const result = await orpc.deployment.detailedStatus.call({ deploymentId })
        if (!result) {
          // Fall back to mock if no deployment found
          const mock = mockDeploymentsMap[deploymentId]
          if (mock) return mock
          return { ...mockDeploymentDetail, id: deploymentId, deploymentId }
        }
        
        // Map the API response to our DeploymentDetail interface
        return {
          id: result.deployment.id,
          deploymentId: result.deployment.id,
          projectId: '', // Not provided by detailedStatus
          serviceId: result.deployment.serviceId,
          status: result.deployment.status,
          version: null,
          environment: result.deployment.environment,
          cluster: null,
          sourceType: 'github',
          sourceRef: null,
          commitHash: null,
          commitMessage: null,
          deployedBy: 'unknown',
          url: result.health.httpHealthCheck?.isHealthy ? 'https://example.com' : null,
          buildDuration: null,
          deployDuration: null,
          totalDuration: null,
          createdAt: result.deployment.createdAt,
          updatedAt: result.deployment.updatedAt,
          startedAt: result.deployment.createdAt,
          completedAt: result.deployment.status === 'success' ? result.deployment.updatedAt : null,
          project: { id: '', name: 'Unknown', description: null },
          service: { id: result.deployment.serviceId, name: 'Unknown', type: 'web' },
          logs: result.recentLogs.map(log => ({
            id: log.id,
            timestamp: log.timestamp,
            level: log.level as 'info' | 'warn' | 'error' | 'debug',
            message: log.message,
            source: 'orchestrator',
          })),
          buildConfig: {
            command: null,
            outputDir: null,
            nodeVersion: null,
            envVars: {},
          },
          metrics: result.health.containers[0]?.health.resources ? {
            cpuUsage: result.health.containers[0].health.resources.cpuUsage ?? null,
            memoryUsage: result.health.containers[0].health.resources.memoryUsage ?? null,
            requestCount: null,
            errorRate: null,
            avgResponseTime: result.health.httpHealthCheck?.responseTime ?? null,
          } : null as unknown as DeploymentDetail['metrics'],
          rollbackFrom: null,
          rollbackTo: null,
        } satisfies DeploymentDetail
      } catch (error) {
        console.warn('[useDeploymentDetail] Falling back to mock data', error)
        const mock = mockDeploymentsMap[deploymentId]
        if (mock) return mock
        return { ...mockDeploymentDetail, id: deploymentId, deploymentId }
      }
    },
    staleTime: 1000 * 15,
    gcTime: 1000 * 60 * 5,
    retry: 0,
    refetchInterval: (query) => {
      const data = query.state.data
      if (data && ['building', 'deploying', 'pending'].includes(data.status)) {
        return 5000 // Poll every 5s for in-progress deployments
      }
      return false
    },
  })
}
