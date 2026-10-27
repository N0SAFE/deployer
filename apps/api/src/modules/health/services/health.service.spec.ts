import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { HealthService } from './health.service';
import { AppLifecycleService } from '@deployer/nest-lifecycle';

describe('HealthService', () => {
  let service: HealthService;
  let mockRepository: any;
  let mockLifecycle: any;
  let mockSupervisors: any;
  let mockReadiness: any;

  beforeEach(async () => {
    mockRepository = {
      checkDatabaseHealth: vi.fn(),
      getMemoryInfo: vi.fn(),
      getUptime: vi.fn(),
    };

    mockLifecycle = {
      getSnapshot: vi.fn().mockReturnValue({
        phase: 'initialized',
        step: null,
        message: 'Test',
        timestamp: new Date().toISOString(),
      }),
    };

    mockSupervisors = {
      getHealthOfAll: vi.fn().mockResolvedValue([]),
    };

    // The readiness probe's RESULT shape (statusCode + body), not a raw Terminus
    // result: `getDetailedHealth` reads `info`/`error` off the body, which is what the
    // 503-vs-200 wrapper produces.
    mockReadiness = {
      probe: vi.fn().mockResolvedValue({
        statusCode: 200,
        body: {
          status: 'ok',
          info: { database: { status: 'up' } },
          checkedAt: new Date().toISOString(),
        },
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: HealthService,
          useFactory: () => new HealthService(mockRepository, mockLifecycle, mockSupervisors, mockReadiness),
        },
      ],
    }).compile();

    service = module.get<HealthService>(HealthService);
    
    // Reset mocks
    vi.clearAllMocks();
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getHealth', () => {
    it('should return basic health status', () => {
      const result = service.getHealth();

      expect(result).toMatchObject({
        status: 'ok',
        service: 'nestjs-api',
      });
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp === 'string' || typeof result.timestamp === 'object').toBe(true);
    });
  });

  describe('getReadiness', () => {
    it('should return ready status when database is healthy', async () => {
      const mockCheckHealth = mockRepository.checkDatabaseHealth;
      mockCheckHealth.mockResolvedValue({
        status: 'ok',
        timestamp: new Date().toISOString(),
        responseTime: 10,
      });

      const result = await service.getReadiness();

      expect(result).toMatchObject({
        status: 'ready',
        service: 'nestjs-api',
      });
      expect(result.timestamp).toBeDefined();
      expect(mockCheckHealth).toHaveBeenCalledOnce();
    });

    it('should return not-ready status when database is unhealthy', async () => {
      const mockCheckHealth = mockRepository.checkDatabaseHealth;
      mockCheckHealth.mockResolvedValue({
        status: 'error',
        timestamp: new Date().toISOString(),
        responseTime: 1000,
        error: 'Connection failed',
      });

      const result = await service.getReadiness();

      expect(result).toMatchObject({
        status: 'not-ready',
        service: 'nestjs-api',
      });
      expect(result.timestamp).toBeDefined();
      expect(mockCheckHealth).toHaveBeenCalledOnce();
    });
  });

  describe('getLiveness', () => {
    it('should return alive status', () => {
      const result = service.getLiveness();

      expect(result).toMatchObject({
        status: 'alive',
        service: 'nestjs-api',
      });
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('getDetailedHealth', () => {
    /**
     * The contract's report shape.
     *
     * `info` / `error` / `details` are Terminus' OWN payload fields, and `indicators` is the
     * flattened list a UI renders. The probe is what produces them, so the assertion is about
     * the TRANSLATION (probe result -> contract report) rather than about SQL.
     */
    it('reports ok with the indicators the probe found, when everything is up', async () => {
      const mockUptime = 123.45;
      mockRepository.getUptime.mockReturnValue(mockUptime);
      mockReadiness.probe.mockResolvedValue({
        statusCode: 200,
        body: {
          status: 'ok',
          info: { database: { status: 'up' }, swarm: { status: 'up' } },
          checkedAt: new Date().toISOString(),
        },
      });

      const result = await service.getDetailedHealth();

      expect(result).toMatchObject({
        status: 'ok',
        service: 'nestjs-api',
        uptime: mockUptime,
      });
      expect(result.timestamp).toBeDefined();
      expect(result.info).toEqual({ database: { status: 'up' }, swarm: { status: 'up' } });
      // `error` is an empty record rather than absent: the contract declares it required, and
      // a client reading `error` should not have to guard for undefined.
      expect(result.error).toEqual({});
      // The flattened list is narrowed to the contract's enum, which is what lets a UI render
      // one of two dots instead of inventing a third state.
      expect(result.indicators).toEqual([
        { name: 'database', status: 'up', latencyMs: 0, detail: { status: 'up' } },
        { name: 'swarm', status: 'up', latencyMs: 0, detail: { status: 'up' } },
      ]);
      expect(mockReadiness.probe).toHaveBeenCalledOnce();
      expect(mockRepository.getUptime).toHaveBeenCalledOnce();
    });

    it('reports degraded and carries the failing indicator when a dependency is down', async () => {
      mockRepository.getUptime.mockReturnValue(1);
      mockReadiness.probe.mockResolvedValue({
        statusCode: 503,
        body: {
          status: 'error',
          info: {},
          error: { database: { status: 'down', message: 'Connection timeout' } },
          checkedAt: new Date().toISOString(),
        },
      });

      const result = await service.getDetailedHealth();

      expect(result.status).toBe('degraded');
      // A down indicator must appear with its reason: "something is wrong" without the
      // component is not actionable.
      expect(result.indicators).toEqual([
        {
          name: 'database',
          status: 'down',
          latencyMs: 0,
          message: 'Connection timeout',
          detail: { status: 'down', message: 'Connection timeout' },
        },
      ]);
      expect(result.details).toMatchObject({ database: { status: 'down' } });
    });
  });
});
