/**
 * Tests for DeploymentProcessor (new thin orchestration version)
 * 
 * These tests verify that:
 * 1. The processor correctly initializes with required services
 * 2. Each job handler delegates to the correct services
 * 3. Error handling works correctly
 * 4. Progress and logging are called as expected
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Test, type TestingModule } from '@nestjs/testing';
import { Logger } from '@nestjs/common';
import { DeploymentProcessor } from '../deployment.processor';
import type { Queue, Job } from 'bull';

// Mock services - created fresh for each test
function createMockDeploymentService() {
  return {
    deployService: vi.fn().mockResolvedValue({ success: true }),
    startRollback: vi.fn().mockResolvedValue('rollback-123'),
    completeRollback: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockDeploymentCleanupService() {
  return {
    cleanupDeployment: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockHealthMonitorService() {
  return {
    checkHealth: vi.fn().mockResolvedValue({ healthy: true }),
  };
}

function createMockSwarmService() {
  return {
    createStack: vi.fn().mockResolvedValue('stack-123'),
    deployStack: vi.fn().mockResolvedValue({ success: true }),
    removeStack: vi.fn().mockResolvedValue(undefined),
    updateStack: vi.fn().mockResolvedValue(undefined),
    scaleServices: vi.fn().mockResolvedValue(undefined),
    buildStack: vi.fn().mockResolvedValue(undefined),
    getStackStatus: vi.fn().mockResolvedValue({
      status: 'running',
      services: [{ name: 'web', replicas: 2 }],
      resourceUsage: { replicas: { running: 2, total: 2 } },
    }),
  };
}

function createMockResourceService() {
  return {
    allocateResources: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockSslService() {
  return {
    renewCertificate: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockTraefikService() {
  return {
    updateDomainMappings: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockJobTrackingService() {
  return {
    trackJob: vi.fn().mockResolvedValue(undefined),
  };
}

function createMockQueue(): Queue {
  return {
    add: vi.fn().mockResolvedValue({ id: 'job-1' }),
    on: vi.fn(),
    process: vi.fn(),
    name: 'deployment',
    token: '',
    clients: [],
    keyPrefix: '',
    clientName: () => '',
    toKey: (type: string) => `deployment:${type}`,
    setWorkerName: vi.fn(),
    base64Name: vi.fn(),
    nextJobFromJobData: vi.fn(),
    pause: vi.fn(),
    resume: vi.fn(),
    isPaused: vi.fn(),
    getJobCountByTypes: vi.fn(),
    getJobCounts: vi.fn(),
    getCompletedCount: vi.fn(),
    getFailedCount: vi.fn(),
    getDelayedCount: vi.fn(),
    getActiveCount: vi.fn(),
    getWaitingCount: vi.fn(),
    getPausedCount: vi.fn(),
    getJob: vi.fn(),
    getJobs: vi.fn(),
    getRepeatableJobs: vi.fn(),
    removeRepeatable: vi.fn(),
    removeRepeatableByKey: vi.fn(),
    getJobLogs: vi.fn(),
    addBulk: vi.fn(),
    removeJobs: vi.fn(),
    clean: vi.fn(),
    empty: vi.fn(),
    close: vi.fn(),
    getActive: vi.fn(),
    getCompleted: vi.fn(),
    getDelayed: vi.fn(),
    getFailed: vi.fn(),
    getWaiting: vi.fn(),
    whenCurrentJobsFinished: vi.fn(),
    isReady: vi.fn(),
    count: vi.fn(),
    removeOnComplete: false,
    removeOnFail: false,
    settings: {},
    limiter: {},
  } as unknown as Queue;
}

// Helper to create a mock job
function createMockJob<T>(data: T, name: string = 'test'): Job<T> {
  return {
    id: 'job-1',
    name,
    data,
    progress: vi.fn().mockResolvedValue(undefined),
    log: vi.fn().mockResolvedValue(undefined),
    opts: {},
    attemptsMade: 0,
    queue: {} as Queue,
    timestamp: Date.now(),
    finishedOn: undefined,
    processedOn: undefined,
    returnvalue: undefined,
    failedReason: undefined,
    stacktrace: [],
    toJSON: vi.fn(),
    update: vi.fn(),
    retry: vi.fn(),
    remove: vi.fn(),
    moveToCompleted: vi.fn(),
    moveToFailed: vi.fn(),
    promote: vi.fn(),
    lockKey: vi.fn(),
    releaseLock: vi.fn(),
    takeLock: vi.fn(),
    extendLock: vi.fn(),
    discard: vi.fn(),
    isCompleted: vi.fn(),
    isFailed: vi.fn(),
    isDelayed: vi.fn(),
    isActive: vi.fn(),
    isWaiting: vi.fn(),
    isPaused: vi.fn(),
    isStuck: vi.fn(),
    getState: vi.fn(),
  } as unknown as Job<T>;
}

describe('DeploymentProcessor (new architecture)', () => {
  let processor: DeploymentProcessor;
  let mockQueue: Queue;
  let deploymentService: ReturnType<typeof createMockDeploymentService>;
  let deploymentCleanupService: ReturnType<typeof createMockDeploymentCleanupService>;
  let healthMonitorService: ReturnType<typeof createMockHealthMonitorService>;
  let swarmService: ReturnType<typeof createMockSwarmService>;
  let resourceService: ReturnType<typeof createMockResourceService>;
  let sslService: ReturnType<typeof createMockSslService>;
  let traefikService: ReturnType<typeof createMockTraefikService>;
  let jobTrackingService: ReturnType<typeof createMockJobTrackingService>;

  beforeEach(async () => {
    // Suppress logger output in tests
    vi.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    vi.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);

    // Create fresh mocks for each test
    mockQueue = createMockQueue();
    deploymentService = createMockDeploymentService();
    deploymentCleanupService = createMockDeploymentCleanupService();
    healthMonitorService = createMockHealthMonitorService();
    swarmService = createMockSwarmService();
    resourceService = createMockResourceService();
    sslService = createMockSslService();
    traefikService = createMockTraefikService();
    jobTrackingService = createMockJobTrackingService();

    // Use useFactory to directly instantiate processor with mocks
    // This ensures the mocks are properly passed to the constructor
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        {
          provide: DeploymentProcessor,
          useFactory: () => new DeploymentProcessor(
            mockQueue,
            deploymentService as any,
            deploymentCleanupService as any,
            healthMonitorService as any,
            swarmService as any,
            resourceService as any,
            sslService as any,
            traefikService as any,
            jobTrackingService as any,
          ),
        },
      ],
    }).compile();

    processor = module.get<DeploymentProcessor>(DeploymentProcessor);
  });

  describe('Processor Initialization', () => {
    it('should be defined', () => {
      expect(processor).toBeDefined();
    });

    it('should have all required handler methods', () => {
      expect(processor.handleBuild).toBeDefined();
      expect(processor.handleDeploy).toBeDefined();
      expect(processor.handleUpdate).toBeDefined();
      expect(processor.handleRemove).toBeDefined();
      expect(processor.handleScale).toBeDefined();
      expect(processor.handleTraefikConfigUpdate).toBeDefined();
      expect(processor.handleCertificateRenewal).toBeDefined();
      expect(processor.handleCleanup).toBeDefined();
      expect(processor.handleHealthCheck).toBeDefined();
      expect(processor.handleOrchestrationDeployUpload).toBeDefined();
      expect(processor.handleSendAlertNotification).toBeDefined();
      expect(processor.handleRollback).toBeDefined();
      expect(processor.handleDeployUpload).toBeDefined();
    });
  });

  describe('Build Job Handler', () => {
    it('should delegate build to swarm service', async () => {
      const job = createMockJob({
        stackName: 'test-stack',
        buildArgs: { NODE_ENV: 'production' },
      }, 'build');

      await processor.handleBuild(job);

      expect(swarmService.buildStack).toHaveBeenCalledWith(
        'test-stack',
        { NODE_ENV: 'production' }
      );
    });

    it('should handle build without buildArgs', async () => {
      const job = createMockJob({
        stackName: 'test-stack',
      }, 'build');

      await processor.handleBuild(job);

      expect(swarmService.buildStack).toHaveBeenCalledWith(
        'test-stack',
        undefined
      );
    });

    it('should report progress during build', async () => {
      const job = createMockJob({
        stackName: 'test-stack',
      }, 'build');

      await processor.handleBuild(job);

      expect(job.progress).toHaveBeenCalled();
    });
  });

  describe('Deploy Job Handler', () => {
    it('should handle standard deployment with deploymentId', async () => {
      const job = createMockJob({
        deploymentId: 'deploy-123',
        projectId: 'project-456',
        serviceId: 'service-789',
        sourceConfig: {
          type: 'upload' as const,
          uploadPath: '/tmp/upload',
        },
      }, 'deploy');

      await processor.handleDeploy(job);

      expect(deploymentService.deployService).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: 'deploy-123',
          serviceName: 'service-789',
          projectId: 'project-456',
        })
      );
    });

    it('should handle orchestration deployment with stackId', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'my-stack',
        composeConfig: { version: '3.8', services: {} },
      }, 'deploy');

      await processor.handleDeploy(job);

      expect(swarmService.deployStack).toHaveBeenCalledWith(
        'stack-123',
        'my-stack',
        { version: '3.8', services: {} }
      );
    });
  });

  describe('Update Job Handler', () => {
    it('should delegate update to swarm service', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
        updates: { replicas: 3 },
      }, 'update');

      await processor.handleUpdate(job);

      expect(swarmService.updateStack).toHaveBeenCalledWith(
        'stack-123',
        { replicas: 3 }
      );
    });
  });

  describe('Remove Job Handler', () => {
    it('should delegate removal to swarm service', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
      }, 'remove');

      await processor.handleRemove(job);

      expect(swarmService.removeStack).toHaveBeenCalledWith('stack-123');
    });
  });

  describe('Scale Job Handler', () => {
    it('should delegate scaling to swarm service', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
        serviceScales: { web: 3, worker: 5 },
      }, 'scale');

      await processor.handleScale(job);

      expect(swarmService.scaleServices).toHaveBeenCalledWith(
        'stack-123',
        { web: 3, worker: 5 }
      );
    });
  });

  describe('Traefik Config Job Handler', () => {
    it('should delegate to traefik service with mapped domain config', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
        domainMappings: {
          'example.com': { service: 'web', port: 8080 },
          'api.example.com': { service: 'api', port: 3000 },
        },
      }, 'update-traefik-config');

      await processor.handleTraefikConfigUpdate(job);

      expect(traefikService.updateDomainMappings).toHaveBeenCalledWith(
        'stack-123',
        expect.arrayContaining([
          expect.objectContaining({ domain: 'example.com', service: 'web', port: 8080 }),
          expect.objectContaining({ domain: 'api.example.com', service: 'api', port: 3000 }),
        ])
      );
    });

    it('should use default service and port when not specified', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
        domainMappings: {
          'example.com': {},
        },
      }, 'update-traefik-config');

      await processor.handleTraefikConfigUpdate(job);

      expect(traefikService.updateDomainMappings).toHaveBeenCalledWith(
        'stack-123',
        expect.arrayContaining([
          expect.objectContaining({ domain: 'example.com', service: 'test-stack', port: 80 }),
        ])
      );
    });
  });

  describe('Certificate Renewal Job Handler', () => {
    it('should delegate to SSL service', async () => {
      const job = createMockJob({
        domain: 'example.com',
      }, 'renew-certificate');

      await processor.handleCertificateRenewal(job);

      expect(sslService.renewCertificate).toHaveBeenCalledWith('example.com');
    });
  });

  describe('Cleanup Job Handler', () => {
    it('should delegate cleanup to swarm service', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
        cleanupType: 'all' as const,
      }, 'cleanup');

      await processor.handleCleanup(job);

      expect(swarmService.removeStack).toHaveBeenCalledWith('stack-123');
    });

    it('should handle cleanup without cleanup type', async () => {
      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
      }, 'cleanup');

      await processor.handleCleanup(job);

      expect(swarmService.removeStack).toHaveBeenCalledWith('stack-123');
    });
  });

  describe('Health Check Job Handler', () => {
    it('should return healthy status when stack is running', async () => {
      swarmService.getStackStatus.mockResolvedValue({
        status: 'running',
        services: [{ name: 'web', replicas: 2 }],
        resourceUsage: { replicas: { running: 2, total: 2 } },
      });

      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
      }, 'health-check');

      const result = await processor.handleHealthCheck(job);

      expect(swarmService.getStackStatus).toHaveBeenCalledWith('stack-123');
      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining('passed'),
      });
    });

    it('should return unhealthy status when stack is not running', async () => {
      swarmService.getStackStatus.mockResolvedValue({
        status: 'stopped',
        services: [],
        resourceUsage: { replicas: { running: 0, total: 2 } },
      });

      const job = createMockJob({
        stackId: 'stack-123',
        stackName: 'test-stack',
      }, 'health-check');

      const result = await processor.handleHealthCheck(job);

      expect(result).toMatchObject({
        success: false,
        message: expect.stringContaining('failed'),
      });
    });
  });

  describe('Orchestration Deploy Upload Job Handler', () => {
    it('should create and deploy a stack from uploaded source', async () => {
      swarmService.createStack.mockResolvedValue('new-stack-123');

      const job = createMockJob({
        uploadId: 'abc123defgh456',
        serviceId: 'my-service',
        extractPath: '/tmp/extracted',
        projectId: 'project-456',
        domain: 'app.example.com',
      }, 'orchestration-deploy-upload');

      const result = await processor.handleOrchestrationDeployUpload(job);

      // stackName = 'upload-' + uploadId.slice(0,8) = 'upload-abc123de'
      expect(swarmService.createStack).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'upload-abc123de',
          projectId: 'project-456',
          environment: 'production',
          domain: 'app.example.com',
        })
      );
      expect(swarmService.deployStack).toHaveBeenCalledWith(
        'new-stack-123',
        'upload-abc123de',
        expect.any(Object)
      );
      expect(result).toMatchObject({
        success: true,
        stackId: 'new-stack-123',
        type: 'upload',
        domain: 'app.example.com',
      });
    });

    it('should handle deploy upload without domain', async () => {
      swarmService.createStack.mockResolvedValue('new-stack-456');

      const job = createMockJob({
        uploadId: 'xyz789mnopq123',
        serviceId: 'my-service',
        extractPath: '/tmp/extracted',
        projectId: 'project-789',
      }, 'orchestration-deploy-upload');

      const result = await processor.handleOrchestrationDeployUpload(job);

      expect(result).toMatchObject({
        success: true,
        domain: null,
      });
    });
  });

  describe('Alert Notification Job Handler', () => {
    it('should log alert and return success', async () => {
      const job = createMockJob({
        alert: {
          stackId: 'stack-123',
          alertType: 'high-cpu',
          severity: 'warning',
          message: 'CPU usage above 80%',
          currentValue: 85,
          threshold: 80,
        },
      }, 'send-alert-notification');

      const result = await processor.handleSendAlertNotification(job);

      expect(result).toMatchObject({
        success: true,
        message: expect.stringContaining('high-cpu'),
      });
    });
  });

  describe('Rollback Job Handler', () => {
    it('should start and complete rollback', async () => {
      deploymentService.startRollback.mockResolvedValue('rollback-abc');

      const job = createMockJob({
        deploymentId: 'deploy-current',
        targetDeploymentId: 'deploy-previous',
      }, 'rollback');

      const result = await processor.handleRollback(job);

      expect(deploymentService.startRollback).toHaveBeenCalledWith(
        'deploy-current',
        'deploy-previous'
      );
      expect(deploymentService.completeRollback).toHaveBeenCalledWith('rollback-abc');
      expect(result).toMatchObject({
        success: true,
        deploymentId: 'deploy-previous',
      });
    });
  });

  describe('Deploy Upload Job Handler', () => {
    it('should deploy service from uploaded files', async () => {
      const job = createMockJob({
        uploadId: 'upload-123',
        serviceId: 'my-service',
        deploymentId: 'deploy-456',
        extractPath: '/tmp/upload/extracted',
        environment: 'staging',
      }, 'deploy-upload');

      const result = await processor.handleDeployUpload(job);

      expect(deploymentService.deployService).toHaveBeenCalledWith(
        expect.objectContaining({
          deploymentId: 'deploy-456',
          serviceName: 'my-service',
          sourcePath: '/tmp/upload/extracted',
          buildType: 'dockerfile',
          environmentVariables: { NODE_ENV: 'staging' },
        })
      );
      expect(result).toMatchObject({
        success: true,
        deploymentId: 'deploy-456',
      });
    });

    it('should handle deploy upload without environment', async () => {
      const job = createMockJob({
        uploadId: 'upload-789',
        serviceId: 'another-service',
        deploymentId: 'deploy-789',
        extractPath: '/tmp/upload/extracted',
      }, 'deploy-upload');

      await processor.handleDeployUpload(job);

      expect(deploymentService.deployService).toHaveBeenCalledWith(
        expect.objectContaining({
          environmentVariables: undefined,
        })
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw error and log when build fails', async () => {
      swarmService.buildStack.mockRejectedValue(new Error('Build failed'));

      const job = createMockJob({
        stackName: 'failing-stack',
      }, 'build');

      await expect(processor.handleBuild(job)).rejects.toThrow('Build failed');
    });

    it('should throw error when deployment fails', async () => {
      deploymentService.deployService.mockRejectedValue(new Error('Deploy failed'));

      const job = createMockJob({
        deploymentId: 'deploy-123',
        projectId: 'project-456',
        serviceId: 'service-789',
        sourceConfig: { type: 'upload' as const },
      }, 'deploy');

      await expect(processor.handleDeploy(job)).rejects.toThrow('Deploy failed');
    });

    it('should throw error when rollback fails', async () => {
      deploymentService.startRollback.mockRejectedValue(new Error('Rollback failed'));

      const job = createMockJob({
        deploymentId: 'deploy-current',
        targetDeploymentId: 'deploy-previous',
      }, 'rollback');

      await expect(processor.handleRollback(job)).rejects.toThrow('Rollback failed');
    });

    it('should throw error when health check fails', async () => {
      swarmService.getStackStatus.mockRejectedValue(new Error('Stack not found'));

      const job = createMockJob({
        stackId: 'missing-stack',
        stackName: 'test-stack',
      }, 'health-check');

      await expect(processor.handleHealthCheck(job)).rejects.toThrow('Stack not found');
    });
  });
});
