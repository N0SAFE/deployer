import { Controller } from "@nestjs/common";
import { Implement, implement } from "@orpc/nest";
import { projectContract } from "@repo/api-contracts";
import { ProjectService } from "../services/project.service";
import { ProjectNetworkService } from "../services/project-network.service";
import { requireAuth } from "@/core/modules/auth/orpc/middlewares";

@Controller()
export class ProjectController {
    constructor(
        private readonly projectService: ProjectService,
        private readonly projectNetworkService: ProjectNetworkService,
    ) {}

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
            // The create contract is COMPACT input (body-only schema) — `input`
            // IS the create payload, not `input.body`.
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
            const collaborators = await this.projectService.getCollaborators(input.params.id, userId);
            return { collaborators };
        });
    }

    @Implement(projectContract.inviteCollaborator)
    inviteCollaborator() {
        return implement(projectContract.inviteCollaborator).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.inviteCollaborator(input.params.id, userId, input.body);
        });
    }

    @Implement(projectContract.updateCollaborator)
    updateCollaborator() {
        return implement(projectContract.updateCollaborator).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            // body is optional (all fields optional) — coalesce to {}.
            return this.projectService.updateCollaborator(input.params.id, userId, input.params.userId, input.body ?? {});
        });
    }

    @Implement(projectContract.removeCollaborator)
    removeCollaborator() {
        return implement(projectContract.removeCollaborator).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.removeCollaborator(input.params.id, userId, input.params.userId);
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
            const envs = await this.projectService.listEnvironments(input.params.id, userId, input.query?.kind);
            return { environments: envs };
        });
    }

    @Implement(projectContract.getEnvironment)
    getEnvironment() {
        return implement(projectContract.getEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getEnvironment(input.params.id, userId, input.params.environmentId);
        });
    }

    @Implement(projectContract.createEnvironment)
    createEnvironment() {
        return implement(projectContract.createEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.createEnvironment(input.params.id, userId, input.body);
        });
    }

    @Implement(projectContract.updateEnvironment)
    updateEnvironment() {
        return implement(projectContract.updateEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateEnvironment(input.params.id, userId, input.params.environmentId, input.body ?? {});
        });
    }

    @Implement(projectContract.deleteEnvironment)
    deleteEnvironment() {
        return implement(projectContract.deleteEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.deleteEnvironment(input.params.id, userId, input.params.environmentId);
            return { success: true, message: "Environment deleted successfully" };
        });
    }

    @Implement(projectContract.cloneEnvironment)
    cloneEnvironment() {
        return implement(projectContract.cloneEnvironment).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.cloneEnvironment(input.params.id, userId, input.params.environmentId, input.body);
        });
    }

    // ========================================
    // SERVICE × ENVIRONMENT LINKS
    // ========================================

    @Implement(projectContract.listServiceEnvironmentLinks)
    listServiceEnvironmentLinks() {
        return implement(projectContract.listServiceEnvironmentLinks).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const links = await this.projectService.listServiceEnvironmentLinks(input.params.id, userId);
            return { links };
        });
    }

    @Implement(projectContract.upsertServiceEnvironmentLink)
    upsertServiceEnvironmentLink() {
        return implement(projectContract.upsertServiceEnvironmentLink).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.upsertServiceEnvironmentLink(input.params.id, userId, input.body);
        });
    }

    // ========================================
    // NETWORK CONFIGURATION (DNS provider + zone + records)
    // ========================================

    @Implement(projectContract.getNetwork)
    getNetwork() {
        return implement(projectContract.getNetwork).use(requireAuth()).handler(async ({ input }) => {
            return this.projectNetworkService.getNetwork(input.params.id);
        });
    }

    @Implement(projectContract.updateNetwork)
    updateNetwork() {
        return implement(projectContract.updateNetwork).use(requireAuth()).handler(async ({ input }) => {
            return this.projectNetworkService.updateNetwork(input.params.id, input.body ?? {});
        });
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    @Implement(projectContract.listVariableTemplates)
    listVariableTemplates() {
        return implement(projectContract.listVariableTemplates).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const templates = await this.projectService.listVariableTemplates(input.params.id, userId);
            return { templates };
        });
    }

    @Implement(projectContract.getVariableTemplate)
    getVariableTemplate() {
        return implement(projectContract.getVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getVariableTemplate(input.params.id, userId, input.params.templateId);
        });
    }

    @Implement(projectContract.createVariableTemplate)
    createVariableTemplate() {
        return implement(projectContract.createVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.createVariableTemplate(input.params.id, userId, input.body);
        });
    }

    @Implement(projectContract.updateVariableTemplate)
    updateVariableTemplate() {
        return implement(projectContract.updateVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateVariableTemplate(input.params.id, userId, input.params.templateId, input.body ?? {});
        });
    }

    @Implement(projectContract.deleteVariableTemplate)
    deleteVariableTemplate() {
        return implement(projectContract.deleteVariableTemplate).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            await this.projectService.deleteVariableTemplate(input.params.id, userId, input.params.templateId);
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
            return this.projectService.getGeneralConfig(input.params.id, userId);
        });
    }

    @Implement(projectContract.updateGeneralConfig)
    updateGeneralConfig() {
        return implement(projectContract.updateGeneralConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateGeneralConfig(input.params.id, userId, input.body ?? {});
        });
    }

    @Implement(projectContract.getEnvironmentConfig)
    getEnvironmentConfig() {
        return implement(projectContract.getEnvironmentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getEnvironmentConfig(input.params.id, userId);
        });
    }

    @Implement(projectContract.updateEnvironmentConfig)
    updateEnvironmentConfig() {
        return implement(projectContract.updateEnvironmentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateEnvironmentConfig(input.params.id, userId, input.body ?? {});
        });
    }

    @Implement(projectContract.getDeploymentConfig)
    getDeploymentConfig() {
        return implement(projectContract.getDeploymentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getDeploymentConfig(input.params.id, userId);
        });
    }

    @Implement(projectContract.updateDeploymentConfig)
    updateDeploymentConfig() {
        return implement(projectContract.updateDeploymentConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateDeploymentConfig(input.params.id, userId, input.body ?? {});
        });
    }

    @Implement(projectContract.getSecurityConfig)
    getSecurityConfig() {
        return implement(projectContract.getSecurityConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getSecurityConfig(input.params.id, userId);
        });
    }

    @Implement(projectContract.updateSecurityConfig)
    updateSecurityConfig() {
        return implement(projectContract.updateSecurityConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateSecurityConfig(input.params.id, userId, input.body ?? {});
        });
    }

    @Implement(projectContract.getResourceConfig)
    getResourceConfig() {
        return implement(projectContract.getResourceConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getResourceConfig(input.params.id, userId);
        });
    }

    @Implement(projectContract.updateResourceConfig)
    updateResourceConfig() {
        return implement(projectContract.updateResourceConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateResourceConfig(input.params.id, userId, input.body ?? {});
        });
    }

    @Implement(projectContract.getNotificationConfig)
    getNotificationConfig() {
        return implement(projectContract.getNotificationConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getNotificationConfig(input.params.id, userId);
        });
    }

    @Implement(projectContract.updateNotificationConfig)
    updateNotificationConfig() {
        return implement(projectContract.updateNotificationConfig).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.updateNotificationConfig(input.params.id, userId, input.body ?? {});
        });
    }

    // ========================================
    // UTILITIES
    // ========================================

    @Implement(projectContract.resolveVariables)
    resolveVariables() {
        return implement(projectContract.resolveVariables).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.resolveVariables(input.params.id, userId, input.body);
        });
    }

    @Implement(projectContract.getAvailableVariables)
    getAvailableVariables() {
        return implement(projectContract.getAvailableVariables).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            return this.projectService.getAvailableVariables(input.params.id, userId, input.query);
        });
    }

    @Implement(projectContract.getEnvironmentStatus)
    getEnvironmentStatus() {
        return implement(projectContract.getEnvironmentStatus).use(requireAuth()).handler(async ({ input, context }) => {
            const userId = context.auth.user.id;
            const env = await this.projectService.getEnvironment(input.params.id, userId, input.params.environmentId);
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
            const envs = await this.projectService.listEnvironments(input.params.id, userId);
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
            const env = await this.projectService.getEnvironment(input.params.id, userId, input.params.environmentId);
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
                return projectService.streamQueryEvents(input.query);
            });
    }
}
