import z from "zod/v4";
import { route } from "@repo/orpc-utils";
import {
    projectDeploymentConfigSchema,
    projectEnvironmentConfigSchema,
    projectGeneralConfigSchema,
    projectNotificationConfigSchema,
    projectResourceConfigSchema,
    projectSecurityConfigSchema,
} from "@repo/contracts-entities";

const idParam = z.object({ id: z.uuid() });

const projectGeneralConfigUpdateInputSchema = idParam.extend(
    z.object(projectGeneralConfigSchema.shape).partial().shape,
);

const projectEnvironmentConfigUpdateInputSchema = idParam.extend(
    z.object(projectEnvironmentConfigSchema.shape).partial().shape,
);

const projectDeploymentConfigUpdateInputSchema = idParam.extend(
    z.object(projectDeploymentConfigSchema.shape).partial().shape,
);

const projectSecurityConfigUpdateInputSchema = idParam.extend(
    z.object(projectSecurityConfigSchema.shape).partial().shape,
);

const projectResourceConfigUpdateInputSchema = idParam.extend(
    z.object(projectResourceConfigSchema.shape).partial().shape,
);

const projectNotificationConfigUpdateInputSchema = idParam.extend(
    z.object(projectNotificationConfigSchema.shape).partial().shape,
);

// ============================================================================
// General Configuration
// ============================================================================

export const projectGetGeneralConfigContract = route()
    .method("GET")
    .path("/:id/config/general")
    .input(idParam)
    .output(projectGeneralConfigSchema)
    .build();

export const projectUpdateGeneralConfigContract = route()
    .method("PUT")
    .path("/:id/config/general")
    .input(projectGeneralConfigUpdateInputSchema)
    .output(projectGeneralConfigSchema)
    .build();

// ============================================================================
// Environment Configuration
// ============================================================================

export const projectGetEnvironmentConfigContract = route()
    .method("GET")
    .path("/:id/config/environment")
    .input(idParam)
    .output(projectEnvironmentConfigSchema)
    .build();

export const projectUpdateEnvironmentConfigContract = route()
    .method("PUT")
    .path("/:id/config/environment")
    .input(projectEnvironmentConfigUpdateInputSchema)
    .output(projectEnvironmentConfigSchema)
    .build();

// ============================================================================
// Deployment Configuration
// ============================================================================

export const projectGetDeploymentConfigContract = route()
    .method("GET")
    .path("/:id/config/deployment")
    .input(idParam)
    .output(projectDeploymentConfigSchema)
    .build();

export const projectUpdateDeploymentConfigContract = route()
    .method("PUT")
    .path("/:id/config/deployment")
    .input(projectDeploymentConfigUpdateInputSchema)
    .output(projectDeploymentConfigSchema)
    .build();

// ============================================================================
// Security Configuration
// ============================================================================

export const projectGetSecurityConfigContract = route()
    .method("GET")
    .path("/:id/config/security")
    .input(idParam)
    .output(projectSecurityConfigSchema)
    .build();

export const projectUpdateSecurityConfigContract = route()
    .method("PUT")
    .path("/:id/config/security")
    .input(projectSecurityConfigUpdateInputSchema)
    .output(projectSecurityConfigSchema)
    .build();

// ============================================================================
// Resource Configuration
// ============================================================================

export const projectGetResourceConfigContract = route()
    .method("GET")
    .path("/:id/config/resource")
    .input(idParam)
    .output(projectResourceConfigSchema)
    .build();

export const projectUpdateResourceConfigContract = route()
    .method("PUT")
    .path("/:id/config/resource")
    .input(projectResourceConfigUpdateInputSchema)
    .output(projectResourceConfigSchema)
    .build();

// ============================================================================
// Notification Configuration
// ============================================================================

export const projectGetNotificationConfigContract = route()
    .method("GET")
    .path("/:id/config/notification")
    .input(idParam)
    .output(projectNotificationConfigSchema)
    .build();

export const projectUpdateNotificationConfigContract = route()
    .method("PUT")
    .path("/:id/config/notification")
    .input(projectNotificationConfigUpdateInputSchema)
    .output(projectNotificationConfigSchema)
    .build();
