import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { projectContract } from "@repo/api-contracts";
import { ProjectService } from "../services/project.service";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";
import { observableToAsyncIterable } from "@/core/utils/observable.utils";

@Controller()
export class ProjectController {
    constructor(private readonly projectService: ProjectService) {}

    // ========================================
    // CORE CRUD
    // ========================================

    @Implement(projectContract.list)
    list() {
        return implement(projectContract.list).use(requireAuth()).handler(async ({ input }) => {
            return this.projectService.listProjects(input.query);
        });
    }

    @Implement(projectContract.findById)
    findById() {
        return implement(projectContract.findById).use(requireAuth()).handler(async ({ input }) => {
            return this.projectService.getProjectById(input.params.id);
        });
    }

    @Implement(projectContract.create)
    create() {
        return implement(projectContract.create).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const project = await this.projectService.createProject({ ...input, ownerId: userId });
            return { status: 201 as const, headers: {}, body: project };
        });
    }

    @Implement(projectContract.update)
    update() {
        return implement(projectContract.update).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...data } = input;
            return this.projectService.updateProject(id, userId, data);
        });
    }

    @Implement(projectContract.delete)
    delete() {
        return implement(projectContract.delete).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.deleteProject(input.params.id, userId);
            return { success: true };
        });
    }

    // ========================================
    // COLLABORATORS
    // ========================================

    @Implement(projectContract.getCollaborators)
    getCollaborators() {
        return implement(projectContract.getCollaborators).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const collaborators = await this.projectService.getCollaborators(input.id, userId);
            return { collaborators };
        });
    }

    @Implement(projectContract.inviteCollaborator)
    inviteCollaborator() {
        return implement(projectContract.inviteCollaborator).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...inviteData } = input;
            return this.projectService.inviteCollaborator(id, userId, inviteData);
        });
    }

    @Implement(projectContract.updateCollaborator)
    updateCollaborator() {
        return implement(projectContract.updateCollaborator).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, userId: targetUserId, ...data } = input;
            return this.projectService.updateCollaborator(id, userId, targetUserId, data);
        });
    }

    @Implement(projectContract.removeCollaborator)
    removeCollaborator() {
        return implement(projectContract.removeCollaborator).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.removeCollaborator(input.id, userId, input.userId);
            return { success: true, message: "Collaborator removed successfully" };
        });
    }

    // ========================================
    // ENVIRONMENTS
    // ========================================

    @Implement(projectContract.listEnvironments)
    listEnvironments() {
        return implement(projectContract.listEnvironments).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const envs = await this.projectService.listEnvironments(input.id, userId, input.type);
            return { environments: envs };
        });
    }

    @Implement(projectContract.getEnvironment)
    getEnvironment() {
        return implement(projectContract.getEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getEnvironment(input.id, userId, input.environmentId);
        });
    }

    @Implement(projectContract.createEnvironment)
    createEnvironment() {
        return implement(projectContract.createEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...data } = input;
            return this.projectService.createEnvironment(id, userId, data);
        });
    }

    @Implement(projectContract.updateEnvironment)
    updateEnvironment() {
        return implement(projectContract.updateEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, environmentId, ...data } = input;
            return this.projectService.updateEnvironment(id, userId, environmentId, data);
        });
    }

    @Implement(projectContract.deleteEnvironment)
    deleteEnvironment() {
        return implement(projectContract.deleteEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.deleteEnvironment(input.id, userId, input.environmentId);
            return { success: true, message: "Environment deleted successfully" };
        });
    }

    @Implement(projectContract.cloneEnvironment)
    cloneEnvironment() {
        return implement(projectContract.cloneEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, environmentId, ...data } = input;
            return this.projectService.cloneEnvironment(id, userId, environmentId, data);
        });
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    @Implement(projectContract.listVariableTemplates)
    listVariableTemplates() {
        return implement(projectContract.listVariableTemplates).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const templates = await this.projectService.listVariableTemplates(input.id, userId);
            return { templates };
        });
    }

    @Implement(projectContract.getVariableTemplate)
    getVariableTemplate() {
        return implement(projectContract.getVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getVariableTemplate(input.id, userId, input.templateId);
        });
    }

    @Implement(projectContract.createVariableTemplate)
    createVariableTemplate() {
        return implement(projectContract.createVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...data } = input;
            return this.projectService.createVariableTemplate(id, userId, data);
        });
    }

    @Implement(projectContract.updateVariableTemplate)
    updateVariableTemplate() {
        return implement(projectContract.updateVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, templateId, ...data } = input;
            return this.projectService.updateVariableTemplate(id, userId, templateId, data);
        });
    }

    @Implement(projectContract.deleteVariableTemplate)
    deleteVariableTemplate() {
        return implement(projectContract.deleteVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.deleteVariableTemplate(input.id, userId, input.templateId);
            return { success: true, message: "Template deleted successfully" };
        });
    }

    // ========================================
    // CONFIGURATION
    // ========================================

    @Implement(projectContract.getGeneralConfig)
    getGeneralConfig() {
        return implement(projectContract.getGeneralConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getGeneralConfig(input.id, userId);
        });
    }

    @Implement(projectContract.updateGeneralConfig)
    updateGeneralConfig() {
        return implement(projectContract.updateGeneralConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...patch } = input;
            return this.projectService.updateGeneralConfig(id, userId, patch);
        });
    }

    @Implement(projectContract.getEnvironmentConfig)
    getEnvironmentConfig() {
        return implement(projectContract.getEnvironmentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getEnvironmentConfig(input.id, userId);
        });
    }

    @Implement(projectContract.updateEnvironmentConfig)
    updateEnvironmentConfig() {
        return implement(projectContract.updateEnvironmentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...patch } = input;
            return this.projectService.updateEnvironmentConfig(id, userId, patch);
        });
    }

    @Implement(projectContract.getDeploymentConfig)
    getDeploymentConfig() {
        return implement(projectContract.getDeploymentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getDeploymentConfig(input.id, userId);
        });
    }

    @Implement(projectContract.updateDeploymentConfig)
    updateDeploymentConfig() {
        return implement(projectContract.updateDeploymentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...patch } = input;
            return this.projectService.updateDeploymentConfig(id, userId, patch);
        });
    }

    @Implement(projectContract.getSecurityConfig)
    getSecurityConfig() {
        return implement(projectContract.getSecurityConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getSecurityConfig(input.id, userId);
        });
    }

    @Implement(projectContract.updateSecurityConfig)
    updateSecurityConfig() {
        return implement(projectContract.updateSecurityConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...patch } = input;
            return this.projectService.updateSecurityConfig(id, userId, patch);
        });
    }

    @Implement(projectContract.getResourceConfig)
    getResourceConfig() {
        return implement(projectContract.getResourceConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getResourceConfig(input.id, userId);
        });
    }

    @Implement(projectContract.updateResourceConfig)
    updateResourceConfig() {
        return implement(projectContract.updateResourceConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...patch } = input;
            return this.projectService.updateResourceConfig(id, userId, patch);
        });
    }

    @Implement(projectContract.getNotificationConfig)
    getNotificationConfig() {
        return implement(projectContract.getNotificationConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getNotificationConfig(input.id, userId);
        });
    }

    @Implement(projectContract.updateNotificationConfig)
    updateNotificationConfig() {
        return implement(projectContract.updateNotificationConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...patch } = input;
            return this.projectService.updateNotificationConfig(id, userId, patch);
        });
    }

    // ========================================
    // UTILITIES
    // ========================================

    @Implement(projectContract.resolveVariables)
    resolveVariables() {
        return implement(projectContract.resolveVariables).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...data } = input;
            return this.projectService.resolveVariables(id, userId, data);
        });
    }

    @Implement(projectContract.getAvailableVariables)
    getAvailableVariables() {
        return implement(projectContract.getAvailableVariables).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const { id, ...query } = input;
            return this.projectService.getAvailableVariables(id, userId, query);
        });
    }

    @Implement(projectContract.getEnvironmentStatus)
    getEnvironmentStatus() {
        return implement(projectContract.getEnvironmentStatus).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const env = await this.projectService.getEnvironment(input.id, userId, input.environmentId);
            return {
                environmentId: env.id,
                status: env.status,
                servicesCount: 0, // TODO: join with services
                healthyServicesCount: 0,
                lastChecked: new Date().toISOString(),
            };
        });
    }

    @Implement(projectContract.getAllEnvironmentStatuses)
    getAllEnvironmentStatuses() {
        return implement(projectContract.getAllEnvironmentStatuses).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const envs = await this.projectService.listEnvironments(input.id, userId);
            return {
                statuses: envs.map((env) => ({
                    environmentId: env.id,
                    environmentName: env.name,
                    status: env.status,
                    servicesCount: 0, // TODO: join with services
                    healthyServicesCount: 0,
                    lastChecked: new Date().toISOString(),
                })),
            };
        });
    }

    @Implement(projectContract.refreshEnvironmentStatus)
    refreshEnvironmentStatus() {
        return implement(projectContract.refreshEnvironmentStatus).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const env = await this.projectService.getEnvironment(input.id, userId, input.environmentId);
            // TODO: trigger actual health check
            return {
                success: true,
                status: env.status,
                lastChecked: new Date().toISOString(),
            };
        });
    }

    @Implement(projectContract.streamQuery)
    streamQuery() {
        const projectService = this.projectService;

        return implement(projectContract.streamQuery)
            .use(requireAuth())
            .handler(({ input }) => {
                return observableToAsyncIterable(projectService.streamQueryEvents(input.query));
            });
    }
}
