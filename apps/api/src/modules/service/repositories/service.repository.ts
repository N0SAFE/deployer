import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { 
  services, 
  deployments, 
  deploymentLogs, 
  projects,
  serviceDependencies 
} from '../../../core/modules/db/drizzle/schema';
import { eq, and, desc, like, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

// Types for service operations
export interface CreateServiceData {
  projectId: string;
  name: string;
  type: string;
  provider: 'github' | 'gitlab' | 'bitbucket' | 'docker_registry' | 'gitea' | 's3_bucket' | 'manual';
  builder: 'nixpack' | 'railpack' | 'dockerfile' | 'buildpack' | 'static' | 'docker_compose';
  providerConfig: Record<string, any>;
  builderConfig: Record<string, any>;
  port?: number;
  healthCheckPath?: string;
  environmentVariables?: Record<string, string>;
  resourceLimits?: {
    memory?: string;
    cpu?: string;
    storage?: string;
  };
}

export interface UpdateServiceData extends Partial<CreateServiceData> {
  isActive?: boolean;
}

export interface ServiceLogsFilter {
  level?: 'info' | 'warn' | 'error' | 'debug';
  phase?: string;
  step?: string;
  service?: string;
  stage?: string;
  startTime?: Date;
  endTime?: Date;
  search?: string;
}

@Injectable()
export class ServiceRepository {
  private readonly logger = new Logger(ServiceRepository.name);

  constructor(private readonly databaseService: DatabaseService) {}

  async findById(id: string) {
    this.logger.log(`Finding service by ID: ${id}`);
    
    const [service] = await this.databaseService.db
      .select()
      .from(services)
      .where(eq(services.id, id))
      .limit(1);
      
    return service || null;
  }

  async findByProject(projectId: string) {
    this.logger.log(`Finding services for project: ${projectId}`);
    
    return await this.databaseService.db
      .select()
      .from(services)
      .where(eq(services.projectId, projectId))
      .orderBy(desc(services.createdAt));
  }

  async create(data: CreateServiceData) {
    this.logger.log(`Creating service: ${data.name} in project: ${data.projectId}`);
    
    const [service] = await this.databaseService.db
      .insert(services)
      .values({
        projectId: data.projectId,
        name: data.name,
        type: data.type,
        provider: data.provider,
        builder: data.builder,
        providerConfig: data.providerConfig,
        builderConfig: data.builderConfig,
        port: data.port,
        healthCheckPath: data.healthCheckPath,
        environmentVariables: data.environmentVariables,
        resourceLimits: data.resourceLimits,
        isActive: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();
      
    return service;
  }

  async update(id: string, data: UpdateServiceData) {
    this.logger.log(`Updating service: ${id}`);
    
    const [service] = await this.databaseService.db
      .update(services)
      .set({
        ...data,
        updatedAt: new Date(),
      })
      .where(eq(services.id, id))
      .returning();
      
    return service;
  }

  async delete(id: string) {
    this.logger.log(`Deleting service: ${id}`);
    
    await this.databaseService.db
      .delete(services)
      .where(eq(services.id, id));
      
    return true;
  }

  async findActiveDeployments(serviceId: string) {
    this.logger.log(`Finding active deployments for service: ${serviceId}`);
    
    return await this.databaseService.db
      .select()
      .from(deployments)
      .where(
        and(
          eq(deployments.serviceId, serviceId),
          inArray(deployments.status, ['running', 'success', 'building', 'deploying'])
        )
      )
      .orderBy(desc(deployments.createdAt));
  }

  async findDeploymentLogs(
    deploymentId: string, 
    filter: ServiceLogsFilter = {},
    limit = 100,
    offset = 0
  ) {
    this.logger.log(`Finding deployment logs for: ${deploymentId}`);
    
    let query = this.databaseService.db
      .select()
      .from(deploymentLogs)
      .where(eq(deploymentLogs.deploymentId, deploymentId));

    // Apply filters
    if (filter.level) {
      query = query.where(and(
        eq(deploymentLogs.deploymentId, deploymentId),
        eq(deploymentLogs.level, filter.level)
      ));
    }

    if (filter.phase) {
      query = query.where(and(
        eq(deploymentLogs.deploymentId, deploymentId),
        eq(deploymentLogs.phase, filter.phase)
      ));
    }

    if (filter.service) {
      query = query.where(and(
        eq(deploymentLogs.deploymentId, deploymentId),
        eq(deploymentLogs.service, filter.service)
      ));
    }

    if (filter.search) {
      query = query.where(and(
        eq(deploymentLogs.deploymentId, deploymentId),
        like(deploymentLogs.message, `%${filter.search}%`)
      ));
    }

    const logs = await query
      .orderBy(desc(deploymentLogs.timestamp))
      .limit(limit)
      .offset(offset);
      
    return logs;
  }

  async createDeploymentLog(data: {
    deploymentId: string;
    level: 'info' | 'warn' | 'error' | 'debug';
    message: string;
    phase?: string;
    step?: string;
    service?: string;
    stage?: string;
    metadata?: Record<string, any>;
  }) {
    this.logger.log(`Creating deployment log for: ${data.deploymentId}`);
    
    const [log] = await this.databaseService.db
      .insert(deploymentLogs)
      .values({
        deploymentId: data.deploymentId,
        level: data.level,
        message: data.message,
        phase: data.phase,
        step: data.step,
        service: data.service,
        stage: data.stage,
        metadata: data.metadata,
        timestamp: new Date(),
      })
      .returning();
      
    return log;
  }

  async findServiceDependencies(serviceId: string) {
    this.logger.log(`Finding dependencies for service: ${serviceId}`);
    
    return await this.databaseService.db
      .select({
        id: serviceDependencies.id,
        serviceId: serviceDependencies.serviceId,
        dependsOnServiceId: serviceDependencies.dependsOnServiceId,
        isRequired: serviceDependencies.isRequired,
        dependentService: {
          id: services.id,
          name: services.name,
          type: services.type,
        }
      })
      .from(serviceDependencies)
      .innerJoin(services, eq(serviceDependencies.dependsOnServiceId, services.id))
      .where(eq(serviceDependencies.serviceId, serviceId));
  }

  async createServiceDependency(serviceId: string, dependsOnServiceId: string, isRequired = true) {
    this.logger.log(`Creating dependency: ${serviceId} depends on ${dependsOnServiceId}`);
    
    const [dependency] = await this.databaseService.db
      .insert(serviceDependencies)
      .values({
        serviceId,
        dependsOnServiceId,
        isRequired,
        createdAt: new Date(),
      })
      .returning();
      
    return dependency;
  }

  async removeServiceDependency(serviceId: string, dependsOnServiceId: string) {
    this.logger.log(`Removing dependency: ${serviceId} -> ${dependsOnServiceId}`);
    
    await this.databaseService.db
      .delete(serviceDependencies)
      .where(
        and(
          eq(serviceDependencies.serviceId, serviceId),
          eq(serviceDependencies.dependsOnServiceId, dependsOnServiceId)
        )
      );
      
    return true;
  }

  async findServicesByProject(projectId: string, activeOnly = false) {
    this.logger.log(`Finding services for project: ${projectId}, activeOnly: ${activeOnly}`);
    
    let query = this.databaseService.db
      .select({
        id: services.id,
        name: services.name,
        type: services.type,
        provider: services.provider,
        builder: services.builder,
        port: services.port,
        isActive: services.isActive,
        createdAt: services.createdAt,
        updatedAt: services.updatedAt,
        project: {
          id: projects.id,
          name: projects.name,
        }
      })
      .from(services)
      .innerJoin(projects, eq(services.projectId, projects.id))
      .where(eq(services.projectId, projectId));

    if (activeOnly) {
      query = query.where(
        and(
          eq(services.projectId, projectId),
          eq(services.isActive, true)
        )
      );
    }

    return await query.orderBy(desc(services.createdAt));
  }
}