import { Injectable, Logger } from '@nestjs/common';
import { ResourceUsage } from '@repo/api-contracts/modules/orchestration';

export interface ResourceQuota {
  cpuLimit?: string;
  memoryLimit?: string;
  storageLimit?: string;
  maxReplicas?: number;
  maxServices?: number;
}

export interface ResourceCapacityCheck {
  allowed: boolean;
  violations: string[];
}

export interface ResourceAllocation {
  projectId: string;
  environment: string;
  quotas: ResourceQuota;
  usage: ResourceUsage;
  lastUpdated: Date;
}

export interface SystemResourceSummary {
  totalCpu: { allocated: number; used: number; limit: number };
  totalMemory: { allocated: number; used: number; limit: number };
  totalStorage: { allocated: number; used: number; limit: number };
  totalReplicas: { total: number; running: number };
  totalServices: number;
  projectCount: number;
}

export interface ResourceAlert {
  id: string;
  severity: 'warning' | 'critical';
  projectId: string;
  environment: string;
  resource: 'cpu' | 'memory' | 'storage' | 'replicas';
  message: string;
  threshold: number;
  currentUsage: number;
  timestamp: Date;
}

@Injectable()
export class ResourceAllocationService {
  private readonly logger = new Logger(ResourceAllocationService.name);

  async getResourceQuotas(_projectId: string, _environment: string): Promise<ResourceQuota> {
    return this.getDefaultQuotas();
  }

  async getCurrentResourceUsage(_projectId: string, _environment: string): Promise<ResourceUsage> {
    return this.getEmptyUsage();
  }

  calculateResourceRequirements(_composeConfig: any): ResourceUsage {
    return this.getEmptyUsage();
  }

  async checkResourceCapacity(
    projectId: string,
    environment: string,
    requestedResources: Partial<ResourceUsage>
  ): Promise<ResourceCapacityCheck> {
    try {
      const quotas = await this.getResourceQuotas(projectId, environment);
      const currentUsage = await this.getCurrentResourceUsage(projectId, environment);
      const violations: string[] = [];

      // Check CPU capacity
      if (requestedResources.cpu && quotas.cpuLimit) {
        const newCpuUsage = (currentUsage.cpu.allocated || 0) + (requestedResources.cpu.allocated || 0);
        const cpuLimit = parseFloat(quotas.cpuLimit);
        if (newCpuUsage > cpuLimit) {
          violations.push(`CPU limit exceeded: ${newCpuUsage} > ${cpuLimit}`);
        }
      }

      // Check memory capacity
      if (requestedResources.memory && quotas.memoryLimit) {
        const newMemoryUsage = (currentUsage.memory.allocated || 0) + (requestedResources.memory.allocated || 0);
        const memoryLimit = this.parseMemoryString(quotas.memoryLimit);
        if (newMemoryUsage > memoryLimit) {
          violations.push(`Memory limit exceeded: ${this.formatBytes(newMemoryUsage)} > ${quotas.memoryLimit}`);
        }
      }

      // Check replica limit
      if (requestedResources.replicas && quotas.maxReplicas) {
        const newReplicas = (currentUsage.replicas.total || 0) + (requestedResources.replicas.total || 0);
        if (newReplicas > quotas.maxReplicas) {
          violations.push(`Replica limit exceeded: ${newReplicas} > ${quotas.maxReplicas}`);
        }
      }

      // Check service limit
      if (requestedResources.services && quotas.maxServices) {
        const newServices = (currentUsage.services || 0) + (requestedResources.services || 0);
        if (newServices > quotas.maxServices) {
          violations.push(`Service limit exceeded: ${newServices} > ${quotas.maxServices}`);
        }
      }

      return {
        allowed: violations.length === 0,
        violations
      };
    } catch (error) {
      this.logger.error('Failed to check resource capacity:', error);
      return {
        allowed: false,
        violations: ['Failed to validate resource capacity']
      };
    }
  }

  async setResourceQuotas(
    projectId: string,
    environment: string,
    quotas: ResourceQuota
  ): Promise<void> {
    try {
      // TODO: Persist quotas to database
      this.logger.log(`Setting resource quotas for ${projectId}:${environment}`, quotas);
      
      // For now, just log the operation
      // In a real implementation, this would save to the orchestrationStacks table
    } catch (error) {
      this.logger.error(`Failed to set resource quotas for ${projectId}:`, error);
      throw error;
    }
  }

  async getResourceAllocation(
    projectId: string,
    environment: string
  ): Promise<ResourceAllocation | null> {
    try {
      const quotas = await this.getResourceQuotas(projectId, environment);
      const usage = await this.getCurrentResourceUsage(projectId, environment);

      return {
        projectId,
        environment,
        quotas,
        usage,
        lastUpdated: new Date()
      };
    } catch (error) {
      this.logger.error(`Failed to get resource allocation for ${projectId}:`, error);
      return null;
    }
  }

  async getSystemResourceSummary(): Promise<SystemResourceSummary> {
    try {
      // TODO: Calculate actual system-wide resource usage from database
      // This would query all orchestrationStacks and aggregate their usage
      
      return {
        totalCpu: { allocated: 4, used: 2.1, limit: 16 },
        totalMemory: { allocated: 8589934592, used: 4294967296, limit: 34359738368 }, // bytes
        totalStorage: { allocated: 107374182400, used: 53687091200, limit: 1099511627776 }, // bytes
        totalReplicas: { total: 15, running: 12 },
        totalServices: 8,
        projectCount: 3
      };
    } catch (error) {
      this.logger.error('Failed to get system resource summary:', error);
      throw error;
    }
  }

  async checkResourceAlerts(): Promise<ResourceAlert[]> {
    try {
      const alerts: ResourceAlert[] = [];
      
      // TODO: Check actual resource usage against thresholds
      // This would query the database and check for resource usage over 80% (warning) or 95% (critical)
      
      // Mock alert for demonstration
      alerts.push({
        id: 'alert-1',
        severity: 'warning',
        projectId: 'project-1',
        environment: 'production',
        resource: 'memory',
        message: 'Memory usage is above 80% threshold',
        threshold: 80,
        currentUsage: 85,
        timestamp: new Date()
      });

      return alerts;
    } catch (error) {
      this.logger.error('Failed to check resource alerts:', error);
      throw error;
    }
  }

  private getDefaultQuotas(): ResourceQuota {
    return {
      cpuLimit: '2',
      memoryLimit: '2Gi',
      storageLimit: '20Gi',
      maxReplicas: 5,
      maxServices: 10
    };
  }

  private getEmptyUsage(): ResourceUsage {
    return {
      cpu: { allocated: 0, used: 0, percentage: 0 },
      memory: { allocated: 0, used: 0, percentage: 0 },
      storage: { allocated: 0, used: 0, percentage: 0 },
      replicas: { total: 0, running: 0 },
      services: 0
    };
  }

  private parseMemoryString(memoryStr: string): number {
    const value = parseFloat(memoryStr);
    const unit = memoryStr.replace(/[\d.]/g, '').toLowerCase();

    switch (unit) {
      case 'k':
      case 'kb':
        return value * 1024;
      case 'm':
      case 'mb':
        return value * 1024 * 1024;
      case 'g':
      case 'gb':
      case 'gi':
        return value * 1024 * 1024 * 1024;
      case 't':
      case 'tb':
      case 'ti':
        return value * 1024 * 1024 * 1024 * 1024;
      default:
        return value;
    }
  }

  private formatBytes(bytes: number): string {
    const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
    if (bytes === 0) return '0 Bytes';
    
    const i = Math.floor(Math.log(bytes) / Math.log(1024));
    return Math.round(bytes / Math.pow(1024, i) * 100) / 100 + ' ' + sizes[i];
  }
}
