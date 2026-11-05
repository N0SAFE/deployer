import { access } from "@deployer/auth/authz/meta";
import { projectSchema } from "@deployer/contracts-entities";
import { standard, standardDomainErrorContracts } from "@deployer/orpc-utils";

const projectOps = standard.zod(projectSchema, "project");

export const projectUpdateContract = projectOps
    .update()
    .input((b) =>
        b.entitySchema
            .omit({ id: true, ownerId: true, createdAt: true, updatedAt: true })
            .partial()
            .extend({ id: projectSchema.shape.id })
    )
    .errors((e) => [
        // 404 when the project id doesn't exist; 409 on name collision.
        ...standardDomainErrorContracts(e),
    ])
    .meta(access({ permission: "project:write", scope: { by: "input", path: "id", kind: "project" } }))
    .build();

