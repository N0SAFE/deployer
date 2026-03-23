import z from "zod/v4";
import { route } from "@repo/orpc-utils";
import {
    projectDeploymentConfigSchema,
    projectEnvironmentConfigSchema,
    projectGeneralConfigSchema,
    projectNotificationConfigSchema,
    projectResourceConfigSchema,
    projectSecurityConfigSchema,
} from "@repo/api-contracts/common/project";

const idParam = z.object({ id: z.uuid() });

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
    .input(idParam.extend(projectGeneralConfigSchema.partial().shape))
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
    .input(idParam.extend(projectEnvironmentConfigSchema.partial().shape))
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
    .input(idParam.extend(projectDeploymentConfigSchema.partial().shape))
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
    .input(idParam.extend(projectSecurityConfigSchema.partial().shape))
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
    .input(idParam.extend(projectResourceConfigSchema.partial().shape))
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
    .input(idParam.extend(projectNotificationConfigSchema.partial().shape))
    .output(projectNotificationConfigSchema)
    .build();
