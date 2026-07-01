import {
} from "@nestjs/common";
import { isRecord } from "@repo/type-guards";
import {
    BadRequestException,
    ConflictException,
    ForbiddenException,
    Optional,
    Injectable,
    NotFoundException,
} from "@nestjs/common";
import { EMPTY, type Observable, concat, defer, from, map, mergeMap } from "rxjs";
import { filter as rxFilter } from "rxjs/operators";
import { CoreEventSyncService } from "@/core/modules/events";
import { runtimeConfigurationAccessor } from "@/core/modules/configuration/services/runtime-configuration-accessor";
import { ProjectRepository } from "../repositories/project.repository";
import { ProjectEventService } from "./project-event.service";
import type { ProjectListInput } from "@repo/api-contracts/modules/project/list";
import type {
    ProjectStreamEvent,
    ProjectStreamQueryInput,
} from "@repo/api-contracts/modules/project/stream";

// ---------------------------------------------------------------------------
// Typed settings stored in project.settings JSONB
// ---------------------------------------------------------------------------



interface ProjectSettings {
    // General config (supplementary fields; name/description/baseDomain are top-level columns)
    defaultBranch?: string;
    autoDeployEnabled?: boolean;
    enablePreviewEnvironments?: boolean;
    // Environment config
    defaultEnvironmentVariables?: Record<string, string>;
    productionEnvironmentVariables?: Record<string, string>;
    stagingEnvironmentVariables?: Record<string, string>;
    developmentEnvironmentVariables?: Record<string, string>;
    // Deployment config
    autoCleanupDays?: number;
    maxPreviewEnvironments?: number;
    deploymentStrategy?: "rolling" | "blue_green" | "canary";
    healthCheckTimeout?: number;
    deploymentTimeout?: number;
    enableRollback?: boolean;
    requireApprovalForProduction?: boolean;
    // Security config
    webhookSecret?: string;
    enableHttpsRedirect?: boolean;
    allowedDomains?: string[];
    ipWhitelist?: string[];
    enableBasicAuth?: boolean;
    basicAuthUsername?: string;
    basicAuthPassword?: string;
    // Resource config
    defaultCpuLimit?: string;
    defaultMemoryLimit?: string;
    defaultStorageLimit?: string;
    maxServicesPerProject?: number;
    // Notification config
    enableEmailNotifications?: boolean;
    enableSlackNotifications?: boolean;
    slackWebhookUrl?: string;
    emailRecipients?: string[];
    notifyOnDeploymentSuccess?: boolean;
    notifyOnDeploymentFailure?: boolean;
    notifyOnServiceDown?: boolean;
}

@Injectable()
export class ProjectService {
    constructor(
        private readonly projectRepository: ProjectRepository,
        private readonly projectEventService: ProjectEventService,
        @Optional() private readonly coreEventSyncService?: CoreEventSyncService,
    ) {
        this.coreEventSyncService?.registerNamespaceAdapter(
            "project",
            ({ definition, replay, replayLimit }) =>
                this.toCoreAdapterStream(definition, replay, replayLimit),
        );
    }

    // ========================================
    // PROJECT CRUD
    // ========================================

    async listProjects(query: ProjectListInput) {
        return this.projectRepository.findMany(query);
    }

    async getProjectById(id: string) {
        const project = await this.projectRepository.findById(id);
        if (!project) throw new NotFoundException(`Project ${id} not found`);

        const stats = await this.projectRepository.getProjectStats(id);
        return { ...project, ...stats };
    }

    async createProject(data: {
        name: string;
        description?: string | null;
        baseDomain?: string | null;
        settings?: Record<string, unknown> | null;
        ownerId: string;
    }) {
        const created = await this.projectRepository.create({
            name: data.name,
            description: data.description ?? null,
            baseDomain: data.baseDomain ?? null,
            ownerId: data.ownerId,
            settings: data.settings,
        });

        this.projectEventService.emit(
            "projectCreated",
            { ownerId: data.ownerId },
            {
                projectId: created.id,
                ownerId: created.ownerId,
                name: created.name,
                timestamp: new Date().toISOString(),
            },
        );

        return created;
    }

    async updateProject(id: string, requesterId: string, data: {
        name?: string;
        description?: string | null;
        baseDomain?: string | null;
        settings?: Record<string, unknown> | null;
    }) {
        await this.assertProjectAccess(id, requesterId, ["owner", "admin"]);
        const updated = await this.projectRepository.update(id, {
            name: data.name,
            description: data.description,
            baseDomain: data.baseDomain,
            settings: data.settings,
        });
        if (!updated) throw new NotFoundException(`Project ${id} not found`);

        const changedFields = Object.keys(data).filter(
            (key) => Reflect.get(isRecord(data) ? data : {}, "key") !== undefined,
        );
        this.projectEventService.emit(
            "projectUpdated",
            { projectId: id },
            {
                projectId: id,
                ownerId: updated.ownerId,
                changedFields,
                timestamp: new Date().toISOString(),
            },
        );

        return updated;
    }

    async deleteProject(id: string, requesterId: string) {
        const project = await this.projectRepository.findById(id);
        if (!project) throw new NotFoundException(`Project ${id} not found`);
        if (project.ownerId !== requesterId) {
            throw new ForbiddenException("Only the project owner can delete the project");
        }
        await this.projectRepository.delete(id);

        this.projectEventService.emit(
            "projectDeleted",
            { projectId: id },
            {
                projectId: id,
                ownerId: project.ownerId,
                timestamp: new Date().toISOString(),
            },
        );
    }

    // ========================================
    // COLLABORATORS
    // ========================================

    async getCollaborators(projectId: string, requesterId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        return this.projectRepository.findCollaboratorsByProject(projectId);
    }

    async inviteCollaborator(
        projectId: string,
        requesterId: string,
        data: { email: string; role: string; permissions?: Record<string, boolean> | null },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);

        const targetUser = await this.projectRepository.findUserByEmail(data.email);
        if (!targetUser) {
            throw new NotFoundException(`No user found with email "${data.email}"`);
        }

        const existing = await this.projectRepository.findCollaboratorByUserAndProject(
            targetUser.id,
            projectId,
        );
        if (existing) {
            throw new ConflictException("User is already a collaborator on this project");
        }

        const collaborator = await this.projectRepository.createCollaborator({
            projectId,
            userId: targetUser.id,
            role: data.role as "owner" | "admin" | "developer" | "viewer",
            permissions: data.permissions,
            invitedBy: requesterId,
        });

        this.projectEventService.emit(
            "projectCollaboratorInvited",
            { projectId },
            {
                projectId,
                userId: targetUser.id,
                role: data.role as "owner" | "admin" | "developer" | "viewer",
                timestamp: new Date().toISOString(),
            },
        );

        return {
            inviteId: collaborator.id,
            message: `${targetUser.email} has been invited as ${data.role}`,
        };
    }

    async updateCollaborator(
        projectId: string,
        requesterId: string,
        targetUserId: string,
        data: { role?: string; permissions?: Record<string, boolean> | null },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);

        const collaborator = await this.projectRepository.findCollaboratorByUserAndProject(
            targetUserId,
            projectId,
        );
        if (!collaborator) throw new NotFoundException("Collaborator not found");

        if (collaborator.role === "owner") {
            throw new ForbiddenException("Cannot modify the project owner's collaborator record");
        }

        const updated = await this.projectRepository.updateCollaborator(collaborator.id, {
            role: data.role as "owner" | "admin" | "developer" | "viewer" | undefined,
            permissions: data.permissions,
        });
        if (!updated) throw new NotFoundException("Collaborator not found");
        return updated;
    }

    async removeCollaborator(projectId: string, requesterId: string, targetUserId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);

        const collaborator = await this.projectRepository.findCollaboratorByUserAndProject(
            targetUserId,
            projectId,
        );
        if (!collaborator) throw new NotFoundException("Collaborator not found");
        if (collaborator.role === "owner") {
            throw new ForbiddenException("Cannot remove the project owner");
        }

        await this.projectRepository.deleteCollaboratorByUserAndProject(targetUserId, projectId);

        this.projectEventService.emit(
            "projectCollaboratorRemoved",
            { projectId },
            {
                projectId,
                userId: targetUserId,
                timestamp: new Date().toISOString(),
            },
        );
    }

    // ========================================
    // ENVIRONMENTS
    // ========================================

    async listEnvironments(projectId: string, requesterId: string, type?: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        return this.projectRepository.findEnvironmentsByProject(projectId, type);
    }

    async getEnvironment(projectId: string, requesterId: string, environmentId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const env = await this.projectRepository.findEnvironmentById(environmentId);
        if (env?.projectId !== projectId) {
            throw new NotFoundException(`Environment ${environmentId} not found`);
        }
        return env;
    }

    async createEnvironment(
        projectId: string,
        requesterId: string,
        data: {
            name: string;
            type: "production" | "staging" | "preview" | "development";
            description?: string | null;
            domainConfig?: unknown;
            deploymentConfig?: unknown;
            metadata?: unknown;
        },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const created = await this.projectRepository.createEnvironment({
            projectId,
            name: data.name,
            type: data.type,
            description: data.description ?? null,
            domainConfig: data.domainConfig as Parameters<typeof this.projectRepository.createEnvironment>[0]["domainConfig"],
            deploymentConfig: data.deploymentConfig as Parameters<typeof this.projectRepository.createEnvironment>[0]["deploymentConfig"],
            metadata: data.metadata as Parameters<typeof this.projectRepository.createEnvironment>[0]["metadata"],
            createdBy: requesterId,
        });

        this.projectEventService.emit(
            "projectEnvironmentCreated",
            { projectId },
            {
                projectId,
                environmentId: created.id,
                environmentName: created.name,
                timestamp: new Date().toISOString(),
            },
        );

        return created;
    }

    async updateEnvironment(
        projectId: string,
        requesterId: string,
        environmentId: string,
        data: Record<string, unknown>,
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const env = await this.projectRepository.findEnvironmentById(environmentId);
        if (env?.projectId !== projectId) {
            throw new NotFoundException(`Environment ${environmentId} not found`);
        }
        const updated = await this.projectRepository.updateEnvironment(environmentId, data);
        if (!updated) throw new NotFoundException(`Environment ${environmentId} not found`);
        return updated;
    }

    async deleteEnvironment(projectId: string, requesterId: string, environmentId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const env = await this.projectRepository.findEnvironmentById(environmentId);
        if (env?.projectId !== projectId) {
            throw new NotFoundException(`Environment ${environmentId} not found`);
        }
        await this.projectRepository.deleteEnvironment(environmentId);

        this.projectEventService.emit(
            "projectEnvironmentDeleted",
            { projectId },
            {
                projectId,
                environmentId,
                timestamp: new Date().toISOString(),
            },
        );
    }

    async cloneEnvironment(
        projectId: string,
        requesterId: string,
        sourceEnvironmentId: string,
        data: { name: string; type?: "production" | "staging" | "preview" | "development" },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);

        const source = await this.projectRepository.findEnvironmentById(sourceEnvironmentId);
        if (source?.projectId !== projectId) {
            throw new NotFoundException(`Environment ${sourceEnvironmentId} not found`);
        }

        return this.projectRepository.createEnvironment({
            projectId,
            name: data.name,
            type: data.type ?? source.type,
            description: source.description,
            domainConfig: source.domainConfig,
            deploymentConfig: source.deploymentConfig,
            metadata: null, // do not copy runtime metadata
            createdBy: requesterId,
        });
    }

    // ========================================
    // VARIABLE TEMPLATES
    // ========================================

    async listVariableTemplates(projectId: string, requesterId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        return this.projectRepository.findTemplatesByProject(projectId);
    }

    async getVariableTemplate(projectId: string, requesterId: string, templateId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const template = await this.projectRepository.findTemplateById(templateId);
        if (!template) throw new NotFoundException(`Template ${templateId} not found`);
        return template;
    }

    async createVariableTemplate(
        projectId: string,
        requesterId: string,
        data: { name: string; description?: string | null; variables?: unknown[] },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        return this.projectRepository.createTemplate({
            name: data.name,
            description: data.description ?? null,
            variables: data.variables as Parameters<typeof this.projectRepository.createTemplate>[0]["variables"],
            createdBy: requesterId,
        });
    }

    async updateVariableTemplate(
        projectId: string,
        requesterId: string,
        templateId: string,
        data: { name?: string; description?: string | null; variables?: unknown[] },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const template = await this.projectRepository.findTemplateById(templateId);
        if (!template) throw new NotFoundException(`Template ${templateId} not found`);

        const updated = await this.projectRepository.updateTemplate(templateId, {
            name: data.name,
            description: data.description,
            variables: data.variables as Parameters<typeof this.projectRepository.updateTemplate>[1]["variables"],
        });
        if (!updated) throw new NotFoundException(`Template ${templateId} not found`);
        return updated;
    }

    async deleteVariableTemplate(projectId: string, requesterId: string, templateId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const template = await this.projectRepository.findTemplateById(templateId);
        if (!template) throw new NotFoundException(`Template ${templateId} not found`);
        if (template.isSystem) throw new BadRequestException("Cannot delete a system template");
        await this.projectRepository.deleteTemplate(templateId);
    }

    // ========================================
    // CONFIGURATION (stored in project.settings)
    // ========================================

    async getGeneralConfig(projectId: string, requesterId: string) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const s = (project.settings ?? {}) as ProjectSettings;
        return {
            name: project.name,
            description: project.description ?? undefined,
            baseDomain: project.baseDomain ?? undefined,
            defaultBranch: s.defaultBranch ?? "main",
            autoDeployEnabled: s.autoDeployEnabled ?? true,
            enablePreviewEnvironments: s.enablePreviewEnvironments ?? true,
        };
    }

    async updateGeneralConfig(
        projectId: string,
        requesterId: string,
        patch: { name?: string; description?: string | null; baseDomain?: string | null; defaultBranch?: string; autoDeployEnabled?: boolean; enablePreviewEnvironments?: boolean },
    ) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const currentSettings = (project.settings ?? {}) as ProjectSettings;
        const settingsPatch: ProjectSettings = {};
        if (patch.defaultBranch !== undefined) settingsPatch.defaultBranch = patch.defaultBranch;
        if (patch.autoDeployEnabled !== undefined) settingsPatch.autoDeployEnabled = patch.autoDeployEnabled;
        if (patch.enablePreviewEnvironments !== undefined) settingsPatch.enablePreviewEnvironments = patch.enablePreviewEnvironments;

        const updateData: Parameters<typeof this.projectRepository.update>[1] = {
            settings: { ...currentSettings, ...settingsPatch },
        };
        if (patch.name !== undefined) updateData.name = patch.name;
        if (patch.description !== undefined) updateData.description = patch.description;
        if (patch.baseDomain !== undefined) updateData.baseDomain = patch.baseDomain;

        const updated = await this.projectRepository.update(projectId, updateData);
        if (!updated) throw new NotFoundException(`Project ${projectId} not found`);
        const s = (updated.settings ?? {}) as ProjectSettings;
        return {
            name: updated.name,
            description: updated.description ?? undefined,
            baseDomain: updated.baseDomain ?? undefined,
            defaultBranch: s.defaultBranch ?? "main",
            autoDeployEnabled: s.autoDeployEnabled ?? true,
            enablePreviewEnvironments: s.enablePreviewEnvironments ?? true,
        };
    }

    async getEnvironmentConfig(projectId: string, requesterId: string) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const s = (project.settings ?? {}) as ProjectSettings;
        return {
            defaultEnvironmentVariables: s.defaultEnvironmentVariables,
            productionEnvironmentVariables: s.productionEnvironmentVariables,
            stagingEnvironmentVariables: s.stagingEnvironmentVariables,
            developmentEnvironmentVariables: s.developmentEnvironmentVariables,
        };
    }

    async updateEnvironmentConfig(
        projectId: string,
        requesterId: string,
        patch: { defaultEnvironmentVariables?: Record<string, string>; productionEnvironmentVariables?: Record<string, string>; stagingEnvironmentVariables?: Record<string, string>; developmentEnvironmentVariables?: Record<string, string> },
    ) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const current = (project.settings ?? {}) as ProjectSettings;
        const merged = { ...current, ...patch };
        const updated = await this.projectRepository.update(projectId, {
            settings: merged,
        });
        if (!updated) throw new NotFoundException(`Project ${projectId} not found`);
        const s = (updated.settings ?? {}) as ProjectSettings;
        return {
            defaultEnvironmentVariables: s.defaultEnvironmentVariables,
            productionEnvironmentVariables: s.productionEnvironmentVariables,
            stagingEnvironmentVariables: s.stagingEnvironmentVariables,
            developmentEnvironmentVariables: s.developmentEnvironmentVariables,
        };
    }

    async getDeploymentConfig(projectId: string, requesterId: string) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const s = (project.settings ?? {}) as ProjectSettings;
        const resolved = runtimeConfigurationAccessor.resolveStrict({
            scope: "project",
            context: {
                projectId
            },
            project: runtimeConfigurationAccessor.projectConfigFromSettings(project.settings ?? null),
        });

        return {
            autoCleanupDays: s.autoCleanupDays ?? 30,
            maxPreviewEnvironments: s.maxPreviewEnvironments ?? 10,
            deploymentStrategy: resolved.effective.deployment.strategy,
            healthCheckTimeout: s.healthCheckTimeout ?? 60,
            deploymentTimeout: s.deploymentTimeout ?? 600,
            enableRollback: s.enableRollback ?? true,
            requireApprovalForProduction: resolved.effective.deployment.requireApprovalForProduction,
        };
    }

    async updateDeploymentConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<Pick<ProjectSettings, "autoCleanupDays" | "maxPreviewEnvironments" | "deploymentStrategy" | "healthCheckTimeout" | "deploymentTimeout" | "enableRollback" | "requireApprovalForProduction">>,
    ) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const current = (project.settings ?? {}) as ProjectSettings;
        const merged = { ...current, ...patch };
        const updated = await this.projectRepository.update(projectId, {
            settings: merged,
        });
        if (!updated) throw new NotFoundException(`Project ${projectId} not found`);
        const s = (updated.settings ?? {}) as ProjectSettings;
        return {
            autoCleanupDays: s.autoCleanupDays ?? 30,
            maxPreviewEnvironments: s.maxPreviewEnvironments ?? 10,
            deploymentStrategy: s.deploymentStrategy ?? "rolling",
            healthCheckTimeout: s.healthCheckTimeout ?? 60,
            deploymentTimeout: s.deploymentTimeout ?? 600,
            enableRollback: s.enableRollback ?? true,
            requireApprovalForProduction: s.requireApprovalForProduction ?? false,
        };
    }

    async getSecurityConfig(projectId: string, requesterId: string) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const s = (project.settings ?? {}) as ProjectSettings;
        const resolved = runtimeConfigurationAccessor.resolveStrict({
            scope: "project",
            context: {
                projectId,
            },
            project: runtimeConfigurationAccessor.projectConfigFromSettings(project.settings ?? null),
        });

        return {
            webhookSecret: s.webhookSecret,
            enableHttpsRedirect: resolved.effective.routing.forceHttps,
            allowedDomains: s.allowedDomains,
            ipWhitelist: s.ipWhitelist,
            enableBasicAuth: s.enableBasicAuth ?? false,
            basicAuthUsername: s.basicAuthUsername,
            basicAuthPassword: s.basicAuthPassword,
        };
    }

    async updateSecurityConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<Pick<ProjectSettings, "webhookSecret" | "enableHttpsRedirect" | "allowedDomains" | "ipWhitelist" | "enableBasicAuth" | "basicAuthUsername" | "basicAuthPassword">>,
    ) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const current = (project.settings ?? {}) as ProjectSettings;
        const merged = { ...current, ...patch };
        const updated = await this.projectRepository.update(projectId, {
            settings: merged,
        });
        if (!updated) throw new NotFoundException(`Project ${projectId} not found`);
        const s = (updated.settings ?? {}) as ProjectSettings;
        return {
            webhookSecret: s.webhookSecret,
            enableHttpsRedirect: s.enableHttpsRedirect ?? true,
            allowedDomains: s.allowedDomains,
            ipWhitelist: s.ipWhitelist,
            enableBasicAuth: s.enableBasicAuth ?? false,
            basicAuthUsername: s.basicAuthUsername,
            basicAuthPassword: s.basicAuthPassword,
        };
    }

    async getResourceConfig(projectId: string, requesterId: string) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const s = (project.settings ?? {}) as ProjectSettings;
        return {
            defaultCpuLimit: s.defaultCpuLimit ?? "0.5",
            defaultMemoryLimit: s.defaultMemoryLimit ?? "512MB",
            defaultStorageLimit: s.defaultStorageLimit ?? "10GB",
            maxServicesPerProject: s.maxServicesPerProject ?? 20,
        };
    }

    async updateResourceConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<Pick<ProjectSettings, "defaultCpuLimit" | "defaultMemoryLimit" | "defaultStorageLimit" | "maxServicesPerProject">>,
    ) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const current = (project.settings ?? {}) as ProjectSettings;
        const merged = { ...current, ...patch };
        const updated = await this.projectRepository.update(projectId, {
            settings: merged,
        });
        if (!updated) throw new NotFoundException(`Project ${projectId} not found`);
        const s = (updated.settings ?? {}) as ProjectSettings;
        return {
            defaultCpuLimit: s.defaultCpuLimit ?? "0.5",
            defaultMemoryLimit: s.defaultMemoryLimit ?? "512MB",
            defaultStorageLimit: s.defaultStorageLimit ?? "10GB",
            maxServicesPerProject: s.maxServicesPerProject ?? 20,
        };
    }

    async getNotificationConfig(projectId: string, requesterId: string) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const s = (project.settings ?? {}) as ProjectSettings;
        return {
            enableEmailNotifications: s.enableEmailNotifications ?? true,
            enableSlackNotifications: s.enableSlackNotifications ?? false,
            slackWebhookUrl: s.slackWebhookUrl,
            emailRecipients: s.emailRecipients,
            notifyOnDeploymentSuccess: s.notifyOnDeploymentSuccess ?? false,
            notifyOnDeploymentFailure: s.notifyOnDeploymentFailure ?? true,
            notifyOnServiceDown: s.notifyOnServiceDown ?? true,
        };
    }

    async updateNotificationConfig(
        projectId: string,
        requesterId: string,
        patch: Partial<Pick<ProjectSettings, "enableEmailNotifications" | "enableSlackNotifications" | "slackWebhookUrl" | "emailRecipients" | "notifyOnDeploymentSuccess" | "notifyOnDeploymentFailure" | "notifyOnServiceDown">>,
    ) {
        const project = await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const current = (project.settings ?? {}) as ProjectSettings;
        const merged = { ...current, ...patch };
        const updated = await this.projectRepository.update(projectId, {
            settings: merged,
        });
        if (!updated) throw new NotFoundException(`Project ${projectId} not found`);
        const s = (updated.settings ?? {}) as ProjectSettings;
        return {
            enableEmailNotifications: s.enableEmailNotifications ?? true,
            enableSlackNotifications: s.enableSlackNotifications ?? false,
            slackWebhookUrl: s.slackWebhookUrl,
            emailRecipients: s.emailRecipients,
            notifyOnDeploymentSuccess: s.notifyOnDeploymentSuccess ?? false,
            notifyOnDeploymentFailure: s.notifyOnDeploymentFailure ?? true,
            notifyOnServiceDown: s.notifyOnServiceDown ?? true,
        };
    }

    /** @deprecated Use typed config methods instead */
    async getProjectSettings(projectId: string, requesterId: string) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);
        return project.settings ?? {};
    }

    /** @deprecated Use typed config methods instead */
    async updateProjectSettings(
        projectId: string,
        requesterId: string,
        patch: Record<string, unknown>,
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin"]);
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);

        const current = isRecord(project.settings ?? {}) ? (project.settings ?? {}) : {};
        const merged = { ...current, ...patch };

        const updated = await this.projectRepository.update(projectId, {
            settings: merged,
        });
        return updated?.settings ?? merged;
    }

    // ========================================
    // UTILITIES
    // ========================================

    async resolveVariables(
        projectId: string,
        requesterId: string,
        data: { template: string; environmentId?: string; scope?: string },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        // TODO: integrate with variable-resolver module
        const resolved = data.template.replace(/\$\{([^}]+)\}/g, (_match, key: unknown) => {
            return `<${String(key)}>`;
        });
        return { resolved, variables: {} as Record<string, string> };
    }

    async getAvailableVariables(
        projectId: string,
        requesterId: string,
        _query?: { environmentId?: string; scope?: string },
    ) {
        await this.assertProjectAccess(projectId, requesterId, ["owner", "admin", "developer", "viewer"]);
        // TODO: integrate with variable-resolver module
        return {
            variables: [] as { key: string; path: string; scope: string; description: string | null; example: string | null }[],
            scopes: [] as { scope: string; description: string; variables: string[] }[],
        };
    }

    streamQueryEvents(input: ProjectStreamQueryInput): Observable<ProjectStreamEvent & { sequence: number; replayed: boolean; emittedAt: string }> {
        if (!this.coreEventSyncService) {
            throw new BadRequestException("Project event stream is unavailable: CoreEventSyncService is not wired");
        }

        let query = this.coreEventSyncService.selectMany({
            service: this.projectEventService,
            selections: [
                { eventName: "projectCreated" },
                { eventName: "projectUpdated" },
                { eventName: "projectDeleted" },
                { eventName: "projectCollaboratorInvited" },
                { eventName: "projectCollaboratorRemoved" },
                { eventName: "projectEnvironmentCreated" },
                { eventName: "projectEnvironmentDeleted" },
            ] as const,
        });

        if (input.eventTypes && input.eventTypes.length > 0) {
            const accepted = new Set(input.eventTypes);
            query = query.whereEventName((eventName) => accepted.has(eventName));
        }

        if (input.projectId) {
            query = query.wherePayload((payload) => {
                const value = payload as { projectId?: string };
                return value.projectId === input.projectId;
            });
        }

        if (input.ownerId) {
            query = query.wherePayload((payload) => {
                const value = payload as { ownerId?: string };
                return value.ownerId === input.ownerId;
            });
        }

        if (input.fuzzy) {
            query = query.whereFuzzy(input.fuzzy);
        }

        const live$ = query.execute().pipe(
            map((row) => this.toProjectStreamEvent(row.project)),
            rxFilter((event): event is ProjectStreamEvent => event !== null),
        );

        return this.toSequencedObservable({
            replay$: input.replay
                ? defer(() => from(this.getProjectReplayEvents(input))).pipe(mergeMap((events) => from(events)))
                : EMPTY,
            live$,
        });
    }

    private async getProjectReplayEvents(input: ProjectStreamQueryInput): Promise<ProjectStreamEvent[]> {
        const list = await this.projectRepository.findMany({
            limit: input.replayLimit,
            offset: 0,
            filter: {
                ...(input.projectId ? { id: { value: input.projectId, operator: "eq" as const } } : {}),
                ...(input.ownerId ? { ownerId: { value: input.ownerId, operator: "eq" as const } } : {}),
                ...(input.fuzzy ? { name: { value: input.fuzzy, operator: "ilike" as const } } : {}),
            },
            sortBy: "updatedAt",
            sortDirection: "desc",
        });

        let events = list.data.map((project) => ({
            type: "projectCreated" as const,
            projectId: project.id,
            ownerId: project.ownerId,
            name: project.name,
            timestamp: project.updatedAt,
        }));

        if (input.eventTypes && input.eventTypes.length > 0) {
            const accepted = new Set(input.eventTypes);
            events = events.filter((event) => accepted.has(event.type));
        }

        return events.slice(0, input.replayLimit);
    }

    private toProjectStreamEvent(
        envelope: {
            eventName: string;
            payload: unknown;
        } | null,
    ): ProjectStreamEvent | null {
        if (!envelope) return null;

        switch (envelope.eventName) {
            case "projectCreated":
            case "projectUpdated":
            case "projectDeleted":
            case "projectCollaboratorInvited":
            case "projectCollaboratorRemoved":
            case "projectEnvironmentCreated":
            case "projectEnvironmentDeleted":
                return {
                    type: envelope.eventName,
                    ...(envelope.payload as object),
                } as ProjectStreamEvent;
            default:
                return null;
        }
    }

    private toSequencedObservable<TEvent extends object>(input: {
        replay$: Observable<TEvent>;
        live$: Observable<TEvent>;
    }): Observable<TEvent & { sequence: number; replayed: boolean; emittedAt: string }> {
        let sequence = 0;
        const stream$ = concat(
            input.replay$.pipe(map((event) => ({ event, replayed: true }))),
            input.live$.pipe(map((event) => ({ event, replayed: false }))),
        ).pipe(
            map(({ event, replayed }) => {
                sequence += 1;
                return {
                    ...event,
                    sequence,
                    replayed,
                    emittedAt: new Date().toISOString(),
                };
            }),
        );

        return stream$;
    }

    private toCoreAdapterStream(
        definition: {
            scope: "global" | "tenant" | "project" | "service" | "deployment";
            scopeId: string | null;
            filters: Record<string, unknown> | null;
        },
        replay: boolean,
        replayLimit: number,
    ): Observable<{ eventName: string; payload: unknown; replayed?: boolean; emittedAt?: string }> {
        const filters = definition.filters ?? {};
        const scopedProjectId = definition.scope === "project" ? definition.scopeId ?? undefined : undefined;

        const source$ = this.streamQueryEvents({
            projectId: typeof filters.projectId === "string" ? filters.projectId : scopedProjectId,
            ownerId: typeof filters.ownerId === "string" ? filters.ownerId : undefined,
            eventTypes: Array.isArray(filters.eventTypes)
                ? filters.eventTypes.filter((v): v is ProjectStreamEvent["type"] => typeof v === "string")
                : undefined,
            fuzzy: typeof filters.fuzzy === "string" ? filters.fuzzy : undefined,
            replay,
            replayLimit,
        });

        return source$.pipe(
            map((event) => ({
                eventName: event.type,
                payload: event,
                replayed: event.replayed,
                emittedAt: event.emittedAt,
            })),
        );
    }

    // ========================================
    // PRIVATE HELPERS
    // ========================================

    private async assertProjectAccess(
        projectId: string,
        userId: string,
        allowedRoles: string[],
    ) {
        const project = await this.projectRepository.findById(projectId);
        if (!project) throw new NotFoundException(`Project ${projectId} not found`);

        // Project owner always has access
        if (project.ownerId === userId) return project;

        const collaborator = await this.projectRepository.findCollaboratorByUserAndProject(
            userId,
            projectId,
        );
        if (!collaborator || !allowedRoles.includes(collaborator.role)) {
            throw new ForbiddenException("You do not have permission to perform this action");
        }
        return project;
    }
}
