import z from "zod/v4";
import { standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectCollaboratorOps } from "./shared";

export const projectRemoveCollaboratorContract = projectCollaboratorOps
    .delete({ idFieldName: "userId", idSchema: z.string() })
    .input((b) => b.params((p) => p`/${p("id", z.uuid())}/collaborators/${p("userId", z.string())}`))
    .output(z.object({ success: z.boolean(), message: z.string() }))
    .errors((e) => [
        // 404 for unknown project/user; 409 when removing the last owner.
        ...standardDomainErrorContracts(e),
    ])
    .build();
