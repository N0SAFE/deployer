import z from 'zod/v4'
import { PROJECT_ROLES } from '@deployer/auth'

export const projectRoleSchema = z.enum(PROJECT_ROLES)

/**
 * The roles the membership API may GRANT (invite, or a role patch).
 *
 * `owner` is deliberately absent: ownership is a property of the project row,
 * not of a collaborator record, so it is transferred — never invited. Keeping
 * this separate from `projectRoleSchema` matters because the same schema is
 * reused for the collaborator RESPONSE, which must still be able to name the
 * owner.
 */
export const projectAssignableRoleSchema = projectRoleSchema.exclude(['owner'])

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
  role: projectAssignableRoleSchema,
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
