/**
 * Mock-First Data Service
 *
 * Provides centralized mock data access for all domains.
 * Designed to be a drop-in replacement for live ORPC calls during development.
 * 
 * Usage in domain hooks:
 * ```ts
 * import { useMockData } from '@/lib/mock-data-service'
 * 
 * export function useProject(projectId: string) {
 *   const mockData = useMockData()
 *   return useQuery({
 *     queryKey: ['project', projectId],
 *     queryFn: () => mockData.project.getById(projectId),
 *   })
 * }
 * ```
 */

import {
  getDependencyGraphMockScenario,
  MOCK_ORGANIZATIONS,
  MOCK_PROJECTS,
  MOCK_SERVICES_BY_PROJECT,
  MOCK_DEPLOYMENTS,
  MOCK_SERVICE_CONFIGS_BY_PROJECT,
  MOCK_SERVICE_PROVIDERS_BY_PROJECT,
  MOCK_SERVICE_RUNNERS_BY_PROJECT,
  MOCK_DEPENDENCIES_BY_PROJECT,
} from '@/mocks/platform'
import type {
  DependencyGraphMockScenario,
  MockDeployment,
  MockOrganization,
  MockProject,
  MockServiceProvider,
  MockServiceRunner,
  ServiceConfigEntry,
} from '@/mocks/platform/types'

/**
 * Mock data service - provides typed access to mock scenarios
 */
class MockDataService {
  // Organization data
  organizations = {
    list: async (): Promise<MockOrganization[]> => {
      return MOCK_ORGANIZATIONS
    },
    getById: async (id: string): Promise<MockOrganization | null> => {
      return MOCK_ORGANIZATIONS.find((o) => o.id === id) || null
    },
  }

  // Project data
  projects = {
    list: async (organizationId?: string): Promise<MockProject[]> => {
      if (!organizationId) return MOCK_PROJECTS
      return MOCK_PROJECTS.filter((p) => p.organizationId === organizationId)
    },
    getById: async (id: string): Promise<MockProject | null> => {
      return MOCK_PROJECTS.find((p) => p.id === id) || null
    },
  }

  // Service data
  services = {
    list: async (projectId: string) => {
      return MOCK_SERVICES_BY_PROJECT[projectId] || []
    },
    getById: async (projectId: string, serviceId: string) => {
      const services = MOCK_SERVICES_BY_PROJECT[projectId] || []
      return services.find((s) => s.id === serviceId) || null
    },
  }

  // Deployment data
  deployments = {
    list: async (projectId?: string) => {
      if (!projectId) return MOCK_DEPLOYMENTS
      return MOCK_DEPLOYMENTS.filter((d) => d.projectId === projectId)
    },
  }

  // Service configuration data
  serviceConfigs = {
    getByProject: async (projectId: string): Promise<Record<string, ServiceConfigEntry>> => {
      return MOCK_SERVICE_CONFIGS_BY_PROJECT[projectId] || {}
    },
  }

  // Service provider data
  serviceProviders = {
    getByProject: async (projectId: string): Promise<Record<string, MockServiceProvider>> => {
      return MOCK_SERVICE_PROVIDERS_BY_PROJECT[projectId] || {}
    },
  }

  // Service runner data
  serviceRunners = {
    getByProject: async (projectId: string): Promise<Record<string, MockServiceRunner>> => {
      return MOCK_SERVICE_RUNNERS_BY_PROJECT[projectId] || {}
    },
  }

  // Dependency data
  dependencies = {
    getByProject: async (projectId: string) => {
      return MOCK_DEPENDENCIES_BY_PROJECT[projectId] || []
    },
  }

  // Full dependency graph scenario (includes all related data)
  dependencyGraph = {
    getByProject: async (projectId: string): Promise<DependencyGraphMockScenario> => {
      return getDependencyGraphMockScenario(projectId)
    },
  }
}

/**
 * Singleton instance
 */
const mockDataService = new MockDataService()

/**
 * React hook for accessing mock data service
 * Can be used in any client component
 */
export function useMockData() {
  return mockDataService
}

/**
 * Direct access to mock data service (useful in non-React contexts)
 */
export { mockDataService }
