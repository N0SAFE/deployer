import { Controller, Logger } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { serviceContract } from '@repo/api-contracts';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { services, serviceDependencies, projects, deployments } from '../../../core/modules/db/drizzle/schema';
import { eq, desc, count, ilike, and, or } from 'drizzle-orm';
import { nanoid } from 'nanoid';

@Controller()
export class ServiceController {
  private readonly logger = new Logger(ServiceController.name);

  constructor(private readonly databaseService: DatabaseService) {}

  @Implement(serviceContract.listByProject)
  listByProject() {
    return implement(serviceContract.listByProject).handler(async ({ input }) => {
      this.logger.log(`Listing services for project: ${input.projectId}`);

      // Get database connection
      const db = this.databaseService.db;

      // Extract parameters with defaults
      const limit = input.limit || 20;
      const offset = input.offset || 0;
      const search = input.search;
      const type = input.type;
      const isActive = input.isActive;

      // Build conditions
      const conditions = [eq(services.projectId, input.projectId)];
      
      if (search) {
        conditions.push(ilike(services.name, `%${search}%`));
      }
      
      if (type) {
        conditions.push(eq(services.type, type));
      }
      
      if (isActive !== undefined) {
        conditions.push(eq(services.isActive, isActive));
      }

      const whereClause = conditions.length === 1 ? conditions[0] : and(...conditions);

      // Execute queries
      const serviceList = await db
        .select({
          service: services,
          project: {
            id: projects.id,
            name: projects.name,
            baseDomain: projects.baseDomain,
          },
        })
        .from(services)
        .innerJoin(projects, eq(services.projectId, projects.id))
        .where(whereClause)
        .orderBy(desc(services.createdAt))
        .limit(limit)
        .offset(offset);

      const countResult = await db
        .select({ count: count() })
        .from(services)
        .where(whereClause);

      const total = countResult[0]?.count ?? 0;
      const hasMore = offset + limit < total;

      // Transform to match serviceWithStatsSchema
      const servicesWithStats = serviceList.map(({ service, project }) => ({
        id: service.id,
        projectId: service.projectId,
        name: service.name,
        type: service.type,
        dockerfilePath: service.dockerfilePath || 'Dockerfile',
        buildContext: service.buildContext || '.',
        port: service.port,
        healthCheckPath: service.healthCheckPath || '/health',
        environmentVariables: service.environmentVariables,
        buildArguments: service.buildArguments,
        resourceLimits: service.resourceLimits,
        isActive: service.isActive,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        _count: {
          deployments: 0, // TODO: Implement deployment count
          dependencies: 0, // TODO: Implement dependency count
        },
        latestDeployment: null, // TODO: Implement latest deployment
        project,
      }));

      return {
        services: servicesWithStats,
        total,
        hasMore,
      };
    });
  }

  @Implement(serviceContract.getById)
  getById() {
    return implement(serviceContract.getById).handler(async ({ input }) => {
      this.logger.log(`Getting service by id: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Find the service with project info
      const result = await db
        .select({
          service: services,
          project: {
            id: projects.id,
            name: projects.name,
            baseDomain: projects.baseDomain,
          },
        })
        .from(services)
        .innerJoin(projects, eq(services.projectId, projects.id))
        .where(eq(services.id, input.id))
        .limit(1);

      if (result.length === 0) {
        throw new Error('Service not found');
      }

      const { service, project } = result[0];

      return {
        id: service.id,
        projectId: service.projectId,
        name: service.name,
        type: service.type,
        dockerfilePath: service.dockerfilePath || 'Dockerfile',
        buildContext: service.buildContext || '.',
        port: service.port,
        healthCheckPath: service.healthCheckPath || '/health',
        environmentVariables: service.environmentVariables,
        buildArguments: service.buildArguments,
        resourceLimits: service.resourceLimits,
        isActive: service.isActive,
        createdAt: service.createdAt,
        updatedAt: service.updatedAt,
        _count: {
          deployments: 0, // TODO: Implement deployment count
          dependencies: 0, // TODO: Implement dependency count
        },
        latestDeployment: null, // TODO: Implement latest deployment
        project,
      };
    });
  }

  @Implement(serviceContract.create)
  create() {
    return implement(serviceContract.create).handler(async ({ input }) => {
      this.logger.log(`Creating service: ${input.name} for project: ${input.projectId}`);

      // Get database connection
      const db = this.databaseService.db;

      // Verify project exists
      const projectExists = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, input.projectId))
        .limit(1);

      if (projectExists.length === 0) {
        throw new Error('Project not found');
      }

      // Generate unique ID
      const id = nanoid();

      // Create service
      const [newService] = await db
        .insert(services)
        .values({
          id,
          projectId: input.projectId,
          name: input.name,
          type: input.type,
          dockerfilePath: input.dockerfilePath || 'Dockerfile',
          buildContext: input.buildContext || '.',
          port: input.port || null,
          healthCheckPath: input.healthCheckPath || '/health',
          environmentVariables: input.environmentVariables || null,
          buildArguments: input.buildArguments || null,
          resourceLimits: input.resourceLimits || null,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        })
        .returning();

      if (!newService) {
        throw new Error('Failed to create service');
      }

      return {
        id: newService.id,
        projectId: newService.projectId,
        name: newService.name,
        type: newService.type,
        dockerfilePath: newService.dockerfilePath || 'Dockerfile',
        buildContext: newService.buildContext || '.',
        port: newService.port,
        healthCheckPath: newService.healthCheckPath || '/health',
        environmentVariables: newService.environmentVariables,
        buildArguments: newService.buildArguments,
        resourceLimits: newService.resourceLimits,
        isActive: newService.isActive,
        createdAt: newService.createdAt,
        updatedAt: newService.updatedAt,
      };
    });
  }

  @Implement(serviceContract.update)
  update() {
    return implement(serviceContract.update).handler(async ({ input }) => {
      this.logger.log(`Updating service: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Check if service exists
      const existingService = await db
        .select()
        .from(services)
        .where(eq(services.id, input.id))
        .limit(1);

      if (existingService.length === 0) {
        throw new Error('Service not found');
      }

      // Update service
      const updateData: any = {
        updatedAt: new Date(),
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.type !== undefined) updateData.type = input.type;
      if (input.dockerfilePath !== undefined) updateData.dockerfilePath = input.dockerfilePath;
      if (input.buildContext !== undefined) updateData.buildContext = input.buildContext;
      if (input.port !== undefined) updateData.port = input.port;
      if (input.healthCheckPath !== undefined) updateData.healthCheckPath = input.healthCheckPath;
      if (input.environmentVariables !== undefined) updateData.environmentVariables = input.environmentVariables;
      if (input.buildArguments !== undefined) updateData.buildArguments = input.buildArguments;
      if (input.resourceLimits !== undefined) updateData.resourceLimits = input.resourceLimits;

      const [updatedService] = await db
        .update(services)
        .set(updateData)
        .where(eq(services.id, input.id))
        .returning();

      if (!updatedService) {
        throw new Error('Failed to update service');
      }

      return {
        id: updatedService.id,
        projectId: updatedService.projectId,
        name: updatedService.name,
        type: updatedService.type,
        dockerfilePath: updatedService.dockerfilePath || 'Dockerfile',
        buildContext: updatedService.buildContext || '.',
        port: updatedService.port,
        healthCheckPath: updatedService.healthCheckPath || '/health',
        environmentVariables: updatedService.environmentVariables,
        buildArguments: updatedService.buildArguments,
        resourceLimits: updatedService.resourceLimits,
        isActive: updatedService.isActive,
        createdAt: updatedService.createdAt,
        updatedAt: updatedService.updatedAt,
      };
    });
  }

  @Implement(serviceContract.delete)
  delete() {
    return implement(serviceContract.delete).handler(async ({ input }) => {
      this.logger.log(`Deleting service: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Check if service exists
      const existingService = await db
        .select()
        .from(services)
        .where(eq(services.id, input.id))
        .limit(1);

      if (existingService.length === 0) {
        throw new Error('Service not found');
      }

      // Delete the service (CASCADE will handle related records)
      await db.delete(services).where(eq(services.id, input.id));

      return {
        success: true,
        message: 'Service deleted successfully',
      };
    });
  }

  @Implement(serviceContract.getDeployments)
  getDeployments() {
    return implement(serviceContract.getDeployments).handler(async ({ input: _input }) => {
      // TODO: Implement deployment listing
      this.logger.log('Getting service deployments (not implemented)');

      return {
        deployments: [],
        total: 0,
        hasMore: false,
      };
    });
  }

  @Implement(serviceContract.getDependencies)
  getDependencies() {
    return implement(serviceContract.getDependencies).handler(async ({ input }) => {
      this.logger.log(`Getting dependencies for service: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Get all dependencies for the service
      const dependencies = await db
        .select({
          dependency: serviceDependencies,
          dependsOnService: {
            id: services.id,
            name: services.name,
            type: services.type,
          },
        })
        .from(serviceDependencies)
        .innerJoin(services, eq(serviceDependencies.dependsOnServiceId, services.id))
        .where(eq(serviceDependencies.serviceId, input.id));

      // Transform to match contract schema
      const transformedDependencies = dependencies.map(({ dependency, dependsOnService }) => ({
        id: dependency.id,
        serviceId: dependency.serviceId,
        dependsOnServiceId: dependency.dependsOnServiceId,
        isRequired: dependency.isRequired,
        createdAt: dependency.createdAt,
        dependsOnService,
      }));

      return { dependencies: transformedDependencies };
    });
  }

  @Implement(serviceContract.addDependency)
  addDependency() {
    return implement(serviceContract.addDependency).handler(async ({ input }) => {
      this.logger.log(`Adding dependency for service: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Verify both services exist
      const servicesExist = await db
        .select({ id: services.id })
        .from(services)
        .where(or(eq(services.id, input.id), eq(services.id, input.dependsOnServiceId)));

      if (servicesExist.length < 2) {
        throw new Error('One or both services not found');
      }

      // Generate unique ID
      const id = nanoid();

      // Create dependency
      const [newDependency] = await db
        .insert(serviceDependencies)
        .values({
          id,
          serviceId: input.id,
          dependsOnServiceId: input.dependsOnServiceId,
          isRequired: input.isRequired,
          createdAt: new Date(),
        })
        .returning();

      if (!newDependency) {
        throw new Error('Failed to create dependency');
      }

      return {
        id: newDependency.id,
        serviceId: newDependency.serviceId,
        dependsOnServiceId: newDependency.dependsOnServiceId,
        isRequired: newDependency.isRequired,
        createdAt: newDependency.createdAt,
      };
    });
  }

  @Implement(serviceContract.removeDependency)
  removeDependency() {
    return implement(serviceContract.removeDependency).handler(async ({ input }) => {
      this.logger.log(`Removing dependency: ${input.dependencyId} for service: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Check if dependency exists
      const existingDependency = await db
        .select()
        .from(serviceDependencies)
        .where(
          and(
            eq(serviceDependencies.id, input.dependencyId),
            eq(serviceDependencies.serviceId, input.id)
          )
        )
        .limit(1);

      if (existingDependency.length === 0) {
        throw new Error('Dependency not found');
      }

      // Delete the dependency
      await db
        .delete(serviceDependencies)
        .where(eq(serviceDependencies.id, input.dependencyId));

      return {
        success: true,
        message: 'Dependency removed successfully',
      };
    });
  }

  @Implement(serviceContract.toggleActive)
  toggleActive() {
    return implement(serviceContract.toggleActive).handler(async ({ input }) => {
      this.logger.log(`Toggling active status for service: ${input.id} to ${input.isActive}`);

      // Get database connection
      const db = this.databaseService.db;

      // Check if service exists
      const existingService = await db
        .select()
        .from(services)
        .where(eq(services.id, input.id))
        .limit(1);

      if (existingService.length === 0) {
        throw new Error('Service not found');
      }

      // Update service active status
      const [updatedService] = await db
        .update(services)
        .set({
          isActive: input.isActive,
          updatedAt: new Date(),
        })
        .where(eq(services.id, input.id))
        .returning();

      if (!updatedService) {
        throw new Error('Failed to update service status');
      }

      return {
        id: updatedService.id,
        projectId: updatedService.projectId,
        name: updatedService.name,
        type: updatedService.type,
        dockerfilePath: updatedService.dockerfilePath || 'Dockerfile',
        buildContext: updatedService.buildContext || '.',
        port: updatedService.port,
        healthCheckPath: updatedService.healthCheckPath || '/health',
        environmentVariables: updatedService.environmentVariables,
        buildArguments: updatedService.buildArguments,
        resourceLimits: updatedService.resourceLimits,
        isActive: updatedService.isActive,
        createdAt: updatedService.createdAt,
        updatedAt: updatedService.updatedAt,
      };
    });
  }
}