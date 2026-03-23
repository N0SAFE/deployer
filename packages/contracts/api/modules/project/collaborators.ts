import z from "zod/v4";
import { route } from "@repo/orpc-utils";
import { collaboratorSchema, inviteCollaboratorSchema, projectRoleSchema } from "@repo/api-contracts/common/project";

const idParam = z.object({ id: z.uuid() });

export const projectGetCollaboratorsContract = route()
    .method("GET")
    .path("/:id/collaborators")
    .input(idParam)
    .output(z.object({ collaborators: z.array(collaboratorSchema) }))
    .build();

export const projectInviteCollaboratorContract = route()
    .method("POST")
    .path("/:id/collaborators")
    .input(inviteCollaboratorSchema.extend({ id: z.uuid() }))
    .output(z.object({ inviteId: z.string(), message: z.string() }))
    .build();

export const projectUpdateCollaboratorContract = route()
    .method("PUT")
    .path("/:id/collaborators/:userId")
    .input(
        z.object({
            id: z.uuid(),
            userId: z.string(),
            role: projectRoleSchema.optional(),
            permissions: z
                .object({
                    canDeploy: z.boolean().optional(),
                    canManageServices: z.boolean().optional(),
                    canManageCollaborators: z.boolean().optional(),
                    canViewLogs: z.boolean().optional(),
                    canDeleteDeployments: z.boolean().optional(),
                })
                .optional(),
        }),
    )
    .output(collaboratorSchema)
    .build();

export const projectRemoveCollaboratorContract = route()
    .method("DELETE")
    .path("/:id/collaborators/:userId")
    .input(z.object({ id: z.uuid(), userId: z.string() }))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .build();
