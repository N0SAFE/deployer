import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../../../core/modules/db/services/database.service';
import { environments, environmentVariables, environmentServices, environmentTemplates, variableTemplates, environmentAccessLogs, } from '../../../core/modules/db/drizzle/schema';
import { eq, desc, asc, count, ilike, and, or, inArray } from 'drizzle-orm';
export type Environment = typeof environments.$inferSelect;
export type NewEnvironment = typeof environments.$inferInsert;
export type EnvironmentVariable = typeof environmentVariables.$inferSelect;
export type NewEnvironmentVariable = typeof environmentVariables.$inferInsert;
export type EnvironmentService = typeof environmentServices.$inferSelect;
export type NewEnvironmentService = typeof environmentServices.$inferInsert;
export type EnvironmentTemplate = typeof environmentTemplates.$inferSelect;
export type NewEnvironmentTemplate = typeof environmentTemplates.$inferInsert;
export type VariableTemplate = typeof variableTemplates.$inferSelect;
export type NewVariableTemplate = typeof variableTemplates.$inferInsert;
@Injectable()
export class EnvironmentRepository {
    private readonly logger = new Logger(EnvironmentRepository.name);
    constructor(private readonly databaseService: DatabaseService) { }
    // Environment CRUD operations
    async createEnvironment(data: NewEnvironment): Promise<Environment> {
        this.logger.log(`Creating environment: ${data.name}`);
        const db = this.databaseService.db;
        const [environment] = await db.insert(environments).values(data).returning();
        return environment;
    }
    async findEnvironmentById(id: string): Promise<Environment | null> {
        const db = this.databaseService.db;
        const [environment] = await db
            .select()
            .from(environments)
            .where(eq(environments.id, id));
        return environment || null;
    }
    async findEnvironmentBySlug(slug: string, projectId?: string): Promise<Environment | null> {
        const db = this.databaseService.db;
        const whereConditions = [eq(environments.slug, slug)];
        if (projectId) {
            whereConditions.push(eq(environments.projectId, projectId));
        }
        const [environment] = await db
            .select()
            .from(environments)
            .where(and(...whereConditions));
        return environment || null;
    }
    async listEnvironments(params: {
        projectId?: string;
        type?: string;
        status?: string;
        search?: string;
        limit?: number;
        offset?: number;
        sortBy?: string;
        sortOrder?: 'asc' | 'desc';
    }): Promise<{
        environments: Environment[];
        total: number;
    }> {
        const db = this.databaseService.db;
        const { projectId, type, status, search, limit = 20, offset = 0, sortBy = 'updatedAt', sortOrder = 'desc' } = params;
        // Build where conditions
        const whereConditions: any[] = [];
        if (projectId) {
            whereConditions.push(eq(environments.projectId, projectId));
        }
        if (type) {
            whereConditions.push(eq(environments.type, type as any));
        }
        if (status) {
            whereConditions.push(eq(environments.status, status as any));
        }
        if (search) {
            const searchCondition = or(ilike(environments.name, `%${search}%`), ilike(environments.description, `%${search}%`));
            if (searchCondition) {
                whereConditions.push(searchCondition);
            }
        }
        // Only show active environments by default
        whereConditions.push(eq(environments.isActive, true));
        const whereCondition = whereConditions.length > 0 ? and(...whereConditions) : undefined;
        // Determine sort column and order
        const sortColumn = sortBy === 'name' ? environments.name :
            sortBy === 'type' ? environments.type :
                sortBy === 'status' ? environments.status :
                    sortBy === 'createdAt' ? environments.createdAt :
                        environments.updatedAt;
        const orderBy = sortOrder === 'asc' ? asc(sortColumn) : desc(sortColumn);
        // Get environments
        const environmentList = await (whereCondition
            ? db.select().from(environments).where(whereCondition).orderBy(orderBy).limit(limit).offset(offset)
            : db.select().from(environments).orderBy(orderBy).limit(limit).offset(offset));
        // Get total count
        const countResult = await (whereCondition
            ? db.select({ count: count() }).from(environments).where(whereCondition)
            : db.select({ count: count() }).from(environments));
        const total = countResult[0]?.count ?? 0;
        return { environments: environmentList, total };
    }
    async updateEnvironment(id: string, updates: Partial<NewEnvironment>): Promise<Environment | null> {
        this.logger.log(`Updating environment: ${id}`);
        const db = this.databaseService.db;
        const [updated] = await db
            .update(environments)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(environments.id, id))
            .returning();
        return updated || null;
    }
    async deleteEnvironment(id: string): Promise<boolean> {
        this.logger.log(`Deleting environment: ${id}`);
        const db = this.databaseService.db;
        // Soft delete by setting isActive to false
        const [updated] = await db
            .update(environments)
            .set({ isActive: false, updatedAt: new Date() })
            .where(eq(environments.id, id))
            .returning();
        return !!updated;
    }
    // Environment Variables operations
    async createEnvironmentVariable(data: NewEnvironmentVariable): Promise<EnvironmentVariable> {
        this.logger.log(`Creating environment variable: ${data.key} for environment: ${data.environmentId}`);
        const db = this.databaseService.db;
        const [variable] = await db.insert(environmentVariables).values(data).returning();
        return variable;
    }
    async findEnvironmentVariables(environmentId: string): Promise<EnvironmentVariable[]> {
        const db = this.databaseService.db;
        return await db
            .select()
            .from(environmentVariables)
            .where(eq(environmentVariables.environmentId, environmentId))
            .orderBy(asc(environmentVariables.key));
    }
    async updateEnvironmentVariable(id: string, updates: Partial<NewEnvironmentVariable>): Promise<EnvironmentVariable | null> {
        const db = this.databaseService.db;
        const [updated] = await db
            .update(environmentVariables)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(environmentVariables.id, id))
            .returning();
        return updated || null;
    }
    async deleteEnvironmentVariable(id: string): Promise<boolean> {
        const db = this.databaseService.db;
        const result = await db
            .delete(environmentVariables)
            .where(eq(environmentVariables.id, id));
        return result.rowCount > 0;
    }
    async bulkUpdateVariables(environmentId: string, variables: Array<{
        key: string;
        value: string;
        isSecret?: boolean;
        description?: string;
        isDynamic?: boolean;
        template?: string;
    }>, createdBy: string): Promise<EnvironmentVariable[]> {
        this.logger.log(`Bulk updating variables for environment: ${environmentId}`);
        const db = this.databaseService.db;
        // Delete existing variables
        await db
            .delete(environmentVariables)
            .where(eq(environmentVariables.environmentId, environmentId));
        // Insert new variables
        if (variables.length === 0) {
            return [];
        }
        const newVariables = variables.map(variable => ({
            ...variable,
            environmentId,
            createdBy,
            resolutionStatus: variable.isDynamic ? 'pending' as const : 'resolved' as const,
        }));
        return await db.insert(environmentVariables).values(newVariables).returning();
    }
    // Environment Services operations
    async linkServiceToEnvironment(data: NewEnvironmentService): Promise<EnvironmentService> {
        this.logger.log(`Linking service ${data.serviceId} to environment ${data.environmentId}`);
        const db = this.databaseService.db;
        const [link] = await db.insert(environmentServices).values(data).returning();
        return link;
    }
    async findEnvironmentServices(environmentId: string): Promise<EnvironmentService[]> {
        const db = this.databaseService.db;
        return await db
            .select()
            .from(environmentServices)
            .where(eq(environmentServices.environmentId, environmentId));
    }
    async updateEnvironmentService(environmentId: string, serviceId: string, updates: Partial<NewEnvironmentService>): Promise<EnvironmentService | null> {
        const db = this.databaseService.db;
        const [updated] = await db
            .update(environmentServices)
            .set({ ...updates, updatedAt: new Date() })
            .where(and(eq(environmentServices.environmentId, environmentId), eq(environmentServices.serviceId, serviceId)))
            .returning();
        return updated || null;
    }
    // Environment Templates operations
    async createEnvironmentTemplate(data: NewEnvironmentTemplate): Promise<EnvironmentTemplate> {
        this.logger.log(`Creating environment template: ${data.name}`);
        const db = this.databaseService.db;
        const [template] = await db.insert(environmentTemplates).values(data).returning();
        return template;
    }
    async findEnvironmentTemplates(type?: string): Promise<EnvironmentTemplate[]> {
        const db = this.databaseService.db;
        if (type) {
            return await db
                .select()
                .from(environmentTemplates)
                .where(eq(environmentTemplates.type, type as any))
                .orderBy(desc(environmentTemplates.createdAt));
        }
        return await db
            .select()
            .from(environmentTemplates)
            .orderBy(desc(environmentTemplates.createdAt));
    }
    // Variable Templates operations
    async createVariableTemplate(data: NewVariableTemplate): Promise<VariableTemplate> {
        this.logger.log(`Creating variable template: ${data.name}`);
        const db = this.databaseService.db;
        const [template] = await db.insert(variableTemplates).values(data).returning();
        return template;
    }
    async findVariableTemplates(): Promise<VariableTemplate[]> {
        const db = this.databaseService.db;
        return await db
            .select()
            .from(variableTemplates)
            .orderBy(desc(variableTemplates.lastUsed), desc(variableTemplates.createdAt));
    }
    async updateVariableTemplate(id: string, updates: Partial<NewVariableTemplate>): Promise<VariableTemplate | null> {
        const db = this.databaseService.db;
        const [updated] = await db
            .update(variableTemplates)
            .set({ ...updates, updatedAt: new Date() })
            .where(eq(variableTemplates.id, id))
            .returning();
        return updated || null;
    }
    // Environment status and health operations
    async updateEnvironmentStatus(id: string, status: string, metadata?: any): Promise<Environment | null> {
        const db = this.databaseService.db;
        const updates: any = { status, updatedAt: new Date() };
        if (metadata) {
            updates.metadata = metadata;
        }
        const [updated] = await db
            .update(environments)
            .set(updates)
            .where(eq(environments.id, id))
            .returning();
        return updated || null;
    }
    // Access logging
    async logEnvironmentAccess(data: {
        environmentId: string;
        userId?: string;
        action: string;
        ipAddress?: string;
        userAgent?: string;
        metadata?: any;
    }): Promise<void> {
        const db = this.databaseService.db;
        await db.insert(environmentAccessLogs).values(data);
    }
    // Preview environment specific operations
    async findPreviewEnvironments(projectId?: string): Promise<Environment[]> {
        const db = this.databaseService.db;
        const whereConditions = [
            eq(environments.type, 'preview'),
            eq(environments.isActive, true)
        ];
        if (projectId) {
            whereConditions.push(eq(environments.projectId, projectId));
        }
        return await db
            .select()
            .from(environments)
            .where(and(...whereConditions))
            .orderBy(desc(environments.createdAt));
    }
    async cleanupExpiredPreviewEnvironments(): Promise<string[]> {
        this.logger.log('Cleaning up expired preview environments');
        const db = this.databaseService.db;
        const now = new Date();
        // Find expired preview environments
        const expiredEnvironments = await db
            .select({ id: environments.id, name: environments.name })
            .from(environments)
            .where(and(eq(environments.type, 'preview'), eq(environments.isActive, true)));
        const expiredIds: string[] = [];
        for (const env of expiredEnvironments) {
            // Check if environment has expired based on previewSettings
            const environment = await this.findEnvironmentById(env.id);
            if (environment?.previewSettings?.expiresAt) {
                const expiresAt = new Date(environment.previewSettings.expiresAt);
                if (expiresAt < now) {
                    await this.deleteEnvironment(env.id);
                    expiredIds.push(env.id);
                }
            }
        }
        if (expiredIds.length > 0) {
            this.logger.log(`Cleaned up ${expiredIds.length} expired preview environments`);
        }
        return expiredIds;
    }
    // Bulk operations
    async bulkDeleteEnvironments(ids: string[]): Promise<number> {
        if (ids.length === 0)
            return 0;
        this.logger.log(`Bulk deleting ${ids.length} environments`);
        const db = this.databaseService.db;
        const result = await db
            .update(environments)
            .set({ isActive: false, updatedAt: new Date() })
            .where(inArray(environments.id, ids));
        return result.rowCount;
    }
    async validateEnvironmentSlug(slug: string, projectId?: string, excludeId?: string): Promise<boolean> {
        const db = this.databaseService.db;
        const whereConditions = [eq(environments.slug, slug)];
        if (projectId) {
            whereConditions.push(eq(environments.projectId, projectId));
        }
        if (excludeId) {
            whereConditions.push(eq(environments.id, excludeId));
        }
        const [existing] = await db
            .select({ id: environments.id })
            .from(environments)
            .where(and(...whereConditions));
        return !existing; // Return true if slug is available
    }
}
