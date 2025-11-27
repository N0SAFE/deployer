/**
 * Project Module Type Definitions
 * 
 * PURPOSE: Centralized type definitions for project module
 * 
 * PATTERN: Extract contract output types for compile-time safety using z.infer
 * - All types come from @repo/api-contracts Zod schemas
 * - Used by adapters for fixed return types
 * - Single source of truth for contract shapes
 * 
 * ORGANIZATION:
 * - Core CRUD types (list, getById, create, update, delete)
 * - Collaborator types
 * - Configuration types (6 config domains)
 * - Environment types
 * - Variable template types
 * - Utility types (status, variables)
 * - Input types for repository and service
 */

import type { z } from 'zod';
import type { 
  // Core CRUD schemas
  projectListOutput,
  projectGetByIdOutput,
  projectCreateOutput,
  projectUpdateOutput,
  projectDeleteOutput,
  // Collaborator schemas  
  projectGetCollaboratorsOutput,
  projectInviteCollaboratorOutput,
  projectUpdateCollaboratorOutput,
  projectRemoveCollaboratorOutput,
  // Configuration schemas
  projectGetGeneralConfigOutput,
  projectGetEnvironmentConfigOutput,
  projectGetDeploymentConfigOutput,
  projectGetSecurityConfigOutput,
  projectGetResourceConfigOutput,
  projectGetNotificationConfigOutput,
  // Environment schemas
  projectListEnvironmentsOutput,
  projectGetEnvironmentOutput,
  projectCreateEnvironmentOutput,
  projectUpdateEnvironmentOutput,
  projectDeleteEnvironmentOutput,
  projectCloneEnvironmentOutput,
  // Template schemas
  projectListVariableTemplatesOutput,
  projectGetVariableTemplateOutput,
  projectCreateVariableTemplateOutput,
  projectUpdateVariableTemplateOutput,
  projectDeleteVariableTemplateOutput,
  // Utility schemas
  projectResolveVariablesOutput,
  projectGetAvailableVariablesOutput,
  projectGetEnvironmentStatusOutput,
  projectGetAllEnvironmentStatusesOutput,
  projectRefreshEnvironmentStatusOutput,
} from '@repo/api-contracts';

// ========================================
// CUSTOM BUSINESS TYPES (For Interface Use)
// ========================================

/**
 * Variable validation rule types
 */
export type VariableValidationType = 'regex' | 'url' | 'email' | 'number' | 'boolean' | 'enum';

export interface VariableValidationRule {
    type: VariableValidationType;
    value: string;
    message?: string;
}

/**
 * Variable template structure
 */
export interface VariableTemplateVariable {
    key: string;
    template: string;
    description?: string;
    category?: string;
    required?: boolean;
    defaultValue?: string;
    validation?: VariableValidationRule[];
}

/**
 * Project collaborator permissions
 */
export interface CollaboratorPermissions {
    canDeploy?: boolean;
    canManageServices?: boolean;
    canManageCollaborators?: boolean;
    canViewLogs?: boolean;
    canDeleteDeployments?: boolean;
}

/**

/** Project settings type */
export interface ProjectSettings {
    autoCleanupDays?: number;
    maxPreviewEnvironments?: number;
    defaultEnvironmentVariables?: Record<string, string>;
    webhookSecret?: string;
    traefikEnabled?: boolean;
    domain?: string;
    traefikInstanceId?: string;
}

/** Environment domain config type */
export interface EnvironmentDomainConfig {
    sslEnabled?: boolean;
    customDomain?: string;
    baseDomain?: string;
    subdomain?: string;
}

/** Environment preview settings type */
export interface EnvironmentPreviewSettings {
    sourceBranch?: string;
}

/** Environment deployment config type */
export interface EnvironmentDeploymentConfig {
    autoDeployEnabled?: boolean;
    deploymentStrategy?: 'rolling' | 'blue-green' | 'canary' | 'recreate';
    healthCheckEnabled?: boolean;
    deployTimeoutMinutes?: number;
    maxInstances?: number;
}

/** Environment resource limits type */
export interface EnvironmentResourceLimits {
    cpu?: string;
    memory?: string;
    storage?: string;
}

/** Environment metadata type */
export interface EnvironmentMetadata {
    tags?: string[];
    [key: string]: unknown;
}

/** Project statistics type */
export interface ProjectStats {
    services: number;
    deployments: number;
    collaborators: number;
    latestDeployment: unknown | null;
}

// ========================================
// INPUT TYPES (for Repository & Service)
// ========================================

export interface GetProjectsInput {
    limit?: number;
    offset?: number;
    search?: string;
    sortBy?: 'name' | 'createdAt' | 'updatedAt';
    sortOrder?: 'asc' | 'desc';
}

export interface CreateProjectInput {
    name: string;
    description?: string | null;
    baseDomain?: string | null;
    ownerId: string;
    settings?: ProjectSettings | null;
}

export interface UpdateProjectInput {
    name?: string;
    description?: string | null;
    baseDomain?: string | null;
    settings?: ProjectSettings | null;
}

export interface CreateEnvironmentInput {
    projectId: string;
    name: string;
    slug: string;
    description: string;
    type: 'production' | 'staging' | 'preview' | 'development';
    status: string;
    domainConfig?: EnvironmentDomainConfig;
    previewSettings?: EnvironmentPreviewSettings;
    deploymentConfig?: EnvironmentDeploymentConfig;
    metadata?: EnvironmentMetadata;
    createdBy: string;
}

export interface UpdateEnvironmentInput {
    name?: string;
    slug?: string;
    type?: 'production' | 'staging' | 'preview' | 'development';
    domainConfig?: EnvironmentDomainConfig;
    previewSettings?: EnvironmentPreviewSettings;
    deploymentConfig?: EnvironmentDeploymentConfig;
    metadata?: EnvironmentMetadata;
}

export interface CreateVariableTemplateInput {
    name: string;
    description?: string | null;
    variables: VariableTemplateVariable[];
    createdBy: string;
}

export interface UpdateVariableTemplateInput {
    name?: string;
    description?: string | null;
    variables?: VariableTemplateVariable[];
}

export interface CreateCollaboratorInput {
    id: string;
    projectId: string;
    userId: string;
    role: string;
    permissions?: CollaboratorPermissions;
    invitedBy: string | null;
    invitedAt: Date;
}

export interface UpdateCollaboratorInput {
    role?: string;
    permissions?: CollaboratorPermissions;
}

// ========================================
// CORE CRUD TYPES
// ========================================

/** Project list response with pagination */
export type ProjectListContract = z.infer<typeof projectListOutput>;

/** Single project response with stats */
export type ProjectContract = z.infer<typeof projectGetByIdOutput>;

/** Project creation response */
export type ProjectCreateContract = z.infer<typeof projectCreateOutput>;

/** Project update response */
export type ProjectUpdateContract = z.infer<typeof projectUpdateOutput>;

/** Project deletion response */
export type ProjectDeleteContract = z.infer<typeof projectDeleteOutput>;

// ========================================
// COLLABORATOR TYPES
// ========================================

/** List of project collaborators */
export type ProjectCollaboratorsContract = z.infer<typeof projectGetCollaboratorsOutput>;

/** Collaborator invitation response */
export type ProjectInviteCollaboratorContract = z.infer<typeof projectInviteCollaboratorOutput>;

/** Collaborator update response */
export type ProjectUpdateCollaboratorContract = z.infer<typeof projectUpdateCollaboratorOutput>;

/** Collaborator removal response */
export type ProjectRemoveCollaboratorContract = z.infer<typeof projectRemoveCollaboratorOutput>;

// ========================================
// CONFIGURATION TYPES
// ========================================

/** General project configuration */
export type ProjectGeneralConfigContract = z.infer<typeof projectGetGeneralConfigOutput>;

/** Environment variables configuration */
export type ProjectEnvironmentConfigContract = z.infer<typeof projectGetEnvironmentConfigOutput>;

/** Deployment settings configuration */
export type ProjectDeploymentConfigContract = z.infer<typeof projectGetDeploymentConfigOutput>;

/** Security settings configuration */
export type ProjectSecurityConfigContract = z.infer<typeof projectGetSecurityConfigOutput>;

/** Resource limits configuration */
export type ProjectResourceConfigContract = z.infer<typeof projectGetResourceConfigOutput>;

/** Notification settings configuration */
export type ProjectNotificationConfigContract = z.infer<typeof projectGetNotificationConfigOutput>;

// ========================================
// ENVIRONMENT TYPES
// ========================================

/** List of project environments */
export type ProjectEnvironmentsContract = z.infer<typeof projectListEnvironmentsOutput>;

/** Single environment details */
export type ProjectEnvironmentContract = z.infer<typeof projectGetEnvironmentOutput>;

/** Environment creation response */
export type ProjectCreateEnvironmentContract = z.infer<typeof projectCreateEnvironmentOutput>;

/** Environment update response */
export type ProjectUpdateEnvironmentContract = z.infer<typeof projectUpdateEnvironmentOutput>;

/** Environment deletion response */
export type ProjectDeleteEnvironmentContract = z.infer<typeof projectDeleteEnvironmentOutput>;

/** Environment clone response */
export type ProjectCloneEnvironmentContract = z.infer<typeof projectCloneEnvironmentOutput>;

// ========================================
// VARIABLE TEMPLATE TYPES
// ========================================

/** List of variable templates */
export type ProjectVariableTemplatesContract = z.infer<typeof projectListVariableTemplatesOutput>;

/** Single variable template details */
export type ProjectVariableTemplateContract = z.infer<typeof projectGetVariableTemplateOutput>;

/** Variable template creation response */
export type ProjectCreateVariableTemplateContract = z.infer<typeof projectCreateVariableTemplateOutput>;

/** Variable template update response */
export type ProjectUpdateVariableTemplateContract = z.infer<typeof projectUpdateVariableTemplateOutput>;

/** Variable template deletion response */
export type ProjectDeleteVariableTemplateContract = z.infer<typeof projectDeleteVariableTemplateOutput>;

// ========================================
// UTILITY TYPES
// ========================================

/** Resolved variables response */
export type ProjectResolveVariablesContract = z.infer<typeof projectResolveVariablesOutput>;

/** Available variables list */
export type ProjectAvailableVariablesContract = z.infer<typeof projectGetAvailableVariablesOutput>;

/** Environment status response */
export type ProjectEnvironmentStatusContract = z.infer<typeof projectGetEnvironmentStatusOutput>;

/** All environment statuses response */
export type ProjectAllEnvironmentStatusesContract = z.infer<typeof projectGetAllEnvironmentStatusesOutput>;

/** Environment status refresh response */
export type ProjectRefreshEnvironmentStatusContract = z.infer<typeof projectRefreshEnvironmentStatusOutput>;
