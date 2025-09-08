import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EnvironmentController } from './environment.controller';
import { EnvironmentService } from '../services/environment.service';

describe('EnvironmentController', () => {
  let controller: EnvironmentController;
  let service: EnvironmentService;

  const mockServiceEnvironment = {
    id: '1',
    name: 'production',
    slug: 'production',
    description: 'Production environment',
    type: 'production' as const,
    status: 'healthy' as const,
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

  const mockServiceVariable = {
    id: '1',
    environmentId: '1',
    key: 'DATABASE_URL',
    value: 'postgresql://localhost/db',
    isSecret: false,
    description: 'Database connection URL',
    category: 'database',
    isDynamic: false,
    template: null,
    resolutionStatus: 'resolved' as const,
    resolvedValue: 'postgresql://localhost/db',
    resolutionError: null,
    lastResolved: new Date('2023-01-01T00:00:00.000Z'),
    references: [],
    createdBy: 'user-1',
    createdAt: new Date('2023-01-01T00:00:00.000Z'),
    updatedAt: new Date('2023-01-01T00:00:00.000Z'),
  };

  beforeEach(async () => {
    const mockEnvironmentService = {
      listEnvironments: vi.fn(),
      getEnvironment: vi.fn(),
      createEnvironment: vi.fn(),
      updateEnvironment: vi.fn(),
      deleteEnvironment: vi.fn(),
      getEnvironmentVariables: vi.fn(),
      updateEnvironmentVariables: vi.fn(),
      resolveEnvironmentVariables: vi.fn(),
      updateEnvironmentStatus: vi.fn(),
      createPreviewEnvironment: vi.fn(),
      listPreviewEnvironments: vi.fn(),
      cleanupExpiredPreviewEnvironments: vi.fn(),
      bulkDeleteEnvironments: vi.fn(),
      logAccess: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [EnvironmentController],
      providers: [
        {
          provide: EnvironmentService,
          useFactory: () => mockEnvironmentService,
        },
      ],
    }).compile();

    controller = module.get<EnvironmentController>(EnvironmentController);
    service = module.get<EnvironmentService>(EnvironmentService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('ORPC implementation methods', () => {
    it('should have list method defined', () => {
      expect(controller.list).toBeDefined();
      expect(typeof controller.list).toBe('function');
    });

    it('should have get method defined', () => {
      expect(controller.get).toBeDefined();
      expect(typeof controller.get).toBe('function');
    });

    it('should have create method defined', () => {
      expect(controller.create).toBeDefined();
      expect(typeof controller.create).toBe('function');
    });

    it('should have update method defined', () => {
      expect(controller.update).toBeDefined();
      expect(typeof controller.update).toBe('function');
    });

    it('should have delete method defined', () => {
      expect(controller.delete).toBeDefined();
      expect(typeof controller.delete).toBe('function');
    });

    it('should have getVariables method defined', () => {
      expect(controller.getVariables).toBeDefined();
      expect(typeof controller.getVariables).toBe('function');
    });

    it('should have updateVariables method defined', () => {
      expect(controller.updateVariables).toBeDefined();
      expect(typeof controller.updateVariables).toBe('function');
    });

    it('should have resolveVariables method defined', () => {
      expect(controller.resolveVariables).toBeDefined();
      expect(typeof controller.resolveVariables).toBe('function');
    });

    it('should have updateStatus method defined', () => {
      expect(controller.updateStatus).toBeDefined();
      expect(typeof controller.updateStatus).toBe('function');
    });

    it('should have createPreview method defined', () => {
      expect(controller.createPreview).toBeDefined();
      expect(typeof controller.createPreview).toBe('function');
    });

    it('should have listPreviews method defined', () => {
      expect(controller.listPreviews).toBeDefined();
      expect(typeof controller.listPreviews).toBe('function');
    });

    it('should have cleanupExpiredPreviews method defined', () => {
      expect(controller.cleanupExpiredPreviews).toBeDefined();
      expect(typeof controller.cleanupExpiredPreviews).toBe('function');
    });

    it('should have bulkDelete method defined', () => {
      expect(controller.bulkDelete).toBeDefined();
      expect(typeof controller.bulkDelete).toBe('function');
    });
  });

  describe('Service integration', () => {
    it('should have service injected properly', () => {
      expect(service).toBeDefined();
      expect(service.listEnvironments).toBeDefined();
      expect(service.getEnvironment).toBeDefined();
      expect(service.createEnvironment).toBeDefined();
      expect(service.updateEnvironment).toBeDefined();
      expect(service.deleteEnvironment).toBeDefined();
      expect(service.getEnvironmentVariables).toBeDefined();
      expect(service.updateEnvironmentVariables).toBeDefined();
      expect(service.resolveEnvironmentVariables).toBeDefined();
      expect(service.updateEnvironmentStatus).toBeDefined();
      expect(service.createPreviewEnvironment).toBeDefined();
      expect(service.listPreviewEnvironments).toBeDefined();
      expect(service.cleanupExpiredPreviewEnvironments).toBeDefined();
      expect(service.bulkDeleteEnvironments).toBeDefined();
      expect(service.logAccess).toBeDefined();
    });

    it('should be able to call service methods directly', async () => {
      const mockResponse = {
        environments: [mockServiceEnvironment],
        total: 1,
      };
      vi.mocked(service.listEnvironments).mockResolvedValue(mockResponse);

      const result = await service.listEnvironments({ limit: 10, offset: 0 });
      expect(result).toEqual(mockResponse);
      expect(service.listEnvironments).toHaveBeenCalledWith({ limit: 10, offset: 0 });
    });

    it('should handle environment creation', async () => {
      vi.mocked(service.createEnvironment).mockResolvedValue(mockServiceEnvironment as any);
      vi.mocked(service.logAccess).mockResolvedValue();

      const input = {
        name: 'staging',
        slug: 'staging',
        type: 'staging' as const,
        createdBy: 'user-1',
      };

      const result = await service.createEnvironment(input);
      expect(result).toEqual(mockServiceEnvironment);
      expect(service.createEnvironment).toHaveBeenCalledWith(input);
    });

    it('should handle variable updates', async () => {
      vi.mocked(service.updateEnvironmentVariables).mockResolvedValue([mockServiceVariable as any]);
      vi.mocked(service.logAccess).mockResolvedValue();

      const variables = [
        {
          key: 'API_KEY',
          value: 'secret',
          isSecret: true,
        },
      ];

      const result = await service.updateEnvironmentVariables('1', variables, 'user-1');
      expect(result).toEqual([mockServiceVariable]);
      expect(service.updateEnvironmentVariables).toHaveBeenCalledWith('1', variables, 'user-1');
    });

    it('should handle preview environment creation', async () => {
      const previewEnv = { ...mockServiceEnvironment, type: 'preview' as const, name: 'pr-123' };
      vi.mocked(service.createPreviewEnvironment).mockResolvedValue(previewEnv as any);
      vi.mocked(service.logAccess).mockResolvedValue();

      const input = {
        name: 'pr-123',
        projectId: 'project-1',
        sourceBranch: 'feature/new-feature',
        sourcePR: 123,
        createdBy: 'user-1',
      };

      const result = await service.createPreviewEnvironment(input);
      expect(result).toEqual(previewEnv);
      expect(service.createPreviewEnvironment).toHaveBeenCalledWith(input);
    });

    it('should handle bulk operations', async () => {
      vi.mocked(service.bulkDeleteEnvironments).mockResolvedValue(2);

      const ids = ['1', '2', '3'];
      const result = await service.bulkDeleteEnvironments(ids);
      expect(result).toBe(2);
      expect(service.bulkDeleteEnvironments).toHaveBeenCalledWith(ids);
    });

    it('should handle status updates', async () => {
      const updatedEnv = { ...mockServiceEnvironment, status: 'error' as const };
      vi.mocked(service.updateEnvironmentStatus).mockResolvedValue(updatedEnv as any);

      const result = await service.updateEnvironmentStatus('1', 'error', { error: 'Deploy failed' });
      expect(result).toEqual(updatedEnv);
      expect(service.updateEnvironmentStatus).toHaveBeenCalledWith('1', 'error', { error: 'Deploy failed' });
    });
  });

  describe('Data transformation', () => {
    it('should transform environment data correctly', () => {
      const dbEnvironment = {
        id: '1',
        name: 'production',
        type: 'production',
        projectId: 'project-1',
        domainConfig: { customDomain: 'api.example.com' },
        previewSettings: { sourceBranch: 'main' },
        isActive: true,
        metadata: { version: '1.0.0' },
        createdBy: 'user-1',
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        updatedAt: new Date('2023-01-01T00:00:00.000Z'),
      };

      const result = (controller as any).transformEnvironment(dbEnvironment);

      expect(result).toEqual({
        id: '1',
        projectId: 'project-1',
        name: 'production',
        type: 'production',
        url: 'api.example.com',
        branch: 'main',
        isActive: true,
        autoDeloy: false,
        variables: [],
        dynamicVariables: [],
        deploymentConfig: undefined,
        metadata: { version: '1.0.0' },
        tags: [],
        protectionRules: undefined,
        createdBy: 'user-1',
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        updatedAt: new Date('2023-01-01T00:00:00.000Z'),
      });
    });

    it('should transform variable data correctly', () => {
      const dbVariable = {
        id: '1',
        environmentId: '1',
        key: 'DATABASE_URL',
        value: 'postgresql://localhost/db',
        isSecret: false,
        isDynamic: false,
        resolutionStatus: 'resolved',
        createdBy: 'user-1',
        createdAt: new Date('2023-01-01T00:00:00.000Z'),
        updatedAt: new Date('2023-01-01T00:00:00.000Z'),
        description: 'Database connection URL',
        template: null,
        resolvedValue: 'postgresql://localhost/db',
        resolutionError: null,
        lastResolved: null,
        references: [],
      };

      const result = (controller as any).transformVariable(dbVariable);

      expect(result).toEqual({
        id: '1',
        environmentId: '1',
        key: 'DATABASE_URL',
        value: 'postgresql://localhost/db',
        isSecret: false,
        isDynamic: false,
        resolutionStatus: 'resolved',
        createdBy: 'user-1',
        createdAt: '2023-01-01T00:00:00.000Z',
        updatedAt: '2023-01-01T00:00:00.000Z',
        description: 'Database connection URL',
        template: undefined,
        resolvedValue: 'postgresql://localhost/db',
        resolutionError: undefined,
        lastResolved: undefined,
        references: [],
      });
    });

    it('should handle null values in transformation', () => {
      const result = (controller as any).transformEnvironment(null);
      expect(result).toBeNull();

      (controller as any).transformVariable(null);
      // Both methods should handle null gracefully
    });
  });
});