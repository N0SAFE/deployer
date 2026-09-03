import { ForbiddenException, Injectable, NotFoundException } from "@nestjs/common";
import type { ProjectRole } from "@repo/auth";
import { ProjectAccessRepository } from "../repositories/project-access.repository";

interface ProjectAccessProject {
    id: string;
    ownerId: string;
}

@Injectable()
export class ProjectAccessService {
    constructor(private readonly projectAccessRepository: ProjectAccessRepository) {}

    findProjectById(projectId: string): Promise<ProjectAccessProject | null> {
        return this.projectAccessRepository.findProjectById(projectId);
    }

    findCollaboratorByUserAndProject(userId: string, projectId: string): Promise<{ role: ProjectRole } | null> {
        return this.projectAccessRepository.findCollaboratorByUserAndProject(userId, projectId);
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