import z from "zod/v4";
import { standard } from "@repo/orpc-utils";
import { collaboratorSchema, inviteCollaboratorSchema } from "@repo/contracts-entities";

export const projectIdParamSchema = z.object({ id: z.uuid() });

export const projectCollaboratorParamsSchema = z.object({
    id: z.uuid(),
    userId: z.string(),
});

export const projectCollaboratorOps = standard.zod(collaboratorSchema, "projectCollaborator");
export const projectCollaboratorInviteOps = standard.zod(
    inviteCollaboratorSchema,
    "projectCollaboratorInvite",
);
