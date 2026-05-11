import z from "zod/v4";
import { projectCollaboratorOps } from "./shared";

export const projectUpdateCollaboratorContract = projectCollaboratorOps
    .update({ idFieldName: "userId", idSchema: z.string() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/collaborators/${p("userId", z.string())}`)
            .body(
                z.object({
                    role: b.entitySchema.shape.role.optional(),
                    permissions: b.entitySchema.shape.permissions.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .build();
