import { oc } from '@orpc/contract';
/**
 * Project Contract - Project Lifecycle Management
 *
 * **PURPOSE**: Complete project management from creation to deletion with comprehensive configuration
 *
 * **SCOPE**: This contract provides extensive project functionality including:
 * - Project CRUD operations with metadata and statistics
 * - Team collaboration with role-based permissions and invitations
 * - Multi-layered configuration management (general, environment, deployment, security, resources, notifications)
 * - Environment lifecycle management with cloning and templating
 * - Variable template system for dynamic configuration
 * - Real-time environment status monitoring and health checks
 *
 * **FRONTEND INTEGRATION**: ✅ Core platform functionality - Heavily used
 * - Project dashboard and overview pages
 * - Project settings and configuration forms
 * - Team management and collaboration features
 * - Environment management interfaces
 * - Variable and template management tools
 *
 * **CONTRACT ORGANIZATION**:
 * - **Core CRUD**: Basic project operations (list, get, create, update, delete)
 * - **Collaborators**: Team management with invitation and permission system
 * - **Configuration**: Multi-domain settings (6 configuration areas)
 * - **Environments**: Environment lifecycle with status monitoring
 * - **Templates**: Reusable configuration templates for variables
 * - **Utilities**: Helper operations for variable resolution and monitoring
 *
 * **RELATIONSHIP TO OTHER CONTRACTS**:
 * - **`user`**: Manages project collaborators and permissions
 * - **`service`**: Services belong to projects and inherit project settings
 * - **`environment`**: Project environments are managed through this contract
 * - **`deployment`**: Deployments target project environments
 * - **`variable-resolver`**: Uses project variables for configuration resolution
 *
 * Routes: /projects/*
 * Status: 🟢 Production Ready - Feature-complete and stable
 * Frontend Usage: ✅ Primary project management interface
 * Complexity: High - Comprehensive feature set with multiple sub-domains
 *
 * @example
 * // Create new project with basic setup
 * const project = await orpc.project.create({
 *   name: "My App",
 *   description: "Full-stack web application",
 *   repositoryUrl: "https://github.com/user/my-app"
 * });
 *
 * // Configure deployment settings
 * await orpc.project.updateDeploymentConfig({
 *   id: project.id,
 *   config: {
 *     deploymentStrategy: "rolling",
 *     autoDeployEnabled: true,
 *     rollbackOnFailure: true
 *   }
 * });
 *
 * // Set up production environment
 * const prodEnv = await orpc.project.createEnvironment({
 *   projectId: project.id,
 *   name: "production",
 *   type: "production",
 *   variables: { NODE_ENV: "production" }
 * });
 *
 * @see ../../CONTRACT_ARCHITECTURE.md for detailed contract organization
 * @see ../service/index.ts for service management within projects
 * @see ../environment/index.ts for additional environment operations
 */
// Import all contract definitions
import { projectListContract } from './list';
import { projectGetByIdContract } from './getById';
import { projectCreateContract } from './create';
import { projectUpdateContract } from './update';
import { projectDeleteContract } from './delete';
import { projectGetCollaboratorsContract, projectInviteCollaboratorContract, projectUpdateCollaboratorContract, projectRemoveCollaboratorContract, } from './collaborators';
import { projectGetGeneralConfigContract, projectUpdateGeneralConfigContract, projectGetEnvironmentConfigContract, projectUpdateEnvironmentConfigContract, projectGetDeploymentConfigContract, projectUpdateDeploymentConfigContract, projectGetSecurityConfigContract, projectUpdateSecurityConfigContract, projectGetResourceConfigContract, projectUpdateResourceConfigContract, projectGetNotificationConfigContract, projectUpdateNotificationConfigContract, } from './config';
import { projectListEnvironmentsContract, projectGetEnvironmentContract, projectCreateEnvironmentContract, projectUpdateEnvironmentContract, projectDeleteEnvironmentContract, projectCloneEnvironmentContract, } from './environments';
import { projectListVariableTemplatesContract, projectGetVariableTemplateContract, projectCreateVariableTemplateContract, projectUpdateVariableTemplateContract, projectDeleteVariableTemplateContract, } from './templates';
import { projectResolveVariablesContract, projectGetAvailableVariablesContract, projectGetEnvironmentStatusContract, projectGetAllEnvironmentStatusesContract, projectRefreshEnvironmentStatusContract, } from './utils';
// Combine into main project contract
export const projectContract = oc.tag("Project").prefix("/projects").router({
    // Basic CRUD
    list: projectListContract,
    getById: projectGetByIdContract,
    create: projectCreateContract,
    update: projectUpdateContract,
    delete: projectDeleteContract,
    // Collaborator management
    getCollaborators: projectGetCollaboratorsContract,
    inviteCollaborator: projectInviteCollaboratorContract,
    updateCollaborator: projectUpdateCollaboratorContract,
    removeCollaborator: projectRemoveCollaboratorContract,
    // Configuration management
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
    // Environment management
    listEnvironments: projectListEnvironmentsContract,
    getEnvironment: projectGetEnvironmentContract,
    createEnvironment: projectCreateEnvironmentContract,
    updateEnvironment: projectUpdateEnvironmentContract,
    deleteEnvironment: projectDeleteEnvironmentContract,
    cloneEnvironment: projectCloneEnvironmentContract,
    // Variable template management
    listVariableTemplates: projectListVariableTemplatesContract,
    getVariableTemplate: projectGetVariableTemplateContract,
    createVariableTemplate: projectCreateVariableTemplateContract,
    updateVariableTemplate: projectUpdateVariableTemplateContract,
    deleteVariableTemplate: projectDeleteVariableTemplateContract,
    // Variable resolution and monitoring
    resolveVariables: projectResolveVariablesContract,
    getAvailableVariables: projectGetAvailableVariablesContract,
    getEnvironmentStatus: projectGetEnvironmentStatusContract,
    getAllEnvironmentStatuses: projectGetAllEnvironmentStatusesContract,
    refreshEnvironmentStatus: projectRefreshEnvironmentStatusContract,
});
export type ProjectContract = typeof projectContract;
// Re-export everything from individual contracts
export * from './schemas';
export * from './list';
export * from './getById';
export * from './create';
export * from './update';
export * from './delete';
export * from './collaborators';
export * from './config';
export * from './environments';
export * from './templates';
export * from './utils';
