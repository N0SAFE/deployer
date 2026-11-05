import { oc } from '@orpc/contract'
import { openapi } from '@orpc/openapi'

import {
    projectGetCollaboratorsContract,
    projectInviteCollaboratorContract,
    projectUpdateCollaboratorContract,
    projectRemoveCollaboratorContract,
} from './collaborators'
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
} from './config'
import { projectCreateContract } from './create'
import { projectDeleteContract } from './delete'
import {
    projectListEnvironmentsContract,
    projectGetEnvironmentContract,
    projectCreateEnvironmentContract,
    projectUpdateEnvironmentContract,
    projectDeleteEnvironmentContract,
    projectCloneEnvironmentContract,
} from './environments'
import { projectFindByIdContract } from './findById'
import { projectListContract } from './list'
import {
    projectGetNetworkContract,
    projectUpdateNetworkContract,
} from './network'
import {
    projectListServiceEnvironmentLinksContract,
    projectUpsertServiceEnvironmentLinkContract,
} from './service-environment-links'
import { projectQueryStreamContract } from './stream'
import {
    projectListVariableTemplatesContract,
    projectGetVariableTemplateContract,
    projectCreateVariableTemplateContract,
    projectUpdateVariableTemplateContract,
    projectDeleteVariableTemplateContract,
} from './templates'
import { projectUpdateContract } from './update'
import {
    projectGetAllEnvironmentStatusesContract,
    projectGetEnvironmentStatusContract,
    projectRefreshEnvironmentStatusContract,
} from './utils'

export const projectContract = oc
    .meta(openapi({ tags: ['Project'], prefix: '/projects' }))
    .router({
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
        upsertServiceEnvironmentLink:
            projectUpsertServiceEnvironmentLinkContract,
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
        // Environment status and monitoring
        getEnvironmentStatus: projectGetEnvironmentStatusContract,
        getAllEnvironmentStatuses: projectGetAllEnvironmentStatusesContract,
        refreshEnvironmentStatus: projectRefreshEnvironmentStatusContract,
        streamQuery: projectQueryStreamContract,
        // Network configuration (DNS provider + zone + records)
        getNetwork: projectGetNetworkContract,
        updateNetwork: projectUpdateNetworkContract,
    })

export type ProjectContract = typeof projectContract

export * from './list'
export * from './findById'
export * from './create'
export * from './update'
export * from './delete'
export * from './collaborators'
export * from './environments'
export * from './service-environment-links'
export * from './templates'
export * from './config'
export * from './utils'
export * from './stream'
export * from './network'
