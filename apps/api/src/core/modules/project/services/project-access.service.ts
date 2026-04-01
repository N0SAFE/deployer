import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { projectCollaborators, projects } from "@/config/drizzle/global/schema/deployment";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import type { ProjectRole } from "@repo/auth";

interface ProjectAccessProject {
    id: string;
    ownerId: string;
}

@Injectable()
export class ProjectAccessService {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    async findProjectById(projectId: string): Promise<ProjectAccessProject | null> {
        const db = this.databaseService.db;
        const [project] = await db
            .select({
                id: projects.id,
                ownerId: projects.ownerId,
            })
            .from(projects)
            .where(eq(projects.id, projectId))
            .limit(1);

        return project ?? null;
    }

    async findCollaboratorByUserAndProject(userId: string, projectId: string): Promise<{ role: ProjectRole } | null> {
        const db = this.databaseService.db;
        const [collaborator] = await db
            .select({ role: projectCollaborators.role })
            .from(projectCollaborators)
            .where(
                and(
                    eq(projectCollaborators.userId, userId),
                    eq(projectCollaborators.projectId, projectId),
                ),
            )
            .limit(1);

        return collaborator as { role: ProjectRole } | null;
    }

    async assertProjectAccess(
        projectId: string,
        requesterId: string,
        allowedRoles: readonly ProjectRole[],
        forbiddenMessage = "You do not have permission to perform this action",
    ): Promise<ProjectAccessProject> {
        const project = await this.findProjectById(projectId);
        if (!project) {
            throw new NotFoundException(`Project ${projectId} not found`);
        }

        if (project.ownerId === requesterId) {
            return project;
        }

        const collaborator = await this.findCollaboratorByUserAndProject(requesterId, projectId);
        if (!collaborator || !allowedRoles.includes(collaborator.role)) {
            throw new ForbiddenException(forbiddenMessage);
        }

        return project;
    }
}