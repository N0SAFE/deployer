import { oc } from '@orpc/contract';
import { z } from 'zod';

// Project schemas matching database
export const projectRoleSchema = z.enum(['owner', 'admin', 'developer', 'viewer']);

export const projectSettingsSchema = z.object({
  autoCleanupDays: z.number().optional(),
  maxPreviewEnvironments: z.number().optional(),
  defaultEnvironmentVariables: z.record(z.string(), z.string()).optional(),
  webhookSecret: z.string().optional(),
});

export const createProjectSchema = z.object({
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  baseDomain: z.string().optional(),
  settings: projectSettingsSchema.optional(),
});

export const updateProjectSchema = createProjectSchema.partial();

export const projectSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  baseDomain: z.string().nullable(),
  ownerId: z.string(),
  settings: projectSettingsSchema.nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const projectWithStatsSchema = projectSchema.extend({
  _count: z.object({
    services: z.number(),
    deployments: z.number(),
    collaborators: z.number(),
  }),
  latestDeployment: z.object({
    id: z.string(),
    status: z.enum(['pending', 'queued', 'building', 'deploying', 'success', 'failed', 'cancelled']),
    createdAt: z.date(),
  }).nullable(),
});

export const collaboratorSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  userId: z.string(),
  role: projectRoleSchema,
  permissions: z.object({
    canDeploy: z.boolean().optional(),
    canManageServices: z.boolean().optional(),
    canManageCollaborators: z.boolean().optional(),
    canViewLogs: z.boolean().optional(),
    canDeleteDeployments: z.boolean().optional(),
  }).optional(),
  invitedBy: z.string().nullable(),
  invitedAt: z.date(),
  acceptedAt: z.date().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

export const inviteCollaboratorSchema = z.object({
  email: z.string().email(),
  role: projectRoleSchema,
  permissions: z.object({
    canDeploy: z.boolean().default(false),
    canManageServices: z.boolean().default(false),
    canManageCollaborators: z.boolean().default(false),
    canViewLogs: z.boolean().default(true),
    canDeleteDeployments: z.boolean().default(false),
  }).optional(),
});

export const projectContract = oc.router({
  // List projects for the current user
  list: oc
    .route({
      method: "GET",
      path: "/projects",
      summary: "List user's projects",
    })
    .input(
      z.object({
        limit: z.number().min(1).max(100).default(20),
        offset: z.number().min(0).default(0),
        search: z.string().optional(),
        sortBy: z.enum(['name', 'createdAt', 'updatedAt']).default('updatedAt'),
        sortOrder: z.enum(['asc', 'desc']).default('desc'),
      }).optional()
    )
    .output(
      z.object({
        projects: z.array(projectWithStatsSchema),
        total: z.number(),
        hasMore: z.boolean(),
      })
    ),

  // Get project by ID
  getById: oc
    .route({
      method: "GET",
      path: "/projects/:id",
      summary: "Get project by ID",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .output(projectWithStatsSchema),

  // Create new project
  create: oc
    .route({
      method: "POST",
      path: "/projects",
      summary: "Create new project",
    })
    .input(createProjectSchema)
    .output(projectSchema),

  // Update project
  update: oc
    .route({
      method: "PUT",
      path: "/projects/:id",
      summary: "Update project",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      }).merge(updateProjectSchema)
    )
    .output(projectSchema),

  // Delete project
  delete: oc
    .route({
      method: "DELETE",
      path: "/projects/:id",
      summary: "Delete project",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    ),

  // Get project collaborators
  getCollaborators: oc
    .route({
      method: "GET",
      path: "/projects/:id/collaborators",
      summary: "Get project collaborators",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      })
    )
    .output(
      z.object({
        collaborators: z.array(collaboratorSchema),
      })
    ),

  // Invite collaborator
  inviteCollaborator: oc
    .route({
      method: "POST",
      path: "/projects/:id/collaborators",
      summary: "Invite collaborator to project",
    })
    .input(
      z.object({
        id: z.string().uuid(),
      }).merge(inviteCollaboratorSchema)
    )
    .output(
      z.object({
        inviteId: z.string(),
        message: z.string(),
      })
    ),

  // Update collaborator role
  updateCollaborator: oc
    .route({
      method: "PUT",
      path: "/projects/:id/collaborators/:userId",
      summary: "Update collaborator role and permissions",
    })
    .input(
      z.object({
        id: z.string().uuid(),
        userId: z.string(),
        role: projectRoleSchema.optional(),
        permissions: z.object({
          canDeploy: z.boolean().optional(),
          canManageServices: z.boolean().optional(),
          canManageCollaborators: z.boolean().optional(),
          canViewLogs: z.boolean().optional(),
          canDeleteDeployments: z.boolean().optional(),
        }).optional(),
      })
    )
    .output(collaboratorSchema),

  // Remove collaborator
  removeCollaborator: oc
    .route({
      method: "DELETE",
      path: "/projects/:id/collaborators/:userId",
      summary: "Remove collaborator from project",
    })
    .input(
      z.object({
        id: z.string().uuid(),
        userId: z.string(),
      })
    )
    .output(
      z.object({
        success: z.boolean(),
        message: z.string(),
      })
    ),
});

export type ProjectContract = typeof projectContract;