import { standard } from "@repo/orpc-utils";
import { projectSchema } from "@repo/api-contracts/common/project";

const projectOps = standard.zod(projectSchema, "project");

export const projectUpdateContract = projectOps
    .update()
    .input((b) =>
        b.entitySchema
            .omit({ id: true, ownerId: true, createdAt: true, updatedAt: true })
            .partial()
            .extend({ id: projectSchema.shape.id })
    )
    .build();

