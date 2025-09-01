import { oc } from '@orpc/contract';
import { z } from 'zod';
import { collaboratorSchema, inviteCollaboratorSchema, projectRoleSchema } from './schemas';

// Get Collaborators
export const projectGetCollaboratorsInput = z.object({
  id: z.string().uuid(),
});

export const projectGetCollaboratorsOutput = z.object({
  collaborators: z.array(collaboratorSchema),
});

export const projectGetCollaboratorsContract = oc
  .route({
    method: "GET",
    path: "/:id/collaborators",
    summary: "Get project collaborators",
  })
  .input(projectGetCollaboratorsInput)
  .output(projectGetCollaboratorsOutput);

// Invite Collaborator
export const projectInviteCollaboratorInput = z.object({
  id: z.string().uuid(),
}).merge(inviteCollaboratorSchema);

export const projectInviteCollaboratorOutput = z.object({
  inviteId: z.string(),
  message: z.string(),
});

export const projectInviteCollaboratorContract = oc
  .route({
    method: "POST",
    path: "/:id/collaborators",
    summary: "Invite collaborator to project",
  })
  .input(projectInviteCollaboratorInput)
  .output(projectInviteCollaboratorOutput);

// Update Collaborator
export const projectUpdateCollaboratorInput = z.object({
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
});

export const projectUpdateCollaboratorOutput = collaboratorSchema;

export const projectUpdateCollaboratorContract = oc
  .route({
    method: "PUT",
    path: "/:id/collaborators/:userId",
    summary: "Update collaborator role and permissions",
  })
  .input(projectUpdateCollaboratorInput)
  .output(projectUpdateCollaboratorOutput);

// Remove Collaborator
export const projectRemoveCollaboratorInput = z.object({
  id: z.string().uuid(),
  userId: z.string(),
});

export const projectRemoveCollaboratorOutput = z.object({
  success: z.boolean(),
  message: z.string(),
});

export const projectRemoveCollaboratorContract = oc
  .route({
    method: "DELETE",
    path: "/:id/collaborators/:userId",
    summary: "Remove collaborator from project",
  })
  .input(projectRemoveCollaboratorInput)
  .output(projectRemoveCollaboratorOutput);