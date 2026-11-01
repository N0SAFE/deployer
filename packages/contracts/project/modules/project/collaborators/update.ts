import z from "zod/v4";
import { standardDomainErrorContracts } from "@deployer/orpc-utils";
import { projectAssignableRoleSchema } from "@deployer/contracts-entities";
import { projectCollaboratorOps } from "./shared";

export const projectUpdateCollaboratorContract = projectCollaboratorOps
    .update({ idFieldName: "userId", idSchema: z.string() })
    .input((b) =>
        b
            .params((p) => p`/${p("id", z.uuid())}/collaborators/${p("userId", z.string())}`)
            .body(
                z.object({
                    // Ownership is not grantable through a role patch.
                    role: projectAssignableRoleSchema.optional(),
                    permissions: b.entitySchema.shape.permissions.optional(),
                }),
            ),
    )
    .output((b) => b.entitySchema)
    .errors((e) => [
        // 404 for unknown project/user; 409 when demoting the last owner.
        ...standardDomainErrorContracts(e),
    ])
    .build();
