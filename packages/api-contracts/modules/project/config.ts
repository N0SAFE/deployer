import { oc } from '@orpc/contract';
import { z } from 'zod';
import {
  projectGeneralConfigSchema,
  projectEnvironmentConfigSchema,
  projectDeploymentConfigSchema,
  projectSecurityConfigSchema,
  projectResourceConfigSchema,
  projectNotificationConfigSchema,
} from './schemas';

// General Configuration
export const projectGetGeneralConfigInput = z.object({ id: z.string().uuid() });
export const projectGetGeneralConfigOutput = projectGeneralConfigSchema;

export const projectGetGeneralConfigContract = oc
  .route({
    method: "GET",
    path: "/:id/config/general",
    summary: "Get project general configuration",
  })
  .input(projectGetGeneralConfigInput)
  .output(projectGetGeneralConfigOutput);

export const projectUpdateGeneralConfigInput = z.object({ id: z.string().uuid() }).merge(projectGeneralConfigSchema);
export const projectUpdateGeneralConfigOutput = projectGeneralConfigSchema;

export const projectUpdateGeneralConfigContract = oc
  .route({
    method: "PUT",
    path: "/:id/config/general",
    summary: "Update project general configuration",
  })
  .input(projectUpdateGeneralConfigInput)
  .output(projectUpdateGeneralConfigOutput);

// Environment Configuration
export const projectGetEnvironmentConfigInput = z.object({ id: z.string().uuid() });
export const projectGetEnvironmentConfigOutput = projectEnvironmentConfigSchema;

export const projectGetEnvironmentConfigContract = oc
  .route({
    method: "GET",
    path: "/:id/config/environment",
    summary: "Get project environment configuration",
  })
  .input(projectGetEnvironmentConfigInput)
  .output(projectGetEnvironmentConfigOutput);

export const projectUpdateEnvironmentConfigInput = z.object({ id: z.string().uuid() }).merge(projectEnvironmentConfigSchema);
export const projectUpdateEnvironmentConfigOutput = projectEnvironmentConfigSchema;

export const projectUpdateEnvironmentConfigContract = oc
  .route({
    method: "PUT",
    path: "/:id/config/environment", 
    summary: "Update project environment configuration",
  })
  .input(projectUpdateEnvironmentConfigInput)
  .output(projectUpdateEnvironmentConfigOutput);

// Deployment Configuration
export const projectGetDeploymentConfigInput = z.object({ id: z.string().uuid() });
export const projectGetDeploymentConfigOutput = projectDeploymentConfigSchema;

export const projectGetDeploymentConfigContract = oc
  .route({
    method: "GET",
    path: "/:id/config/deployment",
    summary: "Get project deployment configuration",
  })
  .input(projectGetDeploymentConfigInput)
  .output(projectGetDeploymentConfigOutput);

export const projectUpdateDeploymentConfigInput = z.object({ id: z.string().uuid() }).merge(projectDeploymentConfigSchema);
export const projectUpdateDeploymentConfigOutput = projectDeploymentConfigSchema;

export const projectUpdateDeploymentConfigContract = oc
  .route({
    method: "PUT", 
    path: "/:id/config/deployment",
    summary: "Update project deployment configuration",
  })
  .input(projectUpdateDeploymentConfigInput)
  .output(projectUpdateDeploymentConfigOutput);

// Security Configuration
export const projectGetSecurityConfigInput = z.object({ id: z.string().uuid() });
export const projectGetSecurityConfigOutput = projectSecurityConfigSchema;

export const projectGetSecurityConfigContract = oc
  .route({
    method: "GET",
    path: "/:id/config/security",
    summary: "Get project security configuration",
  })
  .input(projectGetSecurityConfigInput)
  .output(projectGetSecurityConfigOutput);

export const projectUpdateSecurityConfigInput = z.object({ id: z.string().uuid() }).merge(projectSecurityConfigSchema);
export const projectUpdateSecurityConfigOutput = projectSecurityConfigSchema;

export const projectUpdateSecurityConfigContract = oc
  .route({
    method: "PUT",
    path: "/:id/config/security", 
    summary: "Update project security configuration",
  })
  .input(projectUpdateSecurityConfigInput)
  .output(projectUpdateSecurityConfigOutput);

// Resource Configuration
export const projectGetResourceConfigInput = z.object({ id: z.string().uuid() });
export const projectGetResourceConfigOutput = projectResourceConfigSchema;

export const projectGetResourceConfigContract = oc
  .route({
    method: "GET",
    path: "/:id/config/resources",
    summary: "Get project resource configuration",
  })
  .input(projectGetResourceConfigInput)
  .output(projectGetResourceConfigOutput);

export const projectUpdateResourceConfigInput = z.object({ id: z.string().uuid() }).merge(projectResourceConfigSchema);
export const projectUpdateResourceConfigOutput = projectResourceConfigSchema;

export const projectUpdateResourceConfigContract = oc
  .route({
    method: "PUT",
    path: "/:id/config/resources",
    summary: "Update project resource configuration", 
  })
  .input(projectUpdateResourceConfigInput)
  .output(projectUpdateResourceConfigOutput);

// Notification Configuration
export const projectGetNotificationConfigInput = z.object({ id: z.string().uuid() });
export const projectGetNotificationConfigOutput = projectNotificationConfigSchema;

export const projectGetNotificationConfigContract = oc
  .route({
    method: "GET",
    path: "/:id/config/notifications",
    summary: "Get project notification configuration",
  })
  .input(projectGetNotificationConfigInput)
  .output(projectGetNotificationConfigOutput);

export const projectUpdateNotificationConfigInput = z.object({ id: z.string().uuid() }).merge(projectNotificationConfigSchema);
export const projectUpdateNotificationConfigOutput = projectNotificationConfigSchema;

export const projectUpdateNotificationConfigContract = oc
  .route({
    method: "PUT",
    path: "/:id/config/notifications",
    summary: "Update project notification configuration",
  })
  .input(projectUpdateNotificationConfigInput)
  .output(projectUpdateNotificationConfigOutput);