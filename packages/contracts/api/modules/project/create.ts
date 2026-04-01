import { standard } from "@repo/orpc-utils";
import { projectSchema } from "@repo/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

export const projectCreateContract = projectOps
    .create()
    .input((b) =>
        b.entitySchema.omit({ id: true, ownerId: true, createdAt: true, updatedAt: true })
    )
    .build();

