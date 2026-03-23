import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DatabaseService } from './database.service';
import { DATABASE_CONNECTION } from '../database-connection';
import { logger } from '@repo/logger';

describe('DatabaseService', () => {
  let service: DatabaseService;
  let mockDatabase: any;

  beforeEach(async () => {
    mockDatabase = {
      execute: vi.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DATABASE_CONNECTION,
          useValue: mockDatabase,
        },
      ],
    }).compile();

    service = module.get<DatabaseService>(DatabaseService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  it('should create service with null db when DATABASE_CONNECTION is null', async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DatabaseService,
        {
          provide: DATABASE_CONNECTION,
          useValue: null,
        },
      ],
    }).compile();
    const nullDbService = module.get<DatabaseService>(DatabaseService);
    expect(nullDbService).toBeDefined();
    expect(nullDbService.isConnected).toBe(false);
  });

  describe('db getter', () => {
    it('should return database instance', () => {
      const db = service.db;
      expect(db).toBe(mockDatabase);
    });

    it('should throw ServiceUnavailableException when db is null', () => {
      service.setConnection(null);
      expect(() => service.db).toThrow('Database not configured');
    });
  });

  describe('isHealthy', () => {
    it('should return true when database query succeeds', async () => {
      mockDatabase.execute.mockResolvedValue(undefined);

      const result = await service.isHealthy();

      expect(result).toBe(true);
      expect(mockDatabase.execute).toHaveBeenCalledWith('SELECT 1');
    });

    it('should return false when database query fails', async () => {
      const loggerSpy = vi.spyOn(logger, 'error').mockImplementation(() => undefined);
      mockDatabase.execute.mockRejectedValue(new Error('Connection failed'));

      const result = await service.isHealthy();

      expect(result).toBe(false);
      expect(mockDatabase.execute).toHaveBeenCalledWith('SELECT 1');
      expect(loggerSpy).toHaveBeenCalledWith(
        'Database health check failed',
        expect.objectContaining({
          error: expect.any(Error),
        })
      );
    });
  });

  describe('setConnection', () => {
    it('should update the internal db and reflect in isConnected', () => {
      expect(service.isConnected).toBe(true);
      service.setConnection(null);
      expect(service.isConnected).toBe(false);
      service.setConnection(mockDatabase);
      expect(service.isConnected).toBe(true);
    });
  });

  describe('isConnected', () => {
    it('should return true when a db connection is present', () => {
      expect(service.isConnected).toBe(true);
    });

    it('should return false after setConnection(null)', () => {
      service.setConnection(null);
      expect(service.isConnected).toBe(false);
    });
  });
});