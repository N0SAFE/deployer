import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { NotFoundException, BadRequestException, ConflictException } from '@nestjs/common';
import { EnvironmentService } from './environment.service';

describe('EnvironmentService', () => {
  let service: EnvironmentService;
  let mockRepository: any;

  const mockEnvironment = {
    id: '1',
    name: 'production',
    slug: 'production',
    description: 'Production environment',
    type: 'production',
    status: 'healthy',
    projectId: 'project-1',
    templateId: null,
    domainConfig: null,
    networkConfig: null,
    deploymentConfig: null,
    resourceLimits: null,
    previewSettings: null,
    metadata: null,
    isActive: true,
    createdBy: 'user-1',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
    updatedAt: new Date('2023-01-01T00:00:00.000Z'),
  };

  const mockVariable = {
    id: '1',
    environmentId: '1',
    key: 'DATABASE_URL',
    value: 'postgresql://localhost/db',
    isSecret: false,
    description: 'Database connection URL',
    category: 'database',
    isDynamic: false,
    template: null,
    resolutionStatus: 'resolved',
    resolvedValue: 'postgresql://localhost/db',
    resolutionError: null,
    lastResolved: new Date('2023-01-01T00:00:00.000Z'),
    references: [],
    createdBy: 'user-1',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
    updatedAt: new Date('2023-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    mockRepository = {
      createEnvironment: vi.fn(),
      findEnvironmentById: vi.fn(),
      findEnvironmentBySlug: vi.fn(),
      validateEnvironmentSlug: vi.fn(),
      listEnvironments: vi.fn(),
      updateEnvironment: vi.fn(),
      deleteEnvironment: vi.fn(),
      findEnvironmentVariables: vi.fn(),
      createEnvironmentVariable: vi.fn(),
      updateEnvironmentVariable: vi.fn(),
      deleteEnvironmentVariable: vi.fn(),
      bulkUpdateVariables: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      logEnvironmentAccess: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: EnvironmentService,
          useFactory: () => new EnvironmentService(mockRepository),
        },
      ],
    }).compile();

    service = module.get<EnvironmentService>(EnvironmentService);
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('createEnvironment', () => {
    it('should create a new environment when slug is unique', async () => {
      const input = {
        name: 'staging',
        slug: 'staging',
        type: 'staging' as const,
        createdBy: 'user-1',
      };

      mockRepository.validateEnvironmentSlug.mockResolvedValue(true);
      mockRepository.createEnvironment.mockResolvedValue(mockEnvironment);

      const result = await service.createEnvironment(input);

      expect(result).toEqual(mockEnvironment);
      expect(mockRepository.validateEnvironmentSlug).toHaveBeenCalledWith('staging', undefined);
      expect(mockRepository.createEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'staging',
          slug: 'staging',
          type: 'staging',
          createdBy: 'user-1',
          status: 'healthy',
          isActive: true,
        })
      );
    });

    it('should throw ConflictException when slug already exists', async () => {
      const input = {
        name: 'staging',
        slug: 'staging',
        type: 'staging' as const,
        createdBy: 'user-1',
      };

      mockRepository.validateEnvironmentSlug.mockResolvedValue(false);

      await expect(service.createEnvironment(input)).rejects.toThrow(ConflictException);
      expect(mockRepository.createEnvironment).not.toHaveBeenCalled();
    });

    it('should generate slug from name if not provided', async () => {
      const input = {
        name: 'My Production Environment',
        slug: 'my-production-environment', // Must include slug
        type: 'production' as const,
        createdBy: 'user-1',
      };

      mockRepository.validateEnvironmentSlug.mockResolvedValue(true);
      mockRepository.createEnvironment.mockResolvedValue(mockEnvironment);

      await service.createEnvironment(input);

      expect(mockRepository.validateEnvironmentSlug).toHaveBeenCalledWith('my-production-environment', undefined);
      expect(mockRepository.createEnvironment).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'my-production-environment',
        })
      );
    });
  });

  describe('getEnvironment', () => {
    it('should return environment when found', async () => {
      mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);

      const result = await service.getEnvironment('1');

      expect(result).toEqual(mockEnvironment);
      expect(mockRepository.findEnvironmentById).toHaveBeenCalledWith('1');
    });

    it('should throw NotFoundException when environment not found', async () => {
      mockRepository.findEnvironmentById.mockResolvedValue(null);

      await expect(service.getEnvironment('nonexistent')).rejects.toThrow(NotFoundException);
      expect(mockRepository.findEnvironmentById).toHaveBeenCalledWith('nonexistent');
    });
  });

  describe('listEnvironments', () => {
    it('should list environments with pagination', async () => {
      const input = {
        projectId: 'project-1',
        type: 'production' as const,
        status: 'healthy' as const,
        limit: 10,
        offset: 0,
      };

      const mockResult = {
        environments: [mockEnvironment],
        total: 1,
      };

      mockRepository.listEnvironments.mockResolvedValue(mockResult);

      const result = await service.listEnvironments(input);

      expect(result).toEqual(mockResult);
      expect(mockRepository.listEnvironments).toHaveBeenCalledWith(input);
    });

    it('should handle filtering and sorting', async () => {
      const input = {
        search: 'prod',
        sortBy: 'name' as const,
        sortOrder: 'asc' as const,
        limit: 20,
        offset: 10,
      };

      const mockResult = {
        environments: [],
        total: 0,
      };

      mockRepository.listEnvironments.mockResolvedValue(mockResult);

      await service.listEnvironments(input);

      expect(mockRepository.listEnvironments).toHaveBeenCalledWith(input);
    });
  });

  describe('updateEnvironment', () => {
    it('should update environment when it exists', async () => {
      const updates = { name: 'production-v2' };
      const updatedEnvironment = { ...mockEnvironment, name: 'production-v2' };

      mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);
      mockRepository.validateEnvironmentSlug.mockResolvedValue(true);
      mockRepository.updateEnvironment.mockResolvedValue(updatedEnvironment);

      const result = await service.updateEnvironment('1', updates);

      expect(result).toEqual(updatedEnvironment);
      expect(mockRepository.updateEnvironment).toHaveBeenCalledWith('1', {
        ...updates,
        slug: 'production-v2',
        updatedAt: expect.any(Date),
      });
    });

    it('should throw NotFoundException when environment not found', async () => {
      mockRepository.findEnvironmentById.mockResolvedValue(null);

      await expect(service.updateEnvironment('nonexistent', { name: 'new-name' })).rejects.toThrow(NotFoundException);
    });

    it('should update slug when name changes', async () => {
      const updates = { name: 'New Production Name' };
      const updatedEnvironment = { ...mockEnvironment, name: 'New Production Name', slug: 'new-production-name' };

      mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);
      mockRepository.validateEnvironmentSlug.mockResolvedValue(true);
      mockRepository.updateEnvironment.mockResolvedValue(updatedEnvironment);

      await service.updateEnvironment('1', updates);

      expect(mockRepository.updateEnvironment).toHaveBeenCalledWith('1', {
        name: 'New Production Name',
        slug: 'new-production-name',
        updatedAt: expect.any(Date),
      });
    });
  });

  describe('deleteEnvironment', () => {
    it('should delete environment when it exists', async () => {
      mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);
      mockRepository.deleteEnvironment.mockResolvedValue(true);

      await service.deleteEnvironment('1');

      expect(mockRepository.deleteEnvironment).toHaveBeenCalledWith('1');
    });

    it('should throw NotFoundException when environment not found', async () => {
      mockRepository.findEnvironmentById.mockResolvedValue(null);

      await expect(service.deleteEnvironment('nonexistent')).rejects.toThrow(NotFoundException);
    });
  });

  describe('Environment Variables', () => {
    describe('getEnvironmentVariables', () => {
      it('should get variables for environment', async () => {
        mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);
        mockRepository.findEnvironmentVariables.mockResolvedValue([mockVariable]);

        const result = await service.getEnvironmentVariables('1');

        expect(result).toEqual([mockVariable]);
        expect(mockRepository.findEnvironmentVariables).toHaveBeenCalledWith('1');
      });
    });

    describe('updateEnvironmentVariables', () => {
      it('should update environment variables', async () => {
        const variables = [
          {
            key: 'API_KEY',
            value: 'secret',
            isSecret: true,
          },
        ];

        mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);
        mockRepository.bulkUpdateVariables.mockResolvedValue([mockVariable]);
        mockRepository.findEnvironmentVariables.mockResolvedValue([]);

        const result = await service.updateEnvironmentVariables('1', variables, 'user-1');

        expect(result).toEqual([mockVariable]);
        expect(mockRepository.bulkUpdateVariables).toHaveBeenCalledWith('1', variables, 'user-1');
      });

      it('should validate variable keys', async () => {
        const variables = [
          {
            key: '', // Invalid empty key
            value: 'value',
            isSecret: false,
          },
        ];

        mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);

        await expect(service.updateEnvironmentVariables('1', variables, 'user-1')).rejects.toThrow(BadRequestException);
        expect(mockRepository.bulkUpdateVariables).not.toHaveBeenCalled();
      });

      it('should validate for duplicate keys', async () => {
        const variables = [
          {
            key: 'API_KEY',
            value: 'value1',
            isSecret: false,
          },
          {
            key: 'API_KEY', // Duplicate key
            value: 'value2',
            isSecret: false,
          },
        ];

        mockRepository.findEnvironmentById.mockResolvedValue(mockEnvironment);

        await expect(service.updateEnvironmentVariables('1', variables, 'user-1')).rejects.toThrow(BadRequestException);
        expect(mockRepository.bulkUpdateVariables).not.toHaveBeenCalled();
      });
    });

    describe('resolveEnvironmentVariables', () => {
      it('should resolve dynamic variables', async () => {
        const dynamicVariable = {
          ...mockVariable,
          isDynamic: true,
          template: '${services.api.url}',
          resolutionStatus: 'pending' as const,
        };

        mockRepository.findEnvironmentVariables.mockResolvedValue([dynamicVariable]);
        mockRepository.updateEnvironmentVariable.mockResolvedValue({
          ...dynamicVariable,
          resolutionStatus: 'resolved' as const,
          resolvedValue: 'https://api.example.com',
        });

        await service.resolveEnvironmentVariables('1');

        expect(mockRepository.findEnvironmentVariables).toHaveBeenCalledWith('1');
        expect(mockRepository.updateEnvironmentVariable).toHaveBeenCalled();
      });

      it('should handle resolution errors', async () => {
        const dynamicVariable = {
          ...mockVariable,
          isDynamic: true,
          template: '${invalid.reference}',
          resolutionStatus: 'pending' as const,
        };

        mockRepository.findEnvironmentVariables.mockResolvedValue([dynamicVariable]);
        mockRepository.updateEnvironmentVariable.mockResolvedValue({
          ...dynamicVariable,
          resolutionStatus: 'failed' as const,
          resolutionError: 'Invalid reference: invalid.reference',
        });

        await service.resolveEnvironmentVariables('1');

        expect(mockRepository.updateEnvironmentVariable).toHaveBeenCalledWith(
          dynamicVariable.id,
          expect.objectContaining({
            resolutionStatus: 'failed',
            resolutionError: expect.stringContaining('Invalid reference'),
          })
        );
      });
    });
  });

  describe('Preview Environments', () => {
    describe('createPreviewEnvironment', () => {
      it('should create preview environment', async () => {
        const input = {
          name: 'pr-123',
          projectId: 'project-1',
          sourceBranch: 'feature/new-feature',
          sourcePR: 123,
          createdBy: 'user-1',
        };

        const previewEnv = { ...mockEnvironment, type: 'preview', name: 'pr-123' };

        mockRepository.findEnvironmentBySlug.mockResolvedValue(null);
        mockRepository.validateEnvironmentSlug.mockResolvedValue(true);
        mockRepository.createEnvironment.mockResolvedValue(previewEnv);

        const result = await service.createPreviewEnvironment(input);

        expect(result).toEqual(previewEnv);
        expect(mockRepository.createEnvironment).toHaveBeenCalledWith(
          expect.objectContaining({
            type: 'preview',
            name: 'pr-123',
            projectId: 'project-1',
            previewSettings: expect.objectContaining({
              sourceBranch: 'feature/new-feature',
              sourcePR: 123,
            }),
          })
        );
      });

      it('should generate unique slug for preview environments', async () => {
        const input = {
          name: 'pr-123',
          projectId: 'project-1',
          sourceBranch: 'main',
          createdBy: 'user-1',
        };

        // First attempt returns existing environment
        mockRepository.findEnvironmentBySlug
          .mockResolvedValueOnce(mockEnvironment)
          .mockResolvedValueOnce(null);
        mockRepository.validateEnvironmentSlug.mockResolvedValue(true);
        mockRepository.createEnvironment.mockResolvedValue(mockEnvironment);

        await service.createPreviewEnvironment(input);

        expect(mockRepository.findEnvironmentBySlug).toHaveBeenCalledTimes(2);
        expect(mockRepository.findEnvironmentBySlug).toHaveBeenNthCalledWith(1, 'pr-123', 'project-1');
        expect(mockRepository.findEnvironmentBySlug).toHaveBeenNthCalledWith(2, expect.stringMatching(/^pr-123-[a-f0-9]{8}$/), 'project-1');
      });
    });

    describe('listPreviewEnvironments', () => {
      it('should list preview environments', async () => {
        const previewEnvs = [
          { ...mockEnvironment, type: 'preview', name: 'pr-123' },
          { ...mockEnvironment, type: 'preview', name: 'pr-124' },
        ];

        mockRepository.listEnvironments.mockResolvedValue({
          environments: previewEnvs,
          total: 2,
        });

        const result = await service.listPreviewEnvironments('project-1');

        expect(result).toEqual(previewEnvs);
        expect(mockRepository.listEnvironments).toHaveBeenCalledWith({
          projectId: 'project-1',
          type: 'preview',
        });
      });
    });

    describe('cleanupExpiredPreviewEnvironments', () => {
      it('should cleanup expired preview environments', async () => {
        const yesterdayDate = new Date();
        yesterdayDate.setDate(yesterdayDate.getDate() - 1);
        
        const expiredEnvs = [
          { 
            ...mockEnvironment, 
            id: 'expired-1', 
            type: 'preview',
            previewSettings: {
              autoCleanupEnabled: true,
              expiresAt: yesterdayDate.toISOString(),
            }
          },
          { 
            ...mockEnvironment, 
            id: 'expired-2', 
            type: 'preview',
            previewSettings: {
              autoCleanupEnabled: true,
              expiresAt: yesterdayDate.toISOString(),
            }
          },
        ];

        // Mock finding expired environments
        mockRepository.listEnvironments.mockResolvedValue({
          environments: expiredEnvs,
          total: 2,
        });

        mockRepository.deleteEnvironment.mockResolvedValue(true);

        const result = await service.cleanupExpiredPreviewEnvironments();

        expect(result).toEqual(['expired-1', 'expired-2']);
        expect(mockRepository.deleteEnvironment).toHaveBeenCalledTimes(2);
      });
    });
  });

  describe('Bulk Operations', () => {
    describe('bulkDeleteEnvironments', () => {
      it('should bulk delete environments', async () => {
        const ids = ['1', '2', '3'];

        mockRepository.deleteEnvironment
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(true)
          .mockResolvedValueOnce(false); // One fails

        const result = await service.bulkDeleteEnvironments(ids);

        expect(result).toBe(2); // Only 2 deleted successfully
        expect(mockRepository.deleteEnvironment).toHaveBeenCalledTimes(3);
      });
    });
  });

  describe('Status Management', () => {
    describe('updateEnvironmentStatus', () => {
      it('should update environment status', async () => {
        const updatedEnv = { ...mockEnvironment, status: 'error' };
        mockRepository.updateEnvironmentStatus.mockResolvedValue(updatedEnv);

        const result = await service.updateEnvironmentStatus('1', 'error', { error: 'Deploy failed' });

        expect(result).toEqual(updatedEnv);
        expect(mockRepository.updateEnvironmentStatus).toHaveBeenCalledWith('1', 'error', { error: 'Deploy failed' });
      });

      it('should throw NotFoundException when environment not found', async () => {
        mockRepository.updateEnvironmentStatus.mockResolvedValue(null);

        await expect(service.updateEnvironmentStatus('nonexistent', 'error')).rejects.toThrow(NotFoundException);
      });
    });
  });

  describe('Access Logging', () => {
    describe('logAccess', () => {
      it('should log environment access', async () => {
        await service.logAccess('1', 'user-1', 'read');

        expect(mockRepository.logEnvironmentAccess).toHaveBeenCalledWith({
          environmentId: '1',
          userId: 'user-1',
          action: 'read',
        });
      });
    });
  });

  describe('Helper Methods', () => {
    describe('generateSlugFromName', () => {
      it('should generate valid slug from name', () => {
        const result = (service as any).generateSlugFromName('My Production Environment');
        expect(result).toBe('my-production-environment');
      });

      it('should handle special characters', () => {
        const result = (service as any).generateSlugFromName('Test@Environment#123');
        expect(result).toBe('testenvironment123');
      });

      it('should handle multiple spaces', () => {
        const result = (service as any).generateSlugFromName('  Multiple   Spaces  ');
        expect(result).toBe('multiple-spaces');
      });
    });

    describe('validateVariables', () => {
      it('should validate correct variables', () => {
        const variables = [
          { key: 'API_KEY', value: 'secret', isSecret: true },
          { key: 'DATABASE_URL', value: 'postgresql://...', isSecret: false },
        ];

        expect(() => (service as any).validateVariables(variables)).not.toThrow();
      });

      it('should throw for empty keys', () => {
        const variables = [{ key: '', value: 'value', isSecret: false }];

        expect(() => (service as any).validateVariables(variables)).toThrow(BadRequestException);
      });

      it('should throw for duplicate keys', () => {
        const variables = [
          { key: 'API_KEY', value: 'value1', isSecret: false },
          { key: 'API_KEY', value: 'value2', isSecret: false },
        ];

        expect(() => (service as any).validateVariables(variables)).toThrow(BadRequestException);
      });
    });
  });
});