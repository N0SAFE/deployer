import z from 'zod/v4'
import { PROJECT_ROLES } from '@repo/auth'

export const projectRoleSchema = z.enum(PROJECT_ROLES)

export const collaboratorSchema = z.object({
  id: z.uuid(),
  projectId: z.uuid(),
  userId: z.string(),
  role: projectRoleSchema,
  permissions: z
    .object({
      canDeploy: z.boolean().optional(),
      canManageServices: z.boolean().optional(),
      canManageCollaborators: z.boolean().optional(),
      canViewLogs: z.boolean().optional(),
      canDeleteDeployments: z.boolean().optional(),
    })
    .nullable(),
  invitedBy: z.string().nullable(),
  invitedAt: z.string(),
  acceptedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
})

export const inviteCollaboratorSchema = z.object({
  email: z.email(),
  role: projectRoleSchema,
  permissions: z
    .object({
      canDeploy: z.boolean().default(false),
      canManageServices: z.boolean().default(false),
      canManageCollaborators: z.boolean().default(false),
      canViewLogs: z.boolean().default(true),
      canDeleteDeployments: z.boolean().default(false),
    })
    .optional(),
})
