import { Controller, Logger, UseGuards } from '@nestjs/common';
import { Implement, implement } from '@orpc/nest';
import { projectContract } from '@repo/api-contracts';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { projects, projectCollaborators } from '../../../core/modules/db/drizzle/schema';
import { eq, desc, count, ilike, asc } from 'drizzle-orm';
import { randomUUID } from 'crypto';
import { Session } from '@/modules/auth/decorators/decorators';
import { UserSession } from '@/modules/auth/guards/auth.guard';

@Controller()
export class ProjectController {
  private readonly logger = new Logger(ProjectController.name);

  constructor(private readonly databaseService: DatabaseService) {}

  @Implement(projectContract.list)
  list() {
    return implement(projectContract.list).handler(async ({ input }) => {
      this.logger.log('Listing projects');

      // Handle optional input with defaults - properly type the input parameter
      const limit = input?.limit || 20;
      const offset = input?.offset || 0;
      const search = input?.search;
      const sortBy = input?.sortBy || 'updatedAt';
      const sortOrder = input?.sortOrder || 'desc';

      // Get database connection
      const db = this.databaseService.db;

      // Create conditions and sorting
      const whereCondition = search ? ilike(projects.name, `%${search}%`) : undefined;
      
      // Determine sort column and order
      const sortColumn = sortBy === 'name' ? projects.name : 
                        sortBy === 'createdAt' ? projects.createdAt : 
                        projects.updatedAt;
      const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

      // Execute queries directly without chaining to avoid TypeScript issues
      const projectList = await (whereCondition 
        ? db.select().from(projects).where(whereCondition).orderBy(orderBy).limit(limit).offset(offset)
        : db.select().from(projects).orderBy(orderBy).limit(limit).offset(offset));

      const countResult = await (whereCondition
        ? db.select({ count: count() }).from(projects).where(whereCondition)
        : db.select({ count: count() }).from(projects));
      
      const total = countResult[0]?.count ?? 0;

      // Calculate hasMore for pagination
      const hasMore = offset + limit < total;

      // Transform to match projectWithStatsSchema
      const projectsWithStats = projectList.map(project => ({
        ...project,
        _count: {
          services: 0, // TODO: Implement service count
          deployments: 0, // TODO: Implement deployment count  
          collaborators: 0, // TODO: Implement collaborator count
        },
        latestDeployment: null, // TODO: Implement latest deployment
      }));

      return {
        projects: projectsWithStats,
        total,
        hasMore,
      };
    });
  }

  @Implement(projectContract.getById)
  getById() {
    return implement(projectContract.getById).handler(async ({ input }) => {
      this.logger.log(`Getting project by id: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Find the project
      const projectResult = await db
        .select()
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);

      if (projectResult.length === 0) {
        throw new Error('Project not found');
      }

      const project = projectResult[0];

      return {
        id: project.id,
        name: project.name,
        description: project.description,
        baseDomain: project.baseDomain,
        ownerId: project.ownerId,
        settings: project.settings,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        _count: {
          services: 0, // TODO: Implement service count
          deployments: 0, // TODO: Implement deployment count  
          collaborators: 0, // TODO: Implement collaborator count
        },
        latestDeployment: null, // TODO: Implement latest deployment
      };
    });
  }

  @Implement(projectContract.create)
  create(@Session() session: UserSession) {
    return implement(projectContract.create).handler(async ({ input }) => {
      this.logger.log(`Creating project: ${input.name}`);

      // Get database connection
      const db = this.databaseService.db;

      // Create project (let Postgres generate the UUID)
      // Create project
      const [newProject] = await db
        .insert(projects)
        .values({
          name: input.name,
          description: input.description || null,
          baseDomain: input.baseDomain || null,
          ownerId: session.user.id, // Use existing admin user ID
          settings: input.settings || null,
          createdAt: new Date(),
          updatedAt: new Date()
        })
        .returning();

      if (!newProject) {
        throw new Error('Failed to create project');
      }

      return {
        id: newProject.id,
        name: newProject.name,
        description: newProject.description,
        baseDomain: newProject.baseDomain,
        ownerId: newProject.ownerId,
        settings: newProject.settings,
        createdAt: newProject.createdAt,
        updatedAt: newProject.updatedAt,
      };
    });
  }

  @Implement(projectContract.update)
  update() {
    return implement(projectContract.update).handler(async ({ input }) => {
      this.logger.log(`Updating project: ${input.id}`);

      // Get database connection  
      const db = this.databaseService.db;

      // Build update object dynamically
      const updateData: any = {
        updatedAt: new Date()
      };

      if (input.name !== undefined) updateData.name = input.name;
      if (input.description !== undefined) updateData.description = input.description;
      if (input.baseDomain !== undefined) updateData.baseDomain = input.baseDomain;
      if (input.settings !== undefined) updateData.settings = input.settings;

      // Update project
      const [updatedProject] = await db
        .update(projects)
        .set(updateData)
        .where(eq(projects.id, input.id))
        .returning();

      if (!updatedProject) {
        throw new Error('Project not found');
      }

      return updatedProject;
    });
  }

  @Implement(projectContract.delete)
  delete() {
    return implement(projectContract.delete).handler(async ({ input }) => {
      this.logger.log(`Deleting project: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Check if project exists
      const existingProject = await db
        .select({ id: projects.id })
        .from(projects)
        .where(eq(projects.id, input.id))
        .limit(1);

      if (existingProject.length === 0) {
        return {
          success: false,
          message: 'Project not found'
        };
      }

      // Delete project (this will cascade to related tables)
      await db
        .delete(projects)
        .where(eq(projects.id, input.id));

      return {
        success: true,
        message: 'Project deleted successfully'
      };
    });
  }

  @Implement(projectContract.getCollaborators)
  getCollaborators() {
    return implement(projectContract.getCollaborators).handler(async ({ input }) => {
      this.logger.log(`Getting collaborators for project: ${input.id}`);

      // Get database connection
      const db = this.databaseService.db;

      // Get all collaborators for the project
      const collaborators = await db
        .select()
        .from(projectCollaborators)
        .where(eq(projectCollaborators.projectId, input.id));

      // Transform to match contract schema - convert null permissions to undefined
      const transformedCollaborators = collaborators.map(collaborator => ({
        ...collaborator,
        permissions: collaborator.permissions || undefined
      }));

      return { collaborators: transformedCollaborators };
    });
  }

  @Implement(projectContract.inviteCollaborator)
  inviteCollaborator() {
    return implement(projectContract.inviteCollaborator).handler(async ({ input: _input }) => {
      // TODO: Implement collaborator invitation logic
      this.logger.log('Inviting collaborator (not implemented)');

      return {
        inviteId: randomUUID(),
        message: 'Invitation sent successfully (mock implementation)'
      };
    });
  }

  @Implement(projectContract.updateCollaborator)
  updateCollaborator() {
    return implement(projectContract.updateCollaborator).handler(async ({ input: _input }) => {
      // TODO: Implement collaborator update logic
      this.logger.log('Updating collaborator (not implemented)');
      
      // Return a mock collaborator object that matches collaboratorSchema
      return {
        id: randomUUID(),
        projectId: 'mock-project-id',
        userId: 'mock-user-id',
        role: 'viewer' as const,
        invitedBy: 'system',
        invitedAt: new Date(),
        acceptedAt: new Date(),
        createdAt: new Date(),
        updatedAt: new Date(),
        permissions: {
          canDeploy: false,
          canManageServices: false,
          canManageCollaborators: false,
          canViewLogs: true,
          canDeleteDeployments: false,
        }
      };
    });
  }

  @Implement(projectContract.removeCollaborator)  
  removeCollaborator() {
    return implement(projectContract.removeCollaborator).handler(async ({ input: _input }) => {
      // TODO: Implement collaborator removal logic
      this.logger.log('Removing collaborator (not implemented)');

      return {
        success: true,
        message: 'Collaborator removed successfully (mock implementation)'
      };
    });
  }
}