import z from "zod/v4";
import { projectCollaboratorInviteOps } from "./shared";

export const projectInviteCollaboratorContract = projectCollaboratorInviteOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/collaborators`)
            .body(b.entitySchema),
    )
    .output(z.object({ inviteId: z.string(), message: z.string() }))
    .build();
