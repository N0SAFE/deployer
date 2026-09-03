import z from "zod/v4";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectCollaboratorInviteOps } from "./shared";

export const projectInviteCollaboratorContract = projectCollaboratorInviteOps
    .create()
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/collaborators`)
            .body(b.entitySchema),
    )
    .output(z.object({ inviteId: z.string(), message: z.string() }))
    .errors((e) => [
        // 404 for unknown project; 409 already-invited; 403 insufficient role.
        ...standardDomainErrorContracts(e),
    ])
    .build();
