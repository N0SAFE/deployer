import { standard } from "@repo/orpc-utils";
import { projectSchema } from "@repo/contracts-entities";

const projectOps = standard.zod(projectSchema, "project");

const projectCreateInputSchema = projectSchema
    .omit({ id: true, ownerId: true, createdAt: true, updatedAt: true })
    .extend({
        baseDomain: projectSchema.shape.baseDomain.unwrap().optional(),
        settings: projectSchema.shape.settings.unwrap().optional(),
    });

export const projectCreateContract = projectOps
    .create()
    .input((b) => b.body(projectCreateInputSchema))
    .build();

