import { oc } from "@orpc/contract";
import { projectListContract } from "./list";
import { projectFindByIdContract } from "./findById";
import { projectCreateContract } from "./create";
import { projectUpdateContract } from "./update";
import { projectDeleteContract } from "./delete";
import {
    projectGetCollaboratorsContract,
    projectInviteCollaboratorContract,
    projectUpdateCollaboratorContract,
    projectRemoveCollaboratorContract,
} from "./collaborators";
import {
    projectListEnvironmentsContract,
    projectGetEnvironmentContract,
    projectCreateEnvironmentContract,
    projectUpdateEnvironmentContract,
    projectDeleteEnvironmentContract,
    projectCloneEnvironmentContract,
} from "./environments";
import {
    projectListServiceEnvironmentLinksContract,
    projectUpsertServiceEnvironmentLinkContract,
} from "./service-environment-links";
import {
    projectListVariableTemplatesContract,
    projectGetVariableTemplateContract,
    projectCreateVariableTemplateContract,
    projectUpdateVariableTemplateContract,
    projectDeleteVariableTemplateContract,
} from "./templates";
import {
    projectGetDeploymentConfigContract,
    projectGetEnvironmentConfigContract,
    projectGetGeneralConfigContract,
    projectGetNotificationConfigContract,
    projectGetResourceConfigContract,
    projectGetSecurityConfigContract,
    projectUpdateDeploymentConfigContract,
    projectUpdateEnvironmentConfigContract,
    projectUpdateGeneralConfigContract,
    projectUpdateNotificationConfigContract,
    projectUpdateResourceConfigContract,
    projectUpdateSecurityConfigContract,
} from "./config";
import {
    projectGetAllEnvironmentStatusesContract,
    projectGetAvailableVariablesContract,
    projectGetEnvironmentStatusContract,
    projectRefreshEnvironmentStatusContract,
    projectResolveVariablesContract,
} from "./utils";
import { projectQueryStreamContract } from "./stream";
import {
    projectGetNetworkContract,
    projectUpdateNetworkContract,
} from "./network";

export const projectContract = oc.tag("Project").prefix("/projects").router({
    // Core CRUD
    list: projectListContract,
    findById: projectFindByIdContract,
    create: projectCreateContract,
    update: projectUpdateContract,
    delete: projectDeleteContract,
    // Collaborator management
    getCollaborators: projectGetCollaboratorsContract,
    inviteCollaborator: projectInviteCollaboratorContract,
    updateCollaborator: projectUpdateCollaboratorContract,
    removeCollaborator: projectRemoveCollaboratorContract,
    // Environment management
    listEnvironments: projectListEnvironmentsContract,
    getEnvironment: projectGetEnvironmentContract,
    createEnvironment: projectCreateEnvironmentContract,
    updateEnvironment: projectUpdateEnvironmentContract,
    deleteEnvironment: projectDeleteEnvironmentContract,
    cloneEnvironment: projectCloneEnvironmentContract,
    // Service × environment links (which services participate in which env)
    listServiceEnvironmentLinks: projectListServiceEnvironmentLinksContract,
    upsertServiceEnvironmentLink: projectUpsertServiceEnvironmentLinkContract,
    // Variable template management
    listVariableTemplates: projectListVariableTemplatesContract,
    getVariableTemplate: projectGetVariableTemplateContract,
    createVariableTemplate: projectCreateVariableTemplateContract,
    updateVariableTemplate: projectUpdateVariableTemplateContract,
    deleteVariableTemplate: projectDeleteVariableTemplateContract,
    // Configuration
    getGeneralConfig: projectGetGeneralConfigContract,
    updateGeneralConfig: projectUpdateGeneralConfigContract,
    getEnvironmentConfig: projectGetEnvironmentConfigContract,
    updateEnvironmentConfig: projectUpdateEnvironmentConfigContract,
    getDeploymentConfig: projectGetDeploymentConfigContract,
    updateDeploymentConfig: projectUpdateDeploymentConfigContract,
    getSecurityConfig: projectGetSecurityConfigContract,
    updateSecurityConfig: projectUpdateSecurityConfigContract,
    getResourceConfig: projectGetResourceConfigContract,
    updateResourceConfig: projectUpdateResourceConfigContract,
    getNotificationConfig: projectGetNotificationConfigContract,
    updateNotificationConfig: projectUpdateNotificationConfigContract,
    // Variable resolution and monitoring
    resolveVariables: projectResolveVariablesContract,
    getAvailableVariables: projectGetAvailableVariablesContract,
    getEnvironmentStatus: projectGetEnvironmentStatusContract,
    getAllEnvironmentStatuses: projectGetAllEnvironmentStatusesContract,
    refreshEnvironmentStatus: projectRefreshEnvironmentStatusContract,
    streamQuery: projectQueryStreamContract,
    // Network configuration (DNS provider + zone + records)
    getNetwork: projectGetNetworkContract,
    updateNetwork: projectUpdateNetworkContract,
});

export type ProjectContract = typeof projectContract;

export * from "./list";
export * from "./findById";
export * from "./create";
export * from "./update";
export * from "./delete";
export * from "./collaborators";
export * from "./environments";
export * from "./service-environment-links";
export * from "./templates";
export * from "./config";
export * from "./utils";
export * from "./stream";
export * from "./network";
