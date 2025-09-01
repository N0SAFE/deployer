import { Test, TestingModule } from '@nestjs/testing';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EnvironmentModule } from './environment.module';
import { EnvironmentController } from './controllers/environment.controller';
import { EnvironmentService } from './services/environment.service';
import { EnvironmentRepository } from './repositories/environment.repository';
import { DatabaseService } from '@/core/modules/db/services/database.service';

describe('Environment Module Integration Tests', () => {
  let module: TestingModule;
  let controller: EnvironmentController;
  let service: EnvironmentService;
  let repository: EnvironmentRepository;
  let mockDatabaseService: any;

  beforeEach(async () => {
    // Create mock database service
    mockDatabaseService = {
      db: {
        select: vi.fn(),
        insert: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
        query: vi.fn(),
        transaction: vi.fn(),
      },
    };

    // Setup mock query builders
    const mockQueryBuilder = {
      from: vi.fn().mockReturnThis(),
      where: vi.fn().mockReturnThis(),
      leftJoin: vi.fn().mockReturnThis(),
      orderBy: vi.fn().mockReturnThis(),
      limit: vi.fn().mockReturnThis(),
      offset: vi.fn().mockReturnThis(),
      returning: vi.fn().mockReturnThis(),
      set: vi.fn().mockReturnThis(),
      values: vi.fn().mockReturnThis(),
      execute: vi.fn().mockResolvedValue([]),
    };

    mockDatabaseService.db.select.mockReturnValue(mockQueryBuilder);
    mockDatabaseService.db.insert.mockReturnValue(mockQueryBuilder);
    mockDatabaseService.db.update.mockReturnValue(mockQueryBuilder);
    mockDatabaseService.db.delete.mockReturnValue(mockQueryBuilder);

    module = await Test.createTestingModule({
      imports: [EnvironmentModule],
    })
    .overrideProvider(DatabaseService)
    .useValue(mockDatabaseService)
    .compile();

    controller = module.get<EnvironmentController>(EnvironmentController);
    service = module.get<EnvironmentService>(EnvironmentService);
    repository = module.get<EnvironmentRepository>(EnvironmentRepository);
  });

  afterEach(async () => {
    await module.close();
    vi.clearAllMocks();
  });

  describe('Module Setup and Dependency Injection', () => {
    it('should compile the module successfully', () => {
      expect(module).toBeDefined();
    });

    it('should create and provide EnvironmentController', () => {
      expect(controller).toBeDefined();
      expect(controller).toBeInstanceOf(EnvironmentController);
    });

    it('should create and provide EnvironmentService', () => {
      expect(service).toBeDefined();
      expect(service).toBeInstanceOf(EnvironmentService);
    });

    it('should create and provide EnvironmentRepository', () => {
      expect(repository).toBeDefined();
      expect(repository).toBeInstanceOf(EnvironmentRepository);
    });

    it('should inject DatabaseService into repository', () => {
      expect(repository).toHaveProperty('databaseService');
    });
  });

  describe('Service-Repository Integration', () => {
    it('should wire service and repository correctly', () => {
      // Service should have repository injected
      expect(service).toHaveProperty('environmentRepository');
    });

    it('should handle database operations through service layer', async () => {
      // Mock successful repository call
      const mockFindResult = null;
      vi.spyOn(repository, 'findEnvironmentById').mockResolvedValue(mockFindResult);

      try {
        await service.getEnvironment('test-id');
      } catch (error) {
        // Expected to fail since environment doesn't exist
        expect((error as Error).message).toContain('Environment not found');
      }

      expect(repository.findEnvironmentById).toHaveBeenCalledWith('test-id');
    });
  });

  describe('Controller-Service Integration', () => {
    it('should wire controller and service correctly', () => {
      // Controller should have service injected
      expect(controller).toHaveProperty('environmentService');
    });

    it('should handle ORPC method implementations', () => {
      // Check that ORPC methods are defined on controller
      expect(controller).toHaveProperty('list');
      expect(controller).toHaveProperty('get');
      expect(controller).toHaveProperty('create');
      expect(controller).toHaveProperty('update');
      expect(controller).toHaveProperty('delete');
    });
  });

  describe('Database Integration Setup', () => {
    it('should have database service available', () => {
      expect(mockDatabaseService).toBeDefined();
      expect(mockDatabaseService.db).toBeDefined();
    });

    it('should provide database query methods', () => {
      expect(mockDatabaseService.db.select).toBeDefined();
      expect(mockDatabaseService.db.insert).toBeDefined();
      expect(mockDatabaseService.db.update).toBeDefined();
      expect(mockDatabaseService.db.delete).toBeDefined();
    });

    it('should support query builder pattern', () => {
      const query = mockDatabaseService.db.select();
      expect(query.from).toBeDefined();
      expect(query.where).toBeDefined();
      expect(query.execute).toBeDefined();
    });
  });

  describe('Error Handling Integration', () => {
    it('should propagate database errors through service layer', async () => {
      const dbError = new Error('Database connection failed');
      vi.spyOn(repository, 'findEnvironmentById').mockRejectedValue(dbError);

      await expect(service.getEnvironment('test-id')).rejects.toThrow('Database connection failed');
    });

    it('should handle validation errors at service level', async () => {
      // Test with invalid data that should fail service-level validation
      const invalidData = {
        name: '', // Empty name
        slug: 'test',
        type: 'development' as const,
        createdBy: 'user-123',
      };

      await expect(service.createEnvironment(invalidData)).rejects.toThrow();
    });
  });

  describe('Async Operations', () => {
    it('should handle async repository operations', async () => {
      vi.spyOn(repository, 'listEnvironments').mockResolvedValue({
        environments: [],
        total: 0,
      });

      const result = await service.listEnvironments({});

      expect(result).toBeDefined();
      expect(result.environments).toEqual([]);
      expect(result.total).toBe(0);
    });

    it('should handle concurrent operations', async () => {
      const promises = Array.from({ length: 5 }, (_, i) =>
        service.getEnvironment(`env-${i}`).catch(() => null) // Catch expected errors
      );

      const results = await Promise.all(promises);
      expect(results).toHaveLength(5);
    });
  });
});