import { Injectable } from "@nestjs/common";
import { and, eq } from "drizzle-orm";
import { projectCollaborators, projects } from "@/config/drizzle/global/schema/deployment";
import { GlobalDatabaseService } from "@/core/modules/database/services/global-database.service";
import type { ProjectRole } from "@repo/auth";

interface ProjectAccessProject {
    id: string;
    ownerId: string;
}

/**
 * ProjectAccessRepository — the single data-access layer for the project
 * ownership/collaborator lookups used by ProjectAccessService. Extracted
 * from the service, which was reaching into the DB directly (violating the
 * service → repository layering).
 */
@Injectable()
export class ProjectAccessRepository {
    constructor(private readonly databaseService: GlobalDatabaseService) {}

    private get db() {
        return this.databaseService.db;
    }

    async findProjectById(projectId: string): Promise<ProjectAccessProject | null> {
        const [project] = await this.db
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
        const [collaborator] = await this.db
            .select({ role: projectCollaborators.role })
            .from(projectCollaborators)
            .where(
                and(
                    eq(projectCollaborators.userId, userId),
                    eq(projectCollaborators.projectId, projectId),
                ),
            )
            .limit(1);

        if (!collaborator) return null;
        return { role: collaborator.role as ProjectRole };
    }
}