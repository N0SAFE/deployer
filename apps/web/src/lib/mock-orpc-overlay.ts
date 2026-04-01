/**
 * Mock ORPC Client Overlay
 *
 * Wraps or replaces the live ORPC client with mock implementations when NEXT_PUBLIC_DATA_MODE=mock.
 * This allows all existing hook code to work without modification.
 */

import { isUsingMockData } from '@/lib/data-mode'
import { mockDataService } from '@/lib/mock-data-service'

/**
 * Create mock endpoint implementations that match ORPC contract interface
 */
export function createMockOrcpOverlay() {
  if (!isUsingMockData()) {
    return null
  }

  return {
    organization: {
      list: {
        queryOptions: (options: any) => ({
          queryKey: ['organizations', 'list'],
          queryFn: () => mockDataService.organizations.list(),
        }),
      },
      get: {
        queryOptions: (options: any) => ({
          queryKey: ['organizations', options.input.organizationId],
          queryFn: () =>
            mockDataService.organizations.getById(options.input.organizationId),
        }),
      },
      listMembers: {
        queryOptions: (options: any) => ({
          queryKey: ['organizations', options.input.organizationId, 'members'],
          queryFn: () => Promise.resolve([]),
        }),
      },
    },
    project: {
      list: {
        queryOptions: (options: any) => ({
          queryKey: ['projects', 'list'],
          queryFn: () => mockDataService.projects.list(),
        }),
      },
      findById: {
        queryOptions: (options: any) => ({
          queryKey: ['projects', options.input?.id],
          queryFn: () =>
            mockDataService.projects.getById(options.input?.id || ''),
        }),
      },
    },
    service: {
      list: {
        queryOptions: (options: any) => ({
          queryKey: ['services', 'list', options.input?.projectId],
          queryFn: () =>
            mockDataService.services.list(options.input?.projectId || ''),
        }),
      },
    },
    deployment: {
      list: {
        queryOptions: (options: any) => ({
          queryKey: ['deployments', 'list', options.input?.projectId],
          queryFn: () =>
            mockDataService.deployments.list(options.input?.projectId),
        }),
      },
    },
  }
}
