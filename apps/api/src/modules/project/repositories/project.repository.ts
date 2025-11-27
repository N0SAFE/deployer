/**
 * Project Repository
 * 
 * PURPOSE: Database access layer for projects, environments, collaborators, and templates
 * 
 * RESPONSIBILITIES:
 * - All database queries for project module
 * - Raw data retrieval and persistence
 * - Transaction management
 * - No business logic or transformations
 * 
 * PATTERN: Repository Pattern
 * - Encapsulates all data access
 * - Returns raw database entities
 * - Used by service layer
 */

import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '@/core/modules/database/services/database.service';
import { 
    projects, 
    projectCollaborators, 
    environments, 
    variableTemplates,
    services,
    deployments
} from '@/config/drizzle/schema';
import { user } from '@/config/drizzle/schema/auth';
import { eq, desc, ilike, asc, and, count } from 'drizzle-orm';
import type {
    GetProjectsInput,
    CreateProjectInput,
    UpdateProjectInput,
    CreateEnvironmentInput,
    UpdateEnvironmentInput,
    CreateVariableTemplateInput,
    UpdateVariableTemplateInput,
    CreateCollaboratorInput,
    UpdateCollaboratorInput,
} from '../interfaces/project.types';

@Injectable()
export class ProjectRepository {
    private readonly logger = new Logger(ProjectRepository.name);

    constructor(private readonly databaseService: DatabaseService) {}

    // ========================================
    // PROJECT CRUD
    // ========================================

    async findMany(input: GetProjectsInput = {}) {
        const db = this.databaseService.db;
        const limit = input.limit || 20;
        const offset = input.offset || 0;
        const search = input.search;
        const sortBy = input.sortBy || 'updatedAt';
        const sortOrder = input.sortOrder || 'desc';

        const whereCondition = search ? ilike(projects.name, `%${search}%`) : undefined;
        const sortColumn = sortBy === 'name' ? projects.name :
            sortBy === 'createdAt' ? projects.createdAt :
            projects.updatedAt;
        const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);

        const projectList = await (whereCondition
            ? db.select().from(projects).where(whereCondition).orderBy(orderBy).limit(limit).offset(offset)
            : db.select().from(projects).orderBy(orderBy).limit(limit).offset(offset));

        const countResult = await (whereCondition
            ? db.select({ count: count() }).from(projects).where(whereCondition)
            : db.select({ count: count() }).from(projects));

        const total = countResult[0]?.count ?? 0;

        return { projects: projectList, total };
    }

    async findById(id: string) {
        const db = this.databaseService.db;
        const [project] = await db
            .select()
            .from(projects)
            .where(eq(projects.id, id))
            .limit(1);
        return project ?? null;
    }

    async create(data: CreateProjectInput) {
        const db = this.databaseService.db;
        const [newProject] = await db
            .insert(projects)
            .values({
                name: data.name,
                description: data.description ?? null,
                baseDomain: data.baseDomain ?? null,
                ownerId: data.ownerId,
                settings: data.settings ?? null,
            })
            .returning();
        
        if (!newProject) {
            throw new Error('Failed to create project');
        }
        
        return newProject;
    }

    async update(id: string, data: UpdateProjectInput) {
        const db = this.databaseService.db;
        const updateData: Partial<typeof projects.$inferInsert> = { 
            updatedAt: new Date() 
        };
        
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.baseDomain !== undefined) updateData.baseDomain = data.baseDomain;
        if (data.settings !== undefined) updateData.settings = data.settings;

        const [updatedProject] = await db
            .update(projects)
            .set(updateData)
            .where(eq(projects.id, id))
            .returning();
        
        return updatedProject ?? null;
    }

    async delete(id: string) {
        const db = this.databaseService.db;
        await db.delete(projects).where(eq(projects.id, id));
        return { success: true };
    }

    // ========================================
    // PROJECT COLLABORATORS
    // ========================================

    async findCollaboratorsByProject(projectId: string) {
        const db = this.databaseService.db;
        return await db
            .select()
            .from(projectCollaborators)
            .where(eq(projectCollaborators.projectId, projectId));
    }

    async findCollaboratorByUserAndProject(userId: string, projectId: string) {
        const db = this.databaseService.db;
        const [collaborator] = await db
            .select()
            .from(projectCollaborators)
            .where(and(
                eq(projectCollaborators.projectId, projectId),
                eq(projectCollaborators.userId, userId)
            ))
            .limit(1);
        return collaborator || null;
    }

    async createCollaborator(data: CreateCollaboratorInput) {
        const db = this.databaseService.db;
        const [collaborator] = await db
            .insert(projectCollaborators)
            .values({
                ...data,
                // Cast role to enum type
                role: data.role as 'owner' | 'admin' | 'developer' | 'viewer',
            })
            .returning();
        return collaborator;
    }

    async updateCollaborator(collaboratorId: string, data: UpdateCollaboratorInput) {
        const db = this.databaseService.db;
        const updateData: Partial<typeof projectCollaborators.$inferInsert> = { 
            updatedAt: new Date() 
        };
        
        if (data.role !== undefined) updateData.role = data.role as 'owner' | 'admin' | 'developer' | 'viewer';
        if (data.permissions !== undefined) updateData.permissions = data.permissions;

        const [updated] = await db
            .update(projectCollaborators)
            .set(updateData)
            .where(eq(projectCollaborators.id, collaboratorId))
            .returning();
        
        if (!updated) {
            throw new Error('Failed to update collaborator');
        }
        
        return updated;
    }

    async deleteCollaborator(projectId: string, userId: string) {
        const db = this.databaseService.db;
        await db
            .delete(projectCollaborators)
            .where(and(
                eq(projectCollaborators.projectId, projectId),
                eq(projectCollaborators.userId, userId)
            ));
        return { success: true };
    }

    // ========================================
    // ENVIRONMENTS
    // ========================================

    async findEnvironmentsByProject(projectId: string, type?: string) {
        const db = this.databaseService.db;
        const conditions = [eq(environments.projectId, projectId)];
        if (type) {
            conditions.push(eq(environments.type, type as any));
        }
        
        return await db
            .select()
            .from(environments)
            .where(and(...conditions))
            .orderBy(desc(environments.createdAt));
    }

    async findEnvironmentById(environmentId: string) {
        const db = this.databaseService.db;
        const [environment] = await db
            .select()
            .from(environments)
            .where(eq(environments.id, environmentId))
            .limit(1);
        return environment || null;
    }

    async createEnvironment(data: CreateEnvironmentInput) {
        const db = this.databaseService.db;
        const [newEnvironment] = await db
            .insert(environments)
            .values({
                ...data,
                // Cast status to enum type
                status: data.status as 'healthy' | 'updating' | 'error' | 'pending' | 'inactive',
            })
            .returning();
        return newEnvironment;
    }

    async updateEnvironment(environmentId: string, data: UpdateEnvironmentInput) {
        const db = this.databaseService.db;
        const updateData: Partial<typeof environments.$inferInsert> = { 
            updatedAt: new Date() 
        };
        
        if (data.name !== undefined) {
            updateData.name = data.name;
            updateData.slug = data.name.toLowerCase().replace(/[^a-z0-9]/g, '-');
        }
        if (data.type !== undefined) updateData.type = data.type;
        if (data.domainConfig !== undefined) updateData.domainConfig = data.domainConfig;
        if (data.previewSettings !== undefined) updateData.previewSettings = data.previewSettings;
        if (data.deploymentConfig !== undefined) updateData.deploymentConfig = data.deploymentConfig;
        if (data.metadata !== undefined) updateData.metadata = data.metadata;

        const [updated] = await db
            .update(environments)
            .set(updateData)
            .where(eq(environments.id, environmentId))
            .returning();
        
        return updated ?? null;
    }

    async deleteEnvironment(environmentId: string) {
        const db = this.databaseService.db;
        await db.delete(environments).where(eq(environments.id, environmentId));
        return { success: true };
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    async findAllVariableTemplates() {
        const db = this.databaseService.db;
        return await db
            .select()
            .from(variableTemplates)
            .orderBy(desc(variableTemplates.updatedAt));
    }

    async findVariableTemplateById(templateId: string) {
        const db = this.databaseService.db;
        const [template] = await db
            .select()
            .from(variableTemplates)
            .where(eq(variableTemplates.id, templateId))
            .limit(1);
        return template || null;
    }

    async createVariableTemplate(data: CreateVariableTemplateInput) {
        const db = this.databaseService.db;
        const [newTemplate] = await db
            .insert(variableTemplates)
            .values(data)
            .returning();
        return newTemplate;
    }

    async updateVariableTemplate(templateId: string, data: UpdateVariableTemplateInput) {
        const db = this.databaseService.db;
        const updateData: Partial<typeof variableTemplates.$inferInsert> = { 
            updatedAt: new Date() 
        };
        
        if (data.name !== undefined) updateData.name = data.name;
        if (data.description !== undefined) updateData.description = data.description;
        if (data.variables !== undefined) updateData.variables = data.variables;

        const [updated] = await db
            .update(variableTemplates)
            .set(updateData)
            .where(eq(variableTemplates.id, templateId))
            .returning();
        
        return updated ?? null;
    }

    async deleteVariableTemplate(templateId: string) {
        const db = this.databaseService.db;
        await db.delete(variableTemplates).where(eq(variableTemplates.id, templateId));
        return { success: true };
    }

    // ========================================
    // USER LOOKUP
    // ========================================

    async findUserByEmail(email: string) {
        const db = this.databaseService.db;
        const [foundUser] = await db
            .select()
            .from(user)
            .where(eq(user.email, email))
            .limit(1);
        return foundUser || null;
    }

    // ========================================
    // PROJECT STATISTICS
    // ========================================

    async getServiceCountByProject(projectId: string): Promise<number> {
        const db = this.databaseService.db;
        const serviceResults = await db
            .select({ count: services.id })
            .from(services)
            .where(eq(services.projectId, projectId));
        return serviceResults.length;
    }

    async getDeploymentCountByProject(projectId: string): Promise<number> {
        const db = this.databaseService.db;
        
        // Get all service IDs for this project
        const serviceIds = await db
            .select({ id: services.id })
            .from(services)
            .where(eq(services.projectId, projectId));
        
        if (serviceIds.length === 0) return 0;
        
        // Count deployments for all services
        let deploymentCount = 0;
        for (const service of serviceIds) {
            const deploymentResults = await db
                .select({ count: deployments.id })
                .from(deployments)
                .where(eq(deployments.serviceId, service.id));
            deploymentCount += deploymentResults.length;
        }
        
        return deploymentCount;
    }

    async getCollaboratorCountByProject(projectId: string): Promise<number> {
        const db = this.databaseService.db;
        const collaboratorResults = await db
            .select({ count: projectCollaborators.id })
            .from(projectCollaborators)
            .where(eq(projectCollaborators.projectId, projectId));
        return collaboratorResults.length;
    }

    async getLatestDeploymentByProject(projectId: string) {
        const db = this.databaseService.db;
        
        // Get all service IDs for this project
        const serviceIds = await db
            .select({ id: services.id })
            .from(services)
            .where(eq(services.projectId, projectId));
        
        if (serviceIds.length === 0) return null;
        
        // Find latest deployment across all services
        let latestDeployment: typeof deployments.$inferSelect | null = null;
        for (const service of serviceIds) {
            const [deployment] = await db
                .select()
                .from(deployments)
                .where(eq(deployments.serviceId, service.id))
                .orderBy(desc(deployments.createdAt))
                .limit(1);
            
            if (deployment && (!latestDeployment || deployment.createdAt > latestDeployment.createdAt)) {
                latestDeployment = deployment;
            }
        }
        
        return latestDeployment;
    }

    async getServicesByProject(projectId: string) {
        const db = this.databaseService.db;
        return await db
            .select()
            .from(services)
            .where(eq(services.projectId, projectId));
    }
}
