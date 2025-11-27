import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DeploymentCleanupService } from '../deployment-cleanup.service';
import type { DockerService } from '../../../docker/services/docker.service';

// Mock services
const createMockDatabaseService = () => ({
  db: {
    select: vi.fn().mockReturnThis(),
    from: vi.fn().mockReturnThis(),
    where: vi.fn().mockReturnThis(),
    orderBy: vi.fn().mockReturnThis(),
    limit: vi.fn().mockReturnThis(),
    execute: vi.fn(),
    delete: vi.fn().mockReturnThis(),
  },
});

const createMockDockerService = () => ({
  stopContainer: vi.fn().mockResolvedValue(undefined),
  removeContainer: vi.fn().mockResolvedValue(undefined),
  removeImage: vi.fn().mockResolvedValue(undefined),
});

describe('DeploymentCleanupService', () => {
  let service: DeploymentCleanupService;
  let mockDb: ReturnType<typeof createMockDatabaseService>;
  let mockDockerService: ReturnType<typeof createMockDockerService>;

  beforeEach(() => {
    mockDb = createMockDatabaseService();
    mockDockerService = createMockDockerService();

    // Create mock repositories and services
    const mockDeploymentRepository = {} as any;
    const mockServiceService = {} as any;

    service = new DeploymentCleanupService(
      mockDeploymentRepository,
      mockServiceService,
      mockDockerService as unknown as DockerService,
    );
  });

  describe('cleanupOldDeployments', () => {
    it('should keep maxSuccessfulDeployments and delete older ones', async () => {
      const serviceId = 'test-service-id';
      const serviceName = 'test-service';
      
      // Mock service with retention policy
      const mockService = {
        id: serviceId,
        name: serviceName,
        deploymentRetention: {
          maxSuccessfulDeployments: 3,
          keepArtifacts: true,
          autoCleanup: true,
        },
      };

      // Mock 5 successful deployments
      const mockDeployments = [
        { id: 'deploy-1', version: 'v1.5', createdAt: new Date('2025-10-05'), deploymentType: 'containerized', containerId: 'container-1' },
        { id: 'deploy-2', version: 'v1.4', createdAt: new Date('2025-10-04'), deploymentType: 'containerized', containerId: 'container-2' },
        { id: 'deploy-3', version: 'v1.3', createdAt: new Date('2025-10-03'), deploymentType: 'containerized', containerId: 'container-3' },
        { id: 'deploy-4', version: 'v1.2', createdAt: new Date('2025-10-02'), deploymentType: 'containerized', containerId: 'container-4' },
        { id: 'deploy-5', version: 'v1.1', createdAt: new Date('2025-10-01'), deploymentType: 'containerized', containerId: 'container-5' },
      ];

      // Setup mocks
      mockDb.db.execute
        .mockResolvedValueOnce([mockService]) // First query: get service
        .mockResolvedValueOnce(mockDeployments); // Second query: get deployments

      // Mock delete operation
      mockDb.db.execute.mockResolvedValueOnce({ rowsAffected: 2 }); // Delete query

      // Execute cleanup
      const result = await service.cleanupOldDeployments(serviceId);

      // Verify results
      expect(result.deletedCount).toBe(2); // Should delete 2 oldest (keeping 3)
      expect(result.keptCount).toBe(3);
      expect(result.deletedDeployments).toHaveLength(2);
      expect(result.deletedDeployments[0]).toBe('deploy-4');
      expect(result.deletedDeployments[1]).toBe('deploy-5');
      expect(result.message).toContain('Successfully cleaned up 2 old deployments');
    });

    it('should not delete anything if within retention limit', async () => {
      const serviceId = 'test-service-id';
      const serviceName = 'test-service';
      
      const mockService = {
        id: serviceId,
        name: serviceName,
        deploymentRetention: {
          maxSuccessfulDeployments: 5,
          keepArtifacts: true,
          autoCleanup: true,
        },
      };

      // Mock only 3 deployments (less than retention limit)
      const mockDeployments = [
        { id: 'deploy-1', version: 'v1.3', createdAt: new Date('2025-10-03') },
        { id: 'deploy-2', version: 'v1.2', createdAt: new Date('2025-10-02') },
        { id: 'deploy-3', version: 'v1.1', createdAt: new Date('2025-10-01') },
      ];

      mockDb.db.execute
        .mockResolvedValueOnce([mockService])
        .mockResolvedValueOnce(mockDeployments);

      const result = await service.cleanupOldDeployments(serviceId);

      expect(result.deletedCount).toBe(0);
      expect(result.keptCount).toBe(3);
      expect(result.message).toContain('No old deployments to clean up');
    });

    it('should cleanup artifacts when keepArtifacts is false', async () => {
      const serviceId = 'test-service-id';
      
      const mockService = {
        id: serviceId,
        name: 'test-service',
        deploymentRetention: {
          maxSuccessfulDeployments: 1,
          keepArtifacts: false, // Should delete artifacts
          autoCleanup: true,
        },
      };

      const mockDeployments = [
        { id: 'deploy-1', version: 'v1.2', createdAt: new Date('2025-10-02'), deploymentType: 'containerized', containerId: 'container-1', imageTag: 'image:v1.2' },
        { id: 'deploy-2', version: 'v1.1', createdAt: new Date('2025-10-01'), deploymentType: 'containerized', containerId: 'container-2', imageTag: 'image:v1.1' },
      ];

      mockDb.db.execute
        .mockResolvedValueOnce([mockService])
        .mockResolvedValueOnce(mockDeployments)
        .mockResolvedValueOnce({ rowsAffected: 1 });

      await service.cleanupOldDeployments(serviceId);

      // Verify Docker cleanup was called
      expect(mockDockerService.stopContainer).toHaveBeenCalledWith('container-2');
      expect(mockDockerService.removeContainer).toHaveBeenCalledWith('container-2');
      expect(mockDockerService.removeImage).toHaveBeenCalledWith('image:v1.1');
    });

    it('should handle errors gracefully and continue cleanup', async () => {
      const serviceId = 'test-service-id';
      
      const mockService = {
        id: serviceId,
        name: 'test-service',
        deploymentRetention: {
          maxSuccessfulDeployments: 1,
          keepArtifacts: false,
          autoCleanup: true,
        },
      };

      const mockDeployments = [
        { id: 'deploy-1', version: 'v1.2', createdAt: new Date('2025-10-02'), deploymentType: 'containerized', containerId: 'container-1' },
        { id: 'deploy-2', version: 'v1.1', createdAt: new Date('2025-10-01'), deploymentType: 'containerized', containerId: 'container-2' },
      ];

      mockDb.db.execute
        .mockResolvedValueOnce([mockService])
        .mockResolvedValueOnce(mockDeployments)
        .mockResolvedValueOnce({ rowsAffected: 1 });

      // Simulate Docker error
      mockDockerService.stopContainer.mockRejectedValueOnce(new Error('Container not found'));

      // Should not throw
      const result = await service.cleanupOldDeployments(serviceId);

      // Cleanup should still complete
      expect(result.deletedCount).toBe(1);
      expect(mockDockerService.removeContainer).toHaveBeenCalled(); // Continues despite error
    });
  });

  describe('previewCleanup', () => {
    it('should return preview without deleting anything', async () => {
      const serviceId = 'test-service-id';
      
      const mockService = {
        id: serviceId,
        name: 'test-service',
        deploymentRetention: {
          maxSuccessfulDeployments: 3,
          keepArtifacts: true,
          autoCleanup: true,
        },
      };

      const mockDeployments = [
        { id: 'deploy-1', version: 'v1.5', createdAt: new Date('2025-10-05') },
        { id: 'deploy-2', version: 'v1.4', createdAt: new Date('2025-10-04') },
        { id: 'deploy-3', version: 'v1.3', createdAt: new Date('2025-10-03') },
        { id: 'deploy-4', version: 'v1.2', createdAt: new Date('2025-10-02') },
        { id: 'deploy-5', version: 'v1.1', createdAt: new Date('2025-10-01') },
      ];

      mockDb.db.execute
        .mockResolvedValueOnce([mockService])
        .mockResolvedValueOnce(mockDeployments);

      const result = await service.previewCleanup(serviceId);

      expect(result.willDelete).toBe(2);
      expect(result.willKeep).toBe(3);
      expect(result.deploymentsToDelete).toHaveLength(2);
      expect(result.deploymentsToKeep).toHaveLength(3);
      
      // Verify no delete was called
      expect(mockDb.db.delete).not.toHaveBeenCalled();
    });
  });

  describe('cleanupAllServices', () => {
    it('should cleanup deployments for all services', async () => {
      const mockServices = [
        { id: 'service-1', name: 'app-1' },
        { id: 'service-2', name: 'app-2' },
      ];

      // Mock services query
      mockDb.db.execute.mockResolvedValueOnce(mockServices);

      // Mock cleanup for each service
      vi.spyOn(service, 'cleanupOldDeployments')
        .mockResolvedValueOnce({
          serviceId: 'service-1',
          deletedCount: 2,
          keptCount: 5,
          deletedDeployments: [],
          message: 'Cleaned service-1',
        })
        .mockResolvedValueOnce({
          serviceId: 'service-2',
          deletedCount: 1,
          keptCount: 3,
          deletedDeployments: [],
          message: 'Cleaned service-2',
        });

      const results = await service.cleanupAllServices();

      expect(results).toHaveLength(2);
      expect(results[0].deletedCount).toBe(2);
      expect(results[1].deletedCount).toBe(1);
      expect(service.cleanupOldDeployments).toHaveBeenCalledTimes(2);
    });

    it('should continue cleanup even if one service fails', async () => {
      const mockServices = [
        { id: 'service-1', name: 'app-1' },
        { id: 'service-2', name: 'app-2' },
      ];

      mockDb.db.execute.mockResolvedValueOnce(mockServices);

      vi.spyOn(service, 'cleanupOldDeployments')
        .mockRejectedValueOnce(new Error('Service 1 failed'))
        .mockResolvedValueOnce({
          serviceId: 'service-2',
          deletedCount: 1,
          keptCount: 3,
          deletedDeployments: [],
          message: 'Cleaned service-2',
        });

      const results = await service.cleanupAllServices();

      // Should have 2 results, first with error
      expect(results).toHaveLength(2);
      expect(results[0].deletedCount).toBe(0);
      expect(results[0].message).toContain('Error cleaning up');
      expect(results[1].deletedCount).toBe(1);
    });
  });
});
