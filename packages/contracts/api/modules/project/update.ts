import { standard, standardDomainErrorContracts } from "@repo/orpc-utils";
import { projectSchema } from "@repo/contracts-entities";

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
    .build();

